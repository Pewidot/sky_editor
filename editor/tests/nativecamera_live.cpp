// Opt-in real Qt/controller/native-game integration driver. Not part of CTest.
// All input is delivered to this application's widgets, never another window.
#include "nativegameview.h"
#include "portaldialog.h"
#include <QApplication>
#include <QCheckBox>
#include <QDateTime>
#include <QElapsedTimer>
#include <QFileInfo>
#include <QJsonDocument>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QMouseEvent>
#include <QPushButton>
#include <QScreen>
#include <QSocketNotifier>
#include <QSpinBox>
#include <QTimer>
#include <cstdio>
#include <iostream>
#include <unistd.h>

int main(int argc, char **argv) {
    QApplication app(argc, argv);
    app.setQuitOnLastWindowClosed(false);
    if (argc != 7 || qEnvironmentVariable("SKYLANDERS_NATIVE_CAMERA_LIVE_TEST") != "1")
        return 2;
    PortalDialog portal({QString::fromLocal8Bit(argv[1]), "unused"}, nullptr,
                        QString::fromLocal8Bit(argv[2]));
    const QString session = QString::fromLocal8Bit(argv[5]);
    portal.findChild<QLineEdit *>("portalEmulator")->setText(QString::fromLocal8Bit(argv[3]));
    portal.findChild<QLineEdit *>("portalGame")->setText(QString::fromLocal8Bit(argv[4]));
    portal.findChild<QLineEdit *>("portalSession")->setText(session);
    portal.findChild<QLineEdit *>("portalResume")->setText(QString::fromLocal8Bit(argv[6]));
    portal.findChild<QSpinBox *>("portalPulseDuration")->setValue(80);
    portal.findChild<QCheckBox *>("portalCaptureAfterInput")->setChecked(false);
    auto button = [&](const char *name) { return portal.findChild<QPushButton *>(name); };
    portal.show();
    button("portalNativeView")->click();
    auto *view = static_cast<NativeGameView *>(portal.findChild<QDialog *>("nativeGameView"));
    QWidget *preview = view->cameraInputSurface();
    auto *hold = view->findChild<QPushButton *>("nativeCameraHold");
    auto *ui = view->findChild<QCheckBox *>("nativeCameraHideUi");
    const auto report = [](const QJsonObject &value) {
        const auto b = QJsonDocument(value).toJson(QJsonDocument::Compact);
        std::cout << b.constData() << std::endl;
    };
    const auto imagePath = [&] { return view->findChild<QLineEdit *>("nativeViewPath")->text(); };
    const auto key = [&](QEvent::Type type, int code) {
        preview = view->cameraInputSurface();
        QKeyEvent event(type, code, Qt::NoModifier);
        QApplication::sendEvent(preview, &event);
    };
    int hostShot = 0;
    const auto liveShot = [&] {
        const QString path = session + QString("/native-host-%1.png").arg(++hostShot, 2, 10, QChar('0'));
        view->screen()->grabWindow(view->winId()).save(path);
        return path;
    };
    int phase = 0;
    QString prior;
    QElapsedTimer elapsed, phaseTime;
    QTimer exercise;
    QObject::connect(&exercise, &QTimer::timeout, &app, [&] {
        if (elapsed.elapsed() > 12000) {
            exercise.stop();
            view->releaseCameraInput();
            report({{"exerciseError", "Timed out; camera restore requested"}});
            return;
        }
        const auto cameraText = view->findChild<QLabel *>("nativeCameraStatus")->text();
        if (phase == 1 && cameraText.contains("camera held")) {
            preview = view->cameraInputSurface();
            view->raise();
            view->activateWindow();
            preview->setFocus();
            key(QEvent::KeyPress, Qt::Key_W);
            key(QEvent::KeyPress, Qt::Key_D);
            phaseTime.start();
            phase = 2;
        } else if (phase == 2 && phaseTime.elapsed() > 500) {
            key(QEvent::KeyRelease, Qt::Key_W);
            key(QEvent::KeyRelease, Qt::Key_D);
            QMouseEvent press(QEvent::MouseButtonPress, {50, 50}, {50, 50}, {50, 50}, Qt::RightButton,
                              Qt::RightButton, Qt::NoModifier);
            QMouseEvent move(QEvent::MouseMove, {125, 65}, {125, 65}, {125, 65}, Qt::NoButton,
                             Qt::RightButton, Qt::NoModifier);
            QMouseEvent release(QEvent::MouseButtonRelease, {125, 65}, {125, 65}, {125, 65}, Qt::RightButton,
                                Qt::NoButton, Qt::NoModifier);
            QApplication::sendEvent(preview, &press);
            QApplication::sendEvent(preview, &move);
            QApplication::sendEvent(preview, &release);
            prior = imagePath();
            phaseTime.restart();
            phase = 3;
        } else if (phase == 3 && phaseTime.elapsed() > 700 && ui->isEnabled()) {
            report({{"stage", "moved"}, {"live", view->liveAttached()}, {"qtWindow", liveShot()}});
            prior = imagePath();
            ui->setChecked(true);
            phaseTime.restart();
            phase = 4;
        } else if (phase == 4 && phaseTime.elapsed() > 700 && ui->isChecked() && ui->isEnabled()) {
            report({{"stage", "hidden-ui"}, {"live", view->liveAttached()}, {"qtWindow", liveShot()}});
            key(QEvent::KeyPress, Qt::Key_Escape);
            phaseTime.restart();
            phase = 5;
        } else if (phase == 5 && hold->isEnabled() && phaseTime.elapsed() > 700) {
            exercise.stop();
            report({{"stage", "restored"},
                    {"live", view->liveAttached()},
                    {"qtWindow", liveShot()},
                    {"elapsedMs", int(elapsed.elapsed())}});
        }
    });
    exercise.setInterval(30);
    QSocketNotifier input(STDIN_FILENO, QSocketNotifier::Read);
    QObject::connect(&input, &QSocketNotifier::activated, &app, [&] {
        std::string text;
        if (!std::getline(std::cin, text)) {
            input.setEnabled(false);
            portal.requestShutdown([&] { app.quit(); });
            return;
        }
        const auto value = QJsonDocument::fromJson(QByteArray::fromStdString(text)).object();
        const auto command = value.value("command").toString();
        if (command == "exercise") {
            if (!hold->isEnabled() || exercise.isActive()) {
                report({{"error", "Hold unavailable or exercise active"}});
                return;
            }
            report({{"stage", "before"}, {"path", imagePath()}});
            phase = 1;
            elapsed.start();
            ui->setChecked(false);
            hold->click();
            exercise.start();
        } else if (command == "close")
            portal.requestShutdown([&] {
                report({{"closed", true}});
                app.quit();
            });
        else if (command == "hold") {
            if (hold->isEnabled())
                hold->click();
            report({{"holdSent", !hold->isEnabled()}});
        } else if (command == "hide-ui") {
            if (ui->isEnabled())
                ui->setChecked(true);
            report({{"uiChecked", ui->isChecked()}});
        } else if (command == "restore") {
            view->releaseCameraInput();
            report({{"restoreRequested", true}});
        } else if (command == "hostshot")
            report({{"live", view->liveAttached()}, {"qtWindow", liveShot()}});
        else if (command == "display-mode") {
            view->findChild<QPushButton *>("nativeViewFallback")->click();
            report({{"live", view->liveAttached()}});
        } else if (command == "status")
            report({{"camera", view->findChild<QLabel *>("nativeCameraStatus")->text()},
                    {"windowId", QString::number(view->winId(), 16)},
                    {"guiPid", QCoreApplication::applicationPid()},
                    {"live", view->liveAttached()},
                    {"liveStatus", view->findChild<QLabel *>("nativeLiveStatus")->text()},
                    {"path", imagePath()},
                    {"feedback", portal.findChild<QLabel *>("portalGameFeedback")->text()},
                    {"start", button("portalStart")->isEnabled()},
                    {"cross", button("portalCross")->isEnabled()},
                    {"capture", button("portalCapture")->isEnabled()},
                    {"hold", hold->isEnabled()}});
        else {
            const QString name = command == "start"     ? "portalStart"
                                 : command == "cross"   ? "portalCross"
                                 : command == "capture" ? "portalCapture"
                                                        : "";
            auto *target = portal.findChild<QPushButton *>(name);
            if (!target || !target->isEnabled())
                report({{"error", "Unknown or unavailable control"}, {"command", command}});
            else {
                target->click();
                report({{"clicked", command}});
            }
        }
    });
    QTimer::singleShot(600000, &app, [&] { portal.requestShutdown([&] { app.quit(); }); });
    report({{"ready", true},
            {"note", "Opt-in actual Qt widget -> production controller -> owned game test. No desktop input "
                     "injection."}});
    return app.exec();
}
