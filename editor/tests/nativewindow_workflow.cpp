#include "nativewindowhost.h"
#include <QApplication>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QFileInfo>
#include <QPainter>
#include <QProcess>
#include <QTimer>
#include <cstdio>
#include <cstdlib>
#include <xcb/shape.h>
#include <xcb/xcb.h>

class ColorWindow : public QWidget {
  public:
    bool alternate = false;
    void paintEvent(QPaintEvent *) override {
        QPainter painter(this);
        painter.fillRect(rect(), alternate ? Qt::green : Qt::blue);
    }
};
int main(int argc, char **argv) {
    QApplication app(argc, argv);
    app.setQuitOnLastWindowClosed(false);
    if (app.arguments().contains("--child")) {
        ColorWindow window;
        window.resize(640, 360);
        window.show();
        ColorWindow second;
        second.resize(400, 300);
        if (app.arguments().contains("--two"))
            second.show();
        QTimer paint;
        paint.setInterval(100);
        QObject::connect(&paint, &QTimer::timeout, &window, [&] {
            window.alternate = !window.alternate;
            window.update();
        });
        paint.start();
        QTimer::singleShot(100, &window, [&] {
            std::printf("%llu\n", static_cast<unsigned long long>(window.winId()));
            std::fflush(stdout);
        });
        return app.exec();
    }
    const auto require = [](bool ok, const char *message) {
        if (!ok)
            std::fprintf(stderr, "%s\n", message);
        return ok;
    };
    const auto wait = [](int ms) {
        QEventLoop loop;
        QTimer::singleShot(ms, &loop, &QEventLoop::quit);
        loop.exec();
    };
    if (!require(NativeWindowHost::supported(), "X11 test requires QT_QPA_PLATFORM=xcb"))
        return 1;
    auto *connection = xcb_connect(nullptr, nullptr);
    const auto inputCount = [&](xcb_window_t window) {
        auto *reply = xcb_shape_get_rectangles_reply(
            connection, xcb_shape_get_rectangles(connection, window, XCB_SHAPE_SK_INPUT), nullptr);
        const int count = reply ? xcb_shape_get_rectangles_rectangles_length(reply) : -1;
        std::free(reply);
        return count;
    };
    struct Child : QProcess {
        ~Child() {
            if (state() != NotRunning) {
                terminate();
                if (!waitForFinished(2000)) {
                    kill();
                    waitForFinished(1000);
                }
            }
        }
    } child;
    child.start(QCoreApplication::applicationFilePath(), {"--child"});
    if (!child.waitForReadyRead(5000))
        return 1;
    const auto window = static_cast<xcb_window_t>(child.readLine().trimmed().toULongLong());
    const int originalShape = inputCount(window);
    NativeWindowHost host;
    host.resize(800, 450);
    host.show();
    wait(50);
    QString error;
    if (!require(!host.attachOwned(QCoreApplication::applicationPid() + 1, child.processId(),
                                   QCoreApplication::applicationFilePath(), error),
                 "Accepted incorrect controller parent"))
        return 1;
    if (!require(!host.attachOwned(QCoreApplication::applicationPid(), child.processId(), "/wrong/executable",
                                   error),
                 "Accepted incorrect executable"))
        return 1;
    if (!require(host.attachOwned(QCoreApplication::applicationPid(), child.processId(),
                                  QCoreApplication::applicationFilePath(), error),
                 qPrintable(error)))
        return 1;
    wait(200);
    if (!require(host.hostedWindow() == window && host.verifyOwned() && inputCount(window) == 0,
                 "Did not isolate original owned window input"))
        return 1;
    const uint32_t escaped[]{1200, 700};
    auto *configureError = xcb_request_check(
        connection,
        xcb_configure_window_checked(connection, window, XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y, escaped));
    std::free(configureError);
    host.attachOwned(QCoreApplication::applicationPid(), child.processId(),
                     QCoreApplication::applicationFilePath(), error);
    auto *geometry = xcb_get_geometry_reply(connection, xcb_get_geometry(connection, window), nullptr);
    const bool local = geometry && geometry->x == 0 && geometry->y == 0;
    std::free(geometry);
    if (!require(local, "SDL-style delayed desktop placement escaped host"))
        return 1;
    host.detach();
    wait(50);
    auto *attributes =
        xcb_get_window_attributes_reply(connection, xcb_get_window_attributes(connection, window), nullptr);
    const bool survives = attributes && attributes->map_state == XCB_MAP_STATE_VIEWABLE;
    std::free(attributes);
    if (!require(!host.attached() && survives && inputCount(window) == originalShape &&
                     child.state() == QProcess::Running,
                 "Detach destroyed native surface or failed input restoration"))
        return 1;
    if (!host.attachOwned(QCoreApplication::applicationPid(), child.processId(),
                          QCoreApplication::applicationFilePath(), error))
        return 1;
    child.terminate();
    child.waitForFinished(2000);
    wait(50);
    if (!require(!host.verifyOwned(), "Dead child retained valid identity"))
        return 1;
    host.detach(); // BadWindow is checked locally, never a fatal global X error.
    Child ambiguous;
    ambiguous.start(QCoreApplication::applicationFilePath(), {"--child", "--two"});
    if (!ambiguous.waitForReadyRead(5000))
        return 1;
    if (!require(!host.attachOwned(QCoreApplication::applicationPid(), ambiguous.processId(),
                                   QCoreApplication::applicationFilePath(), error) &&
                     error.contains("ambiguous"),
                 "Attached ambiguous native windows"))
        return 1;
    xcb_disconnect(connection);
    std::puts(
        "X11 native host: direct child/executable identity, unique window, input isolation, local coordinate "
        "repair, detach preservation, dead-child cleanup, ambiguity rejection passed. No emulator launched.");
    return 0;
}
