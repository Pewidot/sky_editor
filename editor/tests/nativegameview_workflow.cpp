#include "nativegameview.h"

#include <QApplication>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QSpinBox>
#include <QTimer>
#include <cstdio>

int main(int argc, char **argv) {
    QApplication app(argc, argv);
    app.setQuitOnLastWindowClosed(false);
    NativeGameView view;
    auto button = [&](const char *name) { return view.findChild<QPushButton *>(name); };
    auto *limit = view.findChild<QSpinBox *>("nativeViewFrameLimit");
    auto *image = view.findChild<QLabel *>("nativeViewImage");
    auto *path = view.findChild<QLineEdit *>("nativeViewPath");
    QImage frame(160, 90, QImage::Format_RGB32);
    frame.fill(Qt::green);
    auto wait = [](int ms) {
        QEventLoop loop;
        QTimer::singleShot(ms, &loop, &QEventLoop::quit);
        loop.exec();
    };
    auto require = [](bool ok, const char *message) {
        if (!ok)
            std::fprintf(stderr, "%s\n", message);
        return ok;
    };
    view.show();
    wait(10);
    if (!require(view.isWindow() && !view.isModal() && !button("nativeViewStart")->isEnabled() &&
                     limit->maximum() == 30,
                 "Initial native-view capability/budget gating failed"))
        return 1;
    int requests = 0, inFlight = 0, maxInFlight = 0, delay = 40;
    bool failed = false;
    QElapsedTimer lastCompletion;
    view.requestCapture = [&] {
        if (view.refreshing() && lastCompletion.isValid() && lastCompletion.elapsed() < 999)
            failed = true;
        ++requests;
        ++inFlight;
        maxInFlight = qMax(maxInFlight, inFlight);
        view.captureStarted();
        view.clearFrame("Pending synthetic native frame");
        QTimer::singleShot(delay, &view, [&] {
            --inFlight;
            lastCompletion.start();
            view.presentFrame(frame, "Synthetic snapshot — not live", "/synthetic/verified.png", delay);
        });
        return true;
    };
    view.setCaptureAvailability(true, false, {});
    limit->setValue(2);
    button("nativeViewStart")->click();
    wait(1250);
    if (!require(!failed && requests == 2 && maxInFlight == 1 && !view.refreshing() &&
                     !image->pixmap().isNull() && path->text() == "/synthetic/verified.png" &&
                     view.findChild<QLabel *>("nativeViewMetadata")->text().contains("40 ms"),
                 "Bounded two-frame cadence, serialization or presentation failed"))
        return 1;
    // A completed capture blocks a rapid new burst for the remainder of one second.
    button("nativeViewStart")->click();
    wait(50);
    if (!require(requests == 2, "Restart bypassed the one-second completion cadence"))
        return 1;
    button("nativeViewStop")->click();
    wait(1050);
    if (!require(requests == 2 && !view.refreshing(), "Stop did not cancel scheduled refresh"))
        return 1;
    // Busy portal requests postpone the refresh rather than overlap it.
    view.setCaptureAvailability(true, true, {});
    button("nativeViewStart")->click();
    wait(20);
    if (!require(requests == 2, "Native capture overlapped a busy controller"))
        return 1;
    view.setCaptureAvailability(true, false, {});
    delay = 1500;
    limit->setValue(2);
    button("nativeViewStart")->click();
    wait(1100);
    if (!require(requests == 3 && inFlight == 1, "Slow capture overlapped a subsequent request"))
        return 1;
    view.close();
    wait(1650);
    if (!require(requests == 3 && inFlight == 0 && !view.refreshing(),
                 "Closing during a capture scheduled another request"))
        return 1;
    const int priorCount = view.automaticCaptureCount();
    view.show();
    wait(10);
    if (!require(view.automaticCaptureCount() == priorCount && !view.refreshing(),
                 "Reopen reset the session budget or restarted refresh"))
        return 1;
    delay = 40;
    button("nativeViewStart")->click();
    wait(100);
    view.captureFailed("Synthetic capture fault");
    wait(1100);
    if (!require(requests == 4 && !view.refreshing() && image->pixmap().isNull() && path->text().isEmpty(),
                 "Fault did not stop refresh and clear old image"))
        return 1;
    button("nativeViewStart")->click();
    wait(100);
    QKeyEvent escape(QEvent::KeyPress, Qt::Key_Escape, Qt::NoModifier);
    QApplication::sendEvent(&view, &escape);
    wait(1100);
    if (!require(requests == 5 && !view.isVisible() && !view.refreshing(),
                 "Escape left hidden automatic refresh running"))
        return 1;
    // Repeated short bursts share one hard limit, including closed/reopened windows.
    view.show();
    limit->setValue(1);
    for (int count = view.automaticCaptureCount(); count < NativeGameView::MaximumAutomaticCaptures;
         ++count) {
        button("nativeViewStart")->click();
        QElapsedTimer timeout;
        timeout.start();
        while (view.refreshing() && timeout.elapsed() < 1500)
            wait(10);
        if (!require(!view.refreshing() && view.automaticCaptureCount() == count + 1,
                     "Finite session budget did not progress correctly"))
            return 1;
    }
    const int total = requests;
    button("nativeViewStart")->click();
    wait(1100);
    if (!require(!failed && maxInFlight == 1 && view.automaticCaptureCount() == 30 && requests == total &&
                     !button("nativeViewStart")->isEnabled(),
                 "Session cap, monotonic cadence or no-overlap invariant failed"))
        return 1;
    view.setCameraState(true, true, 1000, {});
    if (!require(!button("nativeViewNewBatch")->isEnabled(),
                 "Capture budget could reset while native camera was held"))
        return 1;
    view.setCameraState(true, false, 0, "Restored");
    button("nativeViewNewBatch")->click();
    if (!require(view.automaticCaptureCount() == 0 && button("nativeViewStart")->isEnabled(),
                 "Explicit idle/restored batch reset incorrectly required an emulator restart"))
        return 1;
    view.resetSession();
    lastCompletion.invalidate();
    if (!require(view.automaticCaptureCount() == 0 && !button("nativeViewStart")->isEnabled() &&
                     image->pixmap().isNull(),
                 "New-session reset retained old capability, frame or budget"))
        return 1;
    view.setCaptureAvailability(true, false, {});
    limit->setValue(2);
    button("nativeViewStart")->click();
    wait(100);
    view.setCaptureAvailability(false, false, "Owned emulator stopped");
    wait(1100);
    if (!require(requests == total + 1 && !view.refreshing() && !button("nativeViewCapture")->isEnabled(),
                 "Emulator stop failed to disable and stop refresh"))
        return 1;
    std::puts("Detached native view: honest labels, verified-frame handoff, serialized >=1s completion "
              "cadence, slow capture, stop/close/Escape/fault, persistent 30-request session cap and session "
              "reset passed (synthetic frames only).");
    return 0;
}
