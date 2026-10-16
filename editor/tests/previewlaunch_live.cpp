// Opt-in real workspace acceptance driver. No desktop-wide input injection.
#include "nativegameview.h"
#include "nativewindowhost.h"
#include "window.h"
#include <QAction>
#include <QApplication>
#include <QCheckBox>
#include <QDockWidget>
#include <QDoubleSpinBox>
#include <QFileInfo>
#include <QJsonDocument>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QMouseEvent>
#include <QPushButton>
#include <QSettings>
#include <QSocketNotifier>
#include <QTemporaryDir>
#include <QTimer>
#include <iostream>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 4 || qEnvironmentVariable("SKYLANDERS_PREVIEW_LIVE_TEST") != "1")
        return 2;
    QTemporaryDir settings;
    if (!settings.isValid())
        return 2;
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, settings.path());
    QApplication app(argc, argv);
    EditorWindow window({QString::fromLocal8Bit(argv[1]), QString::fromLocal8Bit(argv[2])});
    if (!QString::fromLocal8Bit(argv[3]).endsWith(".scene.json"))
        window.setInitialCamera({{"pivot", QJsonArray{-69.89, 16.99, -98.67}},
                                 {"yawRadians", 0},
                                 {"pitchRadians", -.524},
                                 {"distance", 40}});
    window.show();
    window.openPath(QString::fromLocal8Bit(argv[3]));
    auto report = [](const QJsonObject &v) {
        std::cout << QJsonDocument(v).toJson(QJsonDocument::Compact).constData() << std::endl;
    };
    const auto view = [&]() {
        return static_cast<NativeGameView *>(window.findChild<QDialog *>("nativeGameView"));
    };
    const auto status = [&]() {
        const auto text = [&](const char *name) {
            auto *l = window.findChild<QLabel *>(name);
            return l ? l->text() : QString{};
        };
        const auto field = [&](const char *name) {
            auto *l = window.findChild<QLineEdit *>(name);
            return l ? l->text() : QString{};
        };
        auto *v = view();
        auto *h = window.findChild<QPushButton *>("nativeCameraHold");
        int windows = 0;
        for (auto *w : QApplication::topLevelWidgets())
            if (w->isVisible() && w->windowType() != Qt::ToolTip)
                ++windows;
        const auto *host = static_cast<NativeWindowHost *>(window.findChild<QWidget *>("nativeLiveSurface"));
        return QJsonObject{
            {"guiPid", QCoreApplication::applicationPid()},
            {"windowId", QString::number(window.winId(), 16)},
            {"nativeWindow", host ? QString::number(host->hostedWindow(), 16) : QString{}},
            {"topLevelWindows", windows},
            {"playEnabled", window.findChild<QPushButton *>("playCurrentMap")->isEnabled()},
            {"state", window.findChild<QLabel *>("previewLaunchStatus")->property("state").toString()},
            {"preview", text("previewLaunchStatus")},
            {"error", window.findChild<QLabel *>("previewLaunchStatus")->toolTip()},
            {"preparation", text("preparationStage")},
            {"live", v && v->liveAttached()},
            {"held", h && h->isChecked()},
            {"holdEnabled", h && h->isEnabled()},
            {"camera", text("nativeCameraStatus")},
            {"game", field("portalGame")},
            {"session", field("portalSession")}};
    };
    QSocketNotifier input(STDIN_FILENO, QSocketNotifier::Read);
    QObject::connect(&input, &QSocketNotifier::activated, &app, [&] {
        std::string line;
        if (!std::getline(std::cin, line)) {
            input.setEnabled(false);
            window.close();
            return;
        }
        const auto command = QJsonDocument::fromJson(QByteArray::fromStdString(line)).object();
        const auto op = command.value("command").toString();
        if (op == "status") {
            report(status());
            return;
        }
        if (op == "close") {
            window.close();
            return;
        }
        if (op == "play") {
            window.findChild<QPushButton *>("playCurrentMap")->click();
            report(status());
            return;
        }
        if (op == "stop") {
            window.findChild<QPushButton *>("stopGamePreview")->click();
            report(status());
            return;
        }
        if (op == "game") {
            const auto button = command.value("button").toString();
            if (!QStringList{"portalOptions", "portalCross", "portalCircle", "portalDpadUp", "portalDpadDown",
                             "portalDpadLeft", "portalDpadRight"}
                     .contains(button))
                return;
            auto *b = window.findChild<QPushButton *>(button);
            if (b && b->isEnabled())
                b->click();
            else
                report({{"error", "Game input unavailable"}});
            return;
        }
        if (op == "editor" || op == "live") {
            auto *d =
                window.findChild<QDockWidget *>(op == "editor" ? "editorViewportDock" : "liveViewportDock");
            d->show();
            d->raise();
            report(status());
            return;
        }
        if (op == "split" || op == "tabs") {
            window.findChild<QAction *>(op == "split" ? "splitViewports" : "tabbedViewports")->trigger();
            report(status());
            return;
        }
        auto *v = view();
        if (!v) {
            report({{"error", "No native view"}});
            return;
        }
        if (op == "speed") {
            const double value = command.value("value").toDouble(-1);
            if (value < .1 || value > 100) {
                report({{"error", "Speed must be 0.1..100 game units/s"}});
                return;
            }
            v->findChild<QDoubleSpinBox *>("nativeCameraSpeed")->setValue(value);
        } else if (op == "hold") {
            auto *b = v->findChild<QPushButton *>("nativeCameraHold");
            if (!b->isChecked())
                b->click();
        } else if (op == "restore")
            v->releaseCameraInput();
        else if (op == "hud")
            v->findChild<QCheckBox *>("nativeCameraHideUi")->setChecked(command.value("hidden").toBool());
        else if (op == "screenshot")
            v->findChild<QPushButton *>("nativeViewCapture")->click();
        else if (op == "move") {
            const int duration = command.value("durationMs").toInt(500);
            if (duration < 1 || duration > 2000) {
                report({{"error", "durationMs must be1..2000"}});
                return;
            }
            const auto name = command.value("key").toString("W");
            const QString keys = "WASDQE";
            if (name.size() != 1 || !keys.contains(name))
                return;
            auto *s = v->cameraInputSurface();
            s->setFocus();
            const int key = name[0].unicode();
            QKeyEvent press(QEvent::KeyPress, key, Qt::NoModifier);
            QApplication::sendEvent(s, &press);
            QTimer::singleShot(duration, s, [s, key] {
                QKeyEvent release(QEvent::KeyRelease, key, Qt::NoModifier);
                QApplication::sendEvent(s, &release);
            });
        } else if (op == "look") {
            auto *s = v->cameraInputSurface();
            s->setFocus();
            QMouseEvent press(QEvent::MouseButtonPress, {50, 50}, {50, 50}, {50, 50}, Qt::RightButton,
                              Qt::RightButton, Qt::NoModifier);
            QMouseEvent move(QEvent::MouseMove, {70, 55}, {70, 55}, {70, 55}, Qt::NoButton, Qt::RightButton,
                             Qt::NoModifier);
            QMouseEvent release(QEvent::MouseButtonRelease, {70, 55}, {70, 55}, {70, 55}, Qt::RightButton,
                                Qt::NoButton, Qt::NoModifier);
            QApplication::sendEvent(s, &press);
            QApplication::sendEvent(s, &move);
            QApplication::sendEvent(s, &release);
        } else {
            report({{"error", "Unknown command"}});
            return;
        }
        report(status());
    });
    QTimer::singleShot(600000, &window, [&] { window.close(); });
    report({{"ready", true},
            {"note", "Opt-in real Play-current-map path; settings isolated, original profile read-only."}});
    return app.exec();
}
