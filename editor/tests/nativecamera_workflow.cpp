#include "nativegameview.h"
#include <QApplication>
#include <QDoubleSpinBox>
#include <QEventLoop>
#include <QKeyEvent>
#include <QLabel>
#include <QMouseEvent>
#include <QPushButton>
#include <QSettings>
#include <QTemporaryDir>
#include <QTimer>
#include <cmath>
#include <cstdio>

int main(int argc, char **argv) {
    QTemporaryDir settings;
    if (!settings.isValid())
        return 2;
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, settings.path());
    QApplication app(argc, argv);
    app.setQuitOnLastWindowClosed(false);
    NativeGameView view;
    view.show();
    view.activateWindow();
    const auto wait = [](int ms) {
        QEventLoop loop;
        QTimer::singleShot(ms, &loop, &QEventLoop::quit);
        loop.exec();
    };
    const auto require = [](bool ok, const char *message) {
        if (!ok)
            std::fprintf(stderr, "%s\n", message);
        return ok;
    };
    auto *image = view.findChild<QLabel *>("nativeViewImage");
    auto *hold = view.findChild<QPushButton *>("nativeCameraHold");
    auto *restore = view.findChild<QPushButton *>("nativeCameraRestore");
    auto *speed = view.findChild<QDoubleSpinBox *>("nativeCameraSpeed");
    if (!require(speed && speed->value() == 5 && speed->minimum() == .1 && speed->maximum() == 100,
                 "Free camera speed control is missing or has incorrect defaults"))
        return 1;
    QImage frame(2, 2, QImage::Format_RGB32);
    frame.fill(Qt::green);
    int inFlight = 0, maxInFlight = 0, restores = 0, captures = 0;
    bool restoreQueued = false;
    QList<QJsonObject> moves;
    view.requestCapture = [&] {
        ++captures;
        view.captureStarted();
        QTimer::singleShot(20, &view,
                           [&] { view.presentFrame(frame, "synthetic", "/synthetic/frame.png", 20); });
        return true;
    };
    view.requestCameraRestore = [&] {
        restoreQueued = true;
        if (!inFlight) {
            ++restores;
            restoreQueued = false;
            view.setCameraState(true, false, 0, "Restored");
            view.cameraActionFinished(true, {});
        }
    };
    view.requestCamera = [&](const QString &operation, const QJsonObject &args) {
        ++inFlight;
        maxInFlight = qMax(maxInFlight, inFlight);
        view.setCaptureAvailability(true, true, {});
        if (operation == "portal_camera_move")
            moves.push_back(args);
        else if ((operation != "portal_camera_enable" && operation != "portal_camera_renew") ||
                 args.value("durationMs").toInt() != 8000)
            return false;
        QTimer::singleShot(150, &view, [&] {
            --inFlight;
            view.setCaptureAvailability(true, false, {});
            view.setCameraState(true, true, 14000, {});
            if (restoreQueued) {
                ++restores;
                restoreQueued = false;
                view.setCameraState(true, false, 0, "Restored");
            }
            view.cameraActionFinished(true, {});
        });
        return true;
    };
    wait(20);
    if (!require(!hold->isEnabled(), "Camera was enabled before capability validation gate"))
        return 1;
    view.setCaptureAvailability(true, false, {});
    view.setCameraState(true, false, 0, "Ready");
    hold->click();
    wait(220);
    image->setFocus();
    if (!require(restore->isEnabled() && hold->isEnabled() && hold->isChecked() && captures == 1,
                 "Free camera toggle did not remain available during hold"))
        return 1;
    auto key = [&](QEvent::Type type, int k, bool repeat = false) {
        QKeyEvent event(type, k, Qt::NoModifier, {}, repeat);
        QApplication::sendEvent(image, &event);
    };
    key(QEvent::KeyPress, Qt::Key_W);
    key(QEvent::KeyPress, Qt::Key_D);
    for (int i = 0; i < 100; ++i)
        key(QEvent::KeyPress, Qt::Key_W, true);
    wait(400);
    key(QEvent::KeyRelease, Qt::Key_W);
    key(QEvent::KeyRelease, Qt::Key_D);
    wait(200);
    if (!require(moves.size() >= 1 && moves.size() <= 3 && maxInFlight == 1,
                 "Held keys/auto-repeat built a backlog or overlapped camera requests"))
        return 1;
    for (const auto &move : moves)
        if (!require(std::hypot(move.value("right").toDouble(), move.value("up").toDouble(),
                                move.value("forward").toDouble()) <= .500001 &&
                         std::abs(move.value("right").toDouble() - move.value("forward").toDouble()) < 1e-6,
                     "Elapsed-time diagonal movement was not normalized/bounded"))
            return 1;
    const int prior = moves.size();
    auto mouse = [&](QEvent::Type type, QPointF at, Qt::MouseButton button, Qt::MouseButtons buttons) {
        QMouseEvent event(type, at, at, at, button, buttons, Qt::NoModifier);
        QApplication::sendEvent(image, &event);
    };
    mouse(QEvent::MouseButtonPress, {10, 10}, Qt::RightButton, Qt::RightButton);
    for (int i = 1; i <= 100; ++i)
        mouse(QEvent::MouseMove, {double(10 + i * 3), double(10 + i)}, Qt::NoButton, Qt::RightButton);
    mouse(QEvent::MouseButtonRelease, {310, 110}, Qt::RightButton, Qt::NoButton);
    wait(250);
    if (!require(moves.size() == prior + 1 && moves.last().value("yaw").toDouble() == -30 &&
                     moves.last().value("pitch").toDouble() < -17,
                 "RMB deltas were not coalesced and bounded"))
        return 1;
    key(QEvent::KeyPress, Qt::Key_E);
    wait(120);
    key(QEvent::KeyRelease, Qt::Key_E);
    wait(200);
    if (!require(moves.last().value("up").toDouble() > 0 && moves.last().value("up").toDouble() <= .5,
                 "Q/E vertical camera input was not mapped"))
        return 1;
    speed->setValue(100);
    image->setFocus();
    const int beforeFast = moves.size();
    key(QEvent::KeyPress, Qt::Key_W);
    key(QEvent::KeyPress, Qt::Key_D);
    wait(400);
    key(QEvent::KeyRelease, Qt::Key_W);
    key(QEvent::KeyRelease, Qt::Key_D);
    wait(200);
    double maximumStep = 0;
    for (int i = beforeFast; i < moves.size(); ++i) {
        const auto &move = moves[i];
        const double distance = std::hypot(move.value("right").toDouble(), move.value("up").toDouble(),
                                           move.value("forward").toDouble());
        maximumStep = qMax(maximumStep, distance);
        if (!require(distance <= 5 &&
                         std::abs(move.value("right").toDouble() - move.value("forward").toDouble()) < 1e-6,
                     "Fast movement exceeded the native transaction bound or lost diagonal normalization"))
            return 1;
    }
    if (!require(maximumStep > 1, "Changing speed did not increase movement during an active hold"))
        return 1;
    speed->setValue(17.5);
    {
        NativeGameView reopened;
        if (!require(reopened.findChild<QDoubleSpinBox *>("nativeCameraSpeed")->value() == 17.5,
                     "Free camera speed did not persist between views"))
            return 1;
    }
    key(QEvent::KeyPress, Qt::Key_Escape);
    wait(30);
    if (!require(restores == 1 && view.isVisible() && hold->isEnabled(),
                 "Escape did not restore without closing the active camera view"))
        return 1;
    const int stopped = moves.size();
    key(QEvent::KeyPress, Qt::Key_W);
    wait(250);
    if (!require(moves.size() == stopped, "Keys moved a restored camera"))
        return 1;
    hold->click();
    wait(30);
    view.close();
    wait(200);
    if (!require(restores == 2 && !view.isVisible() && maxInFlight == 1,
                 "Close during pending hold did not defer exactly one restore"))
        return 1;
    std::puts(
        "Native camera UI: renewable hold, persistent adjustable speed, bounded normalized steps, focused "
        "WASD/QE, coalesced RMB, serialized moves, Escape and close restoration passed (synthetic only).");
    return 0;
}
