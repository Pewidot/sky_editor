#include "portaldialog.h"

#include <QApplication>
#include <QCheckBox>
#include <QElapsedTimer>
#include <QImage>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QSpinBox>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QTimer>
#include <cstdio>

int main(int argc, char **argv) {
    QApplication app(argc, argv);
    app.setQuitOnLastWindowClosed(false);
    if (argc != 3)
        return 2;
    QTemporaryDir testDirectory;
    QImage synthetic(2, 2, QImage::Format_RGB32);
    synthetic.fill(Qt::green);
    const QString png = testDirectory.filePath("synthetic.png");
    if (!testDirectory.isValid() || !synthetic.save(png, "PNG"))
        return 2;
    qputenv("SKYLANDERS_PORTAL_TEST_PNG", png.toUtf8());
    PortalDialog dialog({QString::fromLocal8Bit(argv[1]), "unused"}, nullptr,
                        QString::fromLocal8Bit(argv[2]));
    dialog.show();
    dialog.findChild<QLineEdit *>("portalEmulator")->setText("/synthetic/shadps4");
    dialog.findChild<QLineEdit *>("portalGame")->setText("/synthetic/eboot.bin");
    dialog.findChild<QLineEdit *>("portalSession")->setText(testDirectory.filePath("session-one"));
    dialog.findChild<QLineEdit *>("portalResume")->setText("/synthetic/prior-checkpoint");
    dialog.findChild<QLineEdit *>("portalCheckpointOutput")->setText("/synthetic/new-checkpoint");
    dialog.findChild<QSpinBox *>("portalFigureId")->setValue(123);
    auto *table = dialog.findChild<QTableWidget *>("portalSlots");
    auto button = [&](const char *name) { return dialog.findChild<QPushButton *>(name); };
    int phase = 0;
    QElapsedTimer elapsed;
    elapsed.start();
    QTimer poll;
    QObject::connect(&poll, &QTimer::timeout, &app, [&] {
        if (elapsed.elapsed() > 15000) {
            std::fprintf(stderr, "Portal GUI workflow timeout at phase %d\n", phase);
            app.exit(1);
            return;
        }
        if (phase == 0 && button("portalStart")->isEnabled()) {
            phase++;
            button("portalStart")->click();
        } else if (phase == 1 && button("portalCreate")->isEnabled()) {
            if (button("portalCross")->isEnabled() || button("portalCapture")->isEnabled()) {
                std::fprintf(stderr, "Game tools were enabled for official binary\n");
                app.exit(1);
                return;
            }
            button("portalCross")->click();
            button("portalCapture")->click();
            phase++;
            button("portalCreate")->click();
        } else if (phase == 2 && button("portalInsert")->isEnabled()) {
            phase++;
            button("portalInsert")->click();
        } else if (phase == 3 && button("portalRemove")->isEnabled() && table->item(0, 1)->text() == "123") {
            if (!table->item(0, 4)->text().contains("not acknowledged")) {
                std::fprintf(stderr, "Slot state incorrectly claims acknowledgment\n");
                app.exit(1);
                return;
            }
            phase++;
            dialog.findChild<QSpinBox *>("portalFigureId")->setValue(456);
            button("portalCreate")->click();
        } else if (phase == 4 && button("portalSwap")->isEnabled()) {
            phase++;
            button("portalSwap")->click();
        } else if (phase == 5 && button("portalRemove")->isEnabled() && table->item(0, 1)->text() == "456") {
            phase++;
            button("portalRemove")->click();
        } else if (phase == 6 && button("portalInsert")->isEnabled() && table->item(0, 1)->text() == "—") {
            phase++;
            button("portalInsert")->click();
        } else if (phase == 7 && button("portalCheckpoint")->isEnabled() &&
                   table->item(0, 1)->text() == "456") {
            phase++;
            button("portalCheckpoint")->click();
        } else if (phase == 8 && button("portalReset")->isEnabled()) {
            if (dialog.findChild<QLineEdit *>("portalResume")->text() != "/synthetic/new-checkpoint" ||
                button("portalStop")->isEnabled()) {
                std::fprintf(stderr, "Checkpoint did not stop the emulator and populate resume path\n");
                app.exit(1);
                return;
            }
            phase++;
            button("portalReset")->click();
        } else if (phase == 9 && button("portalStart")->isEnabled()) {
            dialog.findChild<QLineEdit *>("portalEmulator")->setText("/synthetic/shadps4-input-ipc");
            dialog.findChild<QLineEdit *>("portalSession")->setText(testDirectory.filePath("session-two"));
            phase++;
            button("portalStart")->click();
        } else if (phase == 10 && button("portalRemove")->isEnabled() && table->item(0, 1)->text() == "456") {
            auto *duration = dialog.findChild<QSpinBox *>("portalPulseDuration");
            if (!button("portalCross")->isEnabled() || !button("portalCapture")->isEnabled() ||
                duration->minimum() != 10 || duration->maximum() != 2000) {
                std::fprintf(stderr, "Fork capability/bounds incorrect\n");
                app.exit(1);
                return;
            }
            duration->setValue(80);
            dialog.findChild<QCheckBox *>("portalCaptureAfterInput")->setChecked(false);
            phase++;
            button("portalCross")->click();
            if (button("portalCross")->isEnabled() || button("portalCapture")->isEnabled()) {
                std::fprintf(stderr, "Game controls remained enabled during request\n");
                app.exit(1);
                return;
            }
        } else if (phase == 11 && button("portalCapture")->isEnabled()) {
            if (!dialog.findChild<QLabel *>("portalGameFeedback")
                     ->text()
                     .contains("Game response remains unconfirmed")) {
                std::fprintf(stderr, "Input acknowledgment incorrectly described\n");
                app.exit(1);
                return;
            }
            phase++;
            button("portalCapture")->click();
        } else if (phase == 12 && button("portalCapture")->isEnabled() &&
                   !dialog.findChild<QLineEdit *>("portalCapturePath")->text().isEmpty()) {
            auto *preview = dialog.findChild<QLabel *>("portalFramePreview");
            if (preview->pixmap().isNull() ||
                !dialog.findChild<QLabel *>("portalFrameInfo")->text().contains("not live")) {
                std::fprintf(stderr, "Fresh PNG preview missing/not labeled\n");
                app.exit(1);
                return;
            }
            const auto screenshot = qEnvironmentVariable("SKYLANDERS_PORTAL_UI_PREVIEW");
            if (!screenshot.isEmpty() && !dialog.grab().save(screenshot)) {
                std::fprintf(stderr, "Could not save synthetic UI preview\n");
                app.exit(1);
                return;
            }
            dialog.resize(1100, 900);
            dialog.findChild<QCheckBox *>("portalCaptureAfterInput")->setChecked(true);
            phase++;
            button("portalMoveUp")->click();
            if (!dialog.findChild<QLineEdit *>("portalCapturePath")->text().isEmpty() ||
                !preview->pixmap().isNull()) {
                std::fprintf(stderr, "Old snapshot survived a new input\n");
                app.exit(1);
                return;
            }
        } else if (phase == 13 && button("portalCross")->isEnabled() &&
                   dialog.findChild<QLabel *>("portalGameFeedback")->text().contains("CAPTURE_TIMEOUT")) {
            if (button("portalCapture")->isEnabled() ||
                !dialog.findChild<QLineEdit *>("portalCapturePath")->text().isEmpty() ||
                !dialog.findChild<QLabel *>("portalFramePreview")->pixmap().isNull()) {
                std::fprintf(stderr, "Timed-out capture showed stale image or permitted retry\n");
                app.exit(1);
                return;
            }
            phase++;
            button("portalCross")->click();
        } else if (phase == 14 &&
                   dialog.findChild<QLabel *>("portalGameFeedback")->text().contains("IPC_TIMEOUT") &&
                   dialog.findChild<QLabel *>("portalGameCapabilities")
                       ->text()
                       .contains("release unconfirmed")) {
            if (button("portalCross")->isEnabled()) {
                std::fprintf(stderr, "Unconfirmed input release permitted another pulse\n");
                app.exit(1);
                return;
            }
            phase++;
        } else if (phase == 15 && button("portalCross")->isEnabled() &&
                   dialog.findChild<QLabel *>("portalGameFeedback")
                       ->text()
                       .contains("Late input release confirmed")) {
            phase++;
            poll.stop();
            button("portalCross")->click();
            dialog.requestShutdown([&] {
                if (dialog.controllerRunning()) {
                    std::fprintf(stderr, "Controller survived portal shutdown\n");
                    app.exit(1);
                    return;
                }
                std::puts("Portal GUI figure/checkpoint workflow, official capability gating, bounded input "
                          "ACKs, verified PNG preview, capture timeout/stale-frame rejection, late release "
                          "recovery, and owned shutdown during input passed.");
                app.exit(0);
            });
        }
    });
    poll.start(20);
    return app.exec();
}
