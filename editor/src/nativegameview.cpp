#include "nativegameview.h"
#include "nativewindowhost.h"

#include <QCheckBox>
#include <QCloseEvent>
#include <QCursor>
#include <QDockWidget>
#include <QDoubleSpinBox>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QHideEvent>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QMouseEvent>
#include <QPushButton>
#include <QResizeEvent>
#include <QScrollArea>
#include <QSettings>
#include <QSignalBlocker>
#include <QSpinBox>
#include <QToolButton>
#include <QVBoxLayout>
#include <cmath>

NativeGameView::NativeGameView(QWidget *parent) : QDialog(parent, Qt::Window) {
    setObjectName("nativeGameView");
    setWindowTitle("Native game renderer · live shadPS4 window");
    setModal(false);
    resize(1100, 760);
    auto *layout = new QVBoxLayout(this);
    auto *notice = new QLabel("The owned emulator's actual X11 render surface is hosted here, without image "
                              "capture or frame copying. Experimental native camera: exact supported "
                              "game/emulator only. PNG snapshots are a separate fallback.");
    notice->setObjectName("nativeViewNotice");
    notice->setWordWrap(true);
    layout->addWidget(notice);
    auto *controls = new QHBoxLayout;
    capture_ = new QPushButton("Save native PNG");
    capture_->setObjectName("nativeViewCapture");
    fallback_ = new QPushButton("Use PNG fallback");
    fallback_->setObjectName("nativeViewFallback");
    controls->addWidget(fallback_);
    frames_ = new QSpinBox;
    frames_->setObjectName("nativeViewFrameLimit");
    frames_->setRange(1, MaximumAutomaticCaptures);
    frames_->setValue(10);
    frames_->setSuffix(" frames");
    start_ = new QPushButton("Start bounded refresh");
    start_->setObjectName("nativeViewStart");
    stop_ = new QPushButton("Stop refresh");
    stop_->setObjectName("nativeViewStop");
    controls->addWidget(capture_);
    controls->addStretch();
    controls->addWidget(frames_);
    controls->addWidget(start_);
    controls->addWidget(stop_);
    newBatch_ = new QPushButton("New capture batch");
    newBatch_->setObjectName("nativeViewNewBatch");
    controls->addWidget(newBatch_);
    layout->addLayout(controls);
    auto *cameraControls = new QHBoxLayout;
    holdCamera_ = new QPushButton("Free camera");
    holdCamera_->setObjectName("nativeCameraHold");
    holdCamera_->setCheckable(true);
    holdCamera_->setToolTip("WASD / Q/E movement; hold RMB for captured mouse look. Toggle off or Esc to "
                            "restore. No distance tether or collision; distant areas may not be loaded.");
    restoreCamera_ = new QPushButton("Restore game camera");
    restoreCamera_->setObjectName("nativeCameraRestore");
    cameraControls->addWidget(holdCamera_);
    cameraControls->addWidget(restoreCamera_);
    cameraSpeed_ = new QDoubleSpinBox;
    cameraSpeed_->setObjectName("nativeCameraSpeed");
    cameraSpeed_->setRange(.1, 100);
    cameraSpeed_->setDecimals(1);
    cameraSpeed_->setSingleStep(1);
    cameraSpeed_->setPrefix("Speed ");
    cameraSpeed_->setSuffix(" u/s");
    cameraSpeed_->setMaximumWidth(155);
    cameraSpeed_->setKeyboardTracking(false);
    cameraSpeed_->setToolTip("Camera speed in game units per second. Saved between sessions; applies while "
                             "Free camera is active.");
    QSettings settings(QSettings::IniFormat, QSettings::UserScope, "SkylandersReverseEngineering",
                       "LevelWorkshop");
    const double savedSpeed = settings.value("nativeCamera/speed", 5.0).toDouble();
    cameraSpeed_->setValue(std::isfinite(savedSpeed) ? savedSpeed : 5.0);
    connect(cameraSpeed_, qOverload<double>(&QDoubleSpinBox::valueChanged), this, [](double value) {
        QSettings settings(QSettings::IniFormat, QSettings::UserScope, "SkylandersReverseEngineering",
                           "LevelWorkshop");
        settings.setValue("nativeCamera/speed", value);
    });
    cameraControls->addWidget(cameraSpeed_);
    hideUi_ = new QCheckBox("Hide HUD");
    hideUi_->setObjectName("nativeCameraHideUi");
    hideUi_->setToolTip("Experimental native sprite pass switch. Also hides HUD, menus and prompts; restored "
                        "with the camera.");
    cameraControls->addWidget(hideUi_);
    auto *help = new QLabel("WASD · Q/E up/down · RMB look · Esc restore");
    help->setToolTip("Enable Free camera, then click the live view. RMB captures the pointer until release "
                     "or Esc. No collision or distance tether; gamepad and Portal controls remain separate.");
    help->setObjectName("nativeCameraHelp");
    help->setWordWrap(true);
    cameraControls->addWidget(help, 1);
    help->hide();
    restoreCamera_->hide();
    capture_->setText("Screenshot");
    cameraControls->addWidget(capture_);
    cameraControls->addStretch();
    auto *cameraBar = new QWidget;
    cameraBar->setLayout(cameraControls);
    auto *cameraScroll = new QScrollArea;
    cameraScroll->setFrameShape(QFrame::NoFrame);
    cameraScroll->setWidget(cameraBar);
    cameraScroll->setWidgetResizable(true);
    cameraScroll->setFixedHeight(62);
    cameraScroll->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Fixed);
    cameraScroll->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    layout->addWidget(cameraScroll);
    auto *endSession = new QPushButton("Stop");
    endSession->setObjectName("nativeViewStopSession");
    cameraControls->addWidget(endSession);
    connect(endSession, &QPushButton::clicked, this, [this] {
        releaseCameraInput();
        if (requestStop)
            requestStop();
    });
    cameraStatus_ = new QLabel("Camera unavailable until the owned session is ready.");
    cameraStatus_->setObjectName("nativeCameraStatus");
    cameraStatus_->setWordWrap(true);
    layout->addWidget(cameraStatus_);
    budget_ = new QLabel;
    budget_->setObjectName("nativeViewBudget");
    budget_->setWordWrap(true);
    layout->addWidget(budget_);
    liveStatus_ = new QLabel("Waiting for an owned X11 emulator window.");
    liveStatus_->setObjectName("nativeLiveStatus");
    liveStatus_->setWordWrap(true);
    layout->addWidget(liveStatus_);
    live_ = new NativeWindowHost(this);
    live_->installEventFilter(this);
    layout->addWidget(live_, 1);
    live_->hide();
    preview_ = new QLabel;
    preview_->setObjectName("nativeViewImage");
    preview_->setAlignment(Qt::AlignCenter);
    preview_->setTextFormat(Qt::PlainText);
    preview_->setWordWrap(true);
    preview_->setMinimumSize(320, 180);
    preview_->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Expanding);
    preview_->setFocusPolicy(Qt::StrongFocus);
    preview_->installEventFilter(this);
    preview_->setStyleSheet("background:#111820; color:#d3dde7; border:1px solid #435466; padding:4px;");
    layout->addWidget(preview_, 1);
    status_ = new QLabel;
    status_->setObjectName("nativeViewStatus");
    status_->setTextFormat(Qt::PlainText);
    status_->setWordWrap(true);
    layout->addWidget(status_);
    metadata_ = new QLabel;
    metadata_->setObjectName("nativeViewMetadata");
    metadata_->setTextFormat(Qt::PlainText);
    metadata_->setWordWrap(true);
    layout->addWidget(metadata_);
    path_ = new QLineEdit;
    path_->setObjectName("nativeViewPath");
    path_->setReadOnly(true);
    path_->setPlaceholderText("Verified screenshot in the owned session");
    layout->addWidget(path_);
    refresh_.setSingleShot(true);
    refresh_.setInterval(1000);
    refresh_.setTimerType(Qt::PreciseTimer); // Never intentionally fire before the one-second cadence.
    connect(&refresh_, &QTimer::timeout, this, [this] { requestNextFrame(); });
    connect(capture_, &QPushButton::clicked, this, [this] { captureManually(); });
    connect(start_, &QPushButton::clicked, this, [this] {
        if (!available_ || controllerBusy_ || capturing_ || !isVisible() ||
            automaticCaptures_ >= MaximumAutomaticCaptures)
            return;
        remaining_ = qMin(frames_->value(), MaximumAutomaticCaptures - automaticCaptures_);
        refreshing_ = true;
        updateControls();
        requestNextFrame();
    });
    connect(stop_, &QPushButton::clicked, this, [this] {
        stopRefresh(capturing_ ? "Refresh stopped. The already-sent capture may still complete."
                               : "Refresh stopped.");
    });
    connect(fallback_, &QPushButton::clicked, this, [this] {
        releaseCameraInput();
        stopRefresh("Display mode changed.");
        snapshotFallback_ = !snapshotFallback_;
        updateLiveHost();
    });
    movement_.setInterval(33);
    movement_.setTimerType(Qt::PreciseTimer);
    connect(&movement_, &QTimer::timeout, this, [this] { moveCamera(); });
    movement_.start();
    heartbeat_.setInterval(2000);
    heartbeat_.setTimerType(Qt::PreciseTimer);
    connect(&heartbeat_, &QTimer::timeout, this, [this] { renewCameraLease(); });
    cameraCapture_.setSingleShot(true);
    cameraCapture_.setTimerType(Qt::PreciseTimer);
    connect(&cameraCapture_, &QTimer::timeout, this, [this] { captureAfterCamera(); });
    connect(holdCamera_, &QPushButton::clicked, this, [this] {
        if (cameraHeld_ || cameraPending_) {
            releaseCameraInput();
            return;
        }
        if (!cameraAvailable_ || controllerBusy_ || cameraPending_ || cameraHeld_ || !isVisible())
            return;
        stopRefresh(liveAttached()
                        ? "Native live surface: camera commands do not capture or encode images."
                        : "PNG fallback: automatic snapshots follow movement at most once per second.");
        restoreRequested_ = false;
        dispatchCamera("portal_camera_enable", {{"durationMs", 8000}, {"hideUi", hideUi_->isChecked()}});
        cameraInputSurface()->setFocus();
        updateControls();
    });
    connect(restoreCamera_, &QPushButton::clicked, this, [this] { releaseCameraInput(); });
    connect(hideUi_, &QCheckBox::toggled, this, [this](bool hidden) {
        if (!cameraHeld_ || restoreRequested_)
            return;
        if (cameraPending_ || controllerBusy_) {
            queuedUi_ = hidden;
            return;
        }
        dispatchCamera("portal_camera_ui", {{"hidden", hidden}});
    });
    connect(newBatch_, &QPushButton::clicked, this, [this] {
        if (controllerBusy_ || capturing_ || refreshing_ || cameraHeld_ || cameraPending_)
            return;
        automaticCaptures_ = 0;
        remaining_ = 0;
        status_->setText(
            "New bounded capture batch authorized. Existing PNGs are retained; the emulator stays running.");
        updateControls();
    });
    for (auto *button : {capture_, start_, stop_, holdCamera_, restoreCamera_, newBatch_, fallback_})
        button->setAutoDefault(false);
    auto *details = new QWidget;
    details->setObjectName("nativeViewDetails");
    auto *detailsLayout = new QVBoxLayout(details);
    auto *detailsBody = new QWidget;
    auto *detailsContents = new QVBoxLayout(detailsBody);
    auto *detailsToggle = new QToolButton;
    detailsToggle->setText("Settings");
    detailsToggle->setToolTip("Capture settings and diagnostics");
    detailsToggle->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    detailsToggle->setArrowType(Qt::RightArrow);
    detailsToggle->setCheckable(true);
    detailsLayout->addWidget(detailsToggle);
    layout->removeItem(controls);
    controls->setParent(nullptr);
    detailsContents->addLayout(controls);
    for (auto *widget : std::initializer_list<QWidget *>{notice, budget_, status_, metadata_, path_}) {
        layout->removeWidget(widget);
        detailsContents->addWidget(widget);
    }
    detailsLayout->addWidget(detailsBody);
    detailsBody->hide();
    connect(detailsToggle, &QToolButton::toggled, this, [detailsBody, detailsToggle](bool open) {
        detailsBody->setVisible(open);
        detailsToggle->setArrowType(open ? Qt::DownArrow : Qt::RightArrow);
    });
    layout->addWidget(details);
    clearFrame("No verified game snapshot yet.");
    updateControls();
}

NativeGameView::~NativeGameView() {
    releaseCameraInput();
    live_->detach();
}
bool NativeGameView::liveAttached() const { return live_->attached(); }
QWidget *NativeGameView::cameraInputSurface() const {
    return liveAttached() ? static_cast<QWidget *>(live_) : static_cast<QWidget *>(preview_);
}
void NativeGameView::setOwnedSession(qint64 controllerPid, qint64 emulatorPid, const QString &emulator) {
    controllerPid_ = controllerPid;
    emulatorPid_ = emulatorPid;
    emulatorPath_ = emulator;
    updateLiveHost();
}
void NativeGameView::updateLiveHost() {
    QString error;
    if (!emulatorPid_ || snapshotFallback_)
        live_->detach();
    else if (isVisible())
        live_->attachOwned(controllerPid_, emulatorPid_, emulatorPath_, error);
    const bool live = liveAttached();
    live_->setVisible(live);
    preview_->setVisible(!live);
    liveStatus_->setToolTip(live ? QString("Owned PID %1 · X11 0x%2 · original SDL/Vulkan surface, no PNG "
                                           "loop. Camera commands are serialized separately.")
                                       .arg(emulatorPid_)
                                       .arg(live_->hostedWindow(), 0, 16)
                                 : error);
    liveStatus_->setText(live                ? "Live"
                         : snapshotFallback_ ? "Snapshot"
                         : error.isEmpty() || error.startsWith("Waiting")
                             ? "Starting…"
                             : "Live view unavailable — see Settings");
    if (!live && !error.isEmpty())
        status_->setText(error);
    fallback_->setText(snapshotFallback_ ? "Use live native window" : "Use PNG fallback");
    if (live) {
        refresh_.stop();
        cameraCapture_.stop();
        refreshing_ = false;
        remaining_ = 0;
    }
    updateControls();
}

void NativeGameView::setCaptureAvailability(bool available, bool controllerBusy, const QString &reason,
                                            bool motionBusy) {
    available_ = available;
    controllerBusy_ = controllerBusy;
    motionBusy_ = motionBusy;
    unavailableReason_ = reason;
    if (!available_ && refreshing_)
        stopRefresh(reason);
    updateControls();
}

void NativeGameView::requestNextFrame() {
    if (!refreshing_)
        return;
    if (!isVisible() || !available_) {
        stopRefresh(unavailableReason_.isEmpty() ? "Refresh stopped." : unavailableReason_);
        return;
    }
    if (remaining_ <= 0 || automaticCaptures_ >= MaximumAutomaticCaptures) {
        stopRefresh("Automatic capture limit reached. No further refresh requests will be sent.");
        return;
    }
    if (controllerBusy_ || capturing_) {
        status_->setText("Waiting for the current portal request. No capture requests overlap.");
        refresh_.start();
        return;
    }
    // A stop/restart or reopen must not bypass the automatic cadence limit.
    if (sinceCompletion_.isValid() && sinceCompletion_.elapsed() < 1000) {
        refresh_.start(int(1000 - sinceCompletion_.elapsed()));
        return;
    }
    // Count requests, not successes: failures also consume the finite archive budget.
    ++automaticCaptures_;
    --remaining_;
    if (!requestCapture || !requestCapture()) {
        --automaticCaptures_;
        ++remaining_;
        stopRefresh("Capture was not accepted. Refresh stopped.");
    }
    updateControls();
}

void NativeGameView::captureStarted() {
    refresh_.stop();
    cameraCapture_.stop();
    capturing_ = true;
    status_->setText("Waiting for a fresh native frame and PNG verification…");
    updateControls();
}

void NativeGameView::presentFrame(const QImage &image, const QString &metadata, const QString &path,
                                  qint64 latencyMs) {
    sinceCompletion_.start();
    capturing_ = false;
    image_ = image;
    path_->setText(path);
    path_->setToolTip(path);
    metadata_->setText(metadata + QString("\nCapture + transfer + verification: %1 ms. Display preview is "
                                          "limited to 1280 × 720; source PNG is retained.")
                                      .arg(latencyMs));
    status_->setText(
        "Verified native game snapshot. Not live video; camera movement is applied in the owned game.");
    resizeFrame();
    if (refreshing_) {
        if (remaining_ <= 0 || automaticCaptures_ >= MaximumAutomaticCaptures)
            stopRefresh("Bounded refresh completed. Snapshots remain in the owned session.");
        else if (isVisible() && available_)
            refresh_.start(); // One second AFTER completion, never a claimed frame rate.
        else
            stopRefresh("Refresh stopped.");
    }
    updateControls();
}

void NativeGameView::clearFrame(const QString &message) {
    image_ = {};
    preview_->setPixmap(QPixmap());
    preview_->setText(message);
    path_->clear();
    metadata_->clear();
}

void NativeGameView::captureFailed(const QString &message) {
    capturing_ = false;
    clearFrame("No fresh verified game snapshot.");
    stopRefresh(message);
    releaseCameraInput();
}

void NativeGameView::stopRefresh(const QString &message) {
    refresh_.stop();
    refreshing_ = false;
    remaining_ = 0;
    status_->setText(message);
    updateControls();
}

void NativeGameView::resetSession() {
    manualCaptureDue_ = false;
    heartbeat_.stop();
    heartbeatDue_ = false;
    queuedUi_.reset();
    pendingCameraOperation_.clear();
    stopMouseLook();
    controllerPid_ = emulatorPid_ = 0;
    live_->detach();
    live_->hide();
    preview_->show();
    refresh_.stop();
    cameraCapture_.stop();
    refreshing_ = false;
    capturing_ = false;
    available_ = false;
    controllerBusy_ = false;
    remaining_ = 0;
    automaticCaptures_ = 0;
    cameraAvailable_ = cameraHeld_ = cameraPending_ = restoreRequested_ = looking_ = false;
    heldKeys_.clear();
    mouseAngles_ = {};
    cameraStatus_->setText("Camera unavailable until the owned session is ready.");
    sinceCompletion_.invalidate();
    clearFrame("No verified game snapshot in this session.");
    status_->setText("Start an owned session with native capture support.");
    updateControls();
}

void NativeGameView::updateControls() {
    const bool idle = available_ && !controllerBusy_ && !capturing_;
    const bool motion = motionBusy_ || (cameraPending_ && (pendingCameraOperation_ == "portal_camera_move" ||
                                                           pendingCameraOperation_ == "portal_camera_renew"));
    capture_->setEnabled(available_ && (!controllerBusy_ || motion) && !capturing_ && !refreshing_ &&
                         !manualCaptureDue_);
    start_->setEnabled(idle && !liveAttached() && !refreshing_ &&
                       automaticCaptures_ < MaximumAutomaticCaptures);
    stop_->setEnabled(refreshing_);
    frames_->setEnabled(!refreshing_ && !capturing_);
    holdCamera_->setEnabled(cameraHeld_
                                ? !restoreRequested_
                                : idle && cameraAvailable_ && !cameraPending_ &&
                                      (liveAttached() || automaticCaptures_ < MaximumAutomaticCaptures));
    {
        const QSignalBlocker blocker(holdCamera_);
        holdCamera_->setChecked((cameraHeld_ || pendingCameraOperation_ == "portal_camera_enable") &&
                                !restoreRequested_);
    }
    restoreCamera_->setEnabled((cameraHeld_ || cameraPending_) && !restoreRequested_);
    hideUi_->setEnabled(available_ && cameraAvailable_ && (!cameraPending_ || motion || cameraHeld_) &&
                        !restoreRequested_);
    newBatch_->setEnabled(idle && !refreshing_ && !cameraHeld_ && !cameraPending_ && automaticCaptures_ > 0);
    budget_->setText(QString("At least 1 s after each completed capture; slower captures reduce the cadence. "
                             "Automatic requests: %1 / %2 this batch. After Restore, New capture batch "
                             "explicitly resets the budget without restarting the emulator or deleting PNGs.")
                         .arg(automaticCaptures_)
                         .arg(MaximumAutomaticCaptures));
    capture_->setToolTip(available_ ? "One verified game-only PNG snapshot." : unavailableReason_);
    start_->setToolTip(available_ ? "Finite capture sequence, not a live stream. Reopening this window does "
                                    "not reset the capture budget."
                                  : unavailableReason_);
    budget_->setVisible(!liveAttached());
    frames_->setVisible(!liveAttached());
    start_->setVisible(!liveAttached());
    stop_->setVisible(!liveAttached());
    newBatch_->setVisible(!liveAttached());
    fallback_->setEnabled(!cameraHeld_ && !cameraPending_ && !capturing_);
}

void NativeGameView::resizeFrame() {
    if (image_.isNull())
        return;
    const QSize size = preview_->contentsRect().size() - QSize(10, 10);
    if (size.width() > 0 && size.height() > 0)
        preview_->setPixmap(
            QPixmap::fromImage(image_).scaled(size, Qt::KeepAspectRatio, Qt::SmoothTransformation));
}
void NativeGameView::resizeEvent(QResizeEvent *event) {
    QDialog::resizeEvent(event);
    resizeFrame();
}
void NativeGameView::closeEvent(QCloseEvent *event) {
    releaseCameraInput();
    if (isWindow())
        live_->detach();
    stopRefresh(
        capturing_
            ? "Window closed. An already-sent capture may still complete; no new captures will be requested."
            : "Window closed. Refresh stopped.");
    QDialog::closeEvent(event);
}
void NativeGameView::hideEvent(QHideEvent *event) {
    // Escape/reject and parent-window hiding may bypass closeEvent.
    heldKeys_.clear();
    mouseAngles_ = {};
    stopMouseLook();
    const auto *dock = qobject_cast<QDockWidget *>(parentWidget());
    if (isWindow() || (dock && dock->isHidden()))
        releaseCameraInput();
    // Tab changes keep the SDL child embedded. Returning it to root here
    // would unexpectedly open a separate game window.
    if (isWindow())
        live_->detach();
    stopRefresh(capturing_ ? "View hidden. An already-sent capture may still complete; refresh is stopped."
                           : "View hidden. Refresh stopped.");
    QDialog::hideEvent(event);
}

void NativeGameView::setCameraState(bool available, bool held, int remainingMs, const QString &reason,
                                    bool uiHidden) {
    Q_UNUSED(remainingMs);
    const bool started = held && !cameraHeld_;
    cameraAvailable_ = available;
    cameraHeld_ = held;
    const QString label = held ? "Free camera" : available ? "Game camera" : reason;
    if (lastCameraLabel_ != label) {
        lastCameraLabel_ = label;
        cameraStatus_->setText(label);
    }
    cameraStatus_->setVisible(!available && (reason.contains("failed", Qt::CaseInsensitive) ||
                                             reason.contains("fault", Qt::CaseInsensitive)));
    cameraStatus_->setToolTip("Active until Restore, Esc or close. An 8-second watchdog restores safely if "
                              "the editor heartbeat stops. " +
                              reason);
    if (started) {
        sinceMovement_.start();
        heartbeatDue_ = false;
        heartbeat_.start();
    }
    if (!held) {
        cameraCapture_.stop();
        heldKeys_.clear();
        mouseAngles_ = {};
        stopMouseLook();
        if (!cameraPending_)
            restoreRequested_ = false;
    }
    if (!held) {
        heartbeat_.stop();
        heartbeatDue_ = false;
        queuedUi_.reset();
    } else if (!queuedUi_ && pendingCameraOperation_ != "portal_camera_ui") {
        const QSignalBlocker blocker(hideUi_);
        hideUi_->setChecked(uiHidden);
    }
    updateControls();
}
void NativeGameView::releaseCameraInput() {
    heartbeat_.stop();
    heartbeatDue_ = false;
    queuedUi_.reset();
    cameraCapture_.stop();
    heldKeys_.clear();
    mouseAngles_ = {};
    stopMouseLook();
    if ((cameraHeld_ || cameraPending_) && !restoreRequested_) {
        restoreRequested_ = true;
        cameraStatus_->setText("Restoring the normal game camera after the current request…");
        if (requestCameraRestore)
            requestCameraRestore();
    }
    updateControls();
}
void NativeGameView::cameraActionFinished(bool success, const QString &message) {
    cameraPending_ = false;
    pendingCameraOperation_.clear();
    if (!success) {
        cameraStatus_->setText(message);
        cameraStatus_->show();
        releaseCameraInput();
    } else if (cameraHeld_ && !restoreRequested_ && isVisible()) {
        if (queuedUi_) {
            const bool value = *queuedUi_;
            queuedUi_.reset();
            dispatchCamera("portal_camera_ui", {{"hidden", value}});
        } else if (heartbeatDue_)
            renewCameraLease();
        else if (manualCaptureDue_)
            captureManually();
        else
            captureAfterCamera();
    }
    updateControls();
}
void NativeGameView::captureManually() {
    if (!available_ || capturing_ || !isVisible())
        return;
    manualCaptureDue_ = true;
    if (controllerBusy_ || cameraPending_) {
        updateControls();
        return;
    }
    manualCaptureDue_ = false;
    if (requestCapture)
        requestCapture();
    updateControls();
}
bool NativeGameView::dispatchCamera(const QString &operation, const QJsonObject &arguments) {
    cameraPending_ = true;
    pendingCameraOperation_ = operation;
    updateControls();
    if (requestCamera && requestCamera(operation, arguments))
        return true;
    cameraPending_ = false;
    pendingCameraOperation_.clear();
    updateControls();
    return false;
}
void NativeGameView::renewCameraLease() {
    if (!cameraHeld_ || restoreRequested_)
        return;
    heartbeatDue_ = true;
    if (cameraPending_ || controllerBusy_ || capturing_)
        return;
    if (dispatchCamera("portal_camera_renew", {{"durationMs", 8000}}))
        heartbeatDue_ = false;
}
void NativeGameView::captureAfterCamera() {
    if (liveAttached())
        return; // Real native frames require no capture requests or archival budget.
    if (!cameraHeld_ || restoreRequested_ || !isVisible() || !available_)
        return;
    if (automaticCaptures_ >= MaximumAutomaticCaptures) {
        releaseCameraInput();
        cameraStatus_->setText("Automatic snapshot budget exhausted. After Restore, click New capture batch "
                               "to continue without restarting the emulator.");
        return;
    }
    if (controllerBusy_ || capturing_ || cameraPending_) {
        cameraCapture_.start(100);
        return;
    }
    if (sinceCompletion_.isValid() && sinceCompletion_.elapsed() < 1000) {
        cameraCapture_.start(int(1000 - sinceCompletion_.elapsed()));
        return;
    }
    ++automaticCaptures_;
    if (!requestCapture || !requestCapture())
        --automaticCaptures_;
    updateControls();
}
void NativeGameView::moveCamera() {
    if (!cameraAvailable_ || !cameraHeld_ || cameraPending_ || restoreRequested_ || controllerBusy_ ||
        capturing_ || !isVisible() || !cameraInputSurface()->hasFocus())
        return;
    const double right = int(heldKeys_.contains(Qt::Key_D)) - int(heldKeys_.contains(Qt::Key_A));
    const double up = int(heldKeys_.contains(Qt::Key_E)) - int(heldKeys_.contains(Qt::Key_Q));
    const double forward = int(heldKeys_.contains(Qt::Key_W)) - int(heldKeys_.contains(Qt::Key_S));
    const double norm = std::hypot(right, up, forward);
    if (norm == 0 && mouseAngles_.isNull()) {
        sinceMovement_.restart();
        return;
    }
    if (heartbeatDue_) {
        renewCameraLease();
        return;
    }
    if (manualCaptureDue_) {
        captureManually();
        return;
    }
    // Keep each transaction below the backend's five-unit bound, even at the
    // highest speed after a stalled frame. There is no cumulative travel cap.
    const double distance = qMin(
        4.99, cameraSpeed_->value() *
                  qBound(1LL, sinceMovement_.isValid() ? sinceMovement_.elapsed() : 33LL, 100LL) / 1000.0);
    QJsonObject step{{"right", norm ? distance * right / norm : 0},
                     {"up", norm ? distance * up / norm : 0},
                     {"forward", norm ? distance * forward / norm : 0},
                     {"yaw", mouseAngles_.x()},
                     {"pitch", mouseAngles_.y()}};
    mouseAngles_ = {};
    if (dispatchCamera("portal_camera_move", step))
        sinceMovement_.restart();
}
bool NativeGameView::eventFilter(QObject *watched, QEvent *event) {
    if (watched != preview_ && watched != live_)
        return QDialog::eventFilter(watched, event);
    auto *surface = static_cast<QWidget *>(watched);
    if (event->type() == QEvent::FocusOut) {
        heldKeys_.clear();
        mouseAngles_ = {};
        stopMouseLook();
    }
    if (event->type() == QEvent::KeyPress || event->type() == QEvent::KeyRelease) {
        auto *key = static_cast<QKeyEvent *>(event);
        if (key->key() == Qt::Key_Escape && (cameraHeld_ || cameraPending_)) {
            if (event->type() == QEvent::KeyPress)
                releaseCameraInput();
            return true;
        }
        if (cameraHeld_ &&
            QSet<int>{Qt::Key_W, Qt::Key_A, Qt::Key_S, Qt::Key_D, Qt::Key_Q, Qt::Key_E}.contains(
                key->key())) {
            if (!key->isAutoRepeat()) {
                if (event->type() == QEvent::KeyPress)
                    heldKeys_.insert(key->key());
                else
                    heldKeys_.remove(key->key());
            }
            return true;
        }
    }
    if (event->type() == QEvent::MouseButtonPress) {
        auto *mouse = static_cast<QMouseEvent *>(event);
        surface->setFocus();
        if (cameraHeld_ && mouse->button() == Qt::RightButton) {
            looking_ = true;
            lastMouse_ = mouse->position();
            // Only a physical press captures/warps the pointer. Synthetic UI
            // tests never alter the user's desktop pointer.
            relativeLook_ = mouse->spontaneous() && liveAttached();
            if (relativeLook_) {
                surface->grabMouse(Qt::BlankCursor);
                lastMouse_ = surface->rect().center();
                QCursor::setPos(surface->mapToGlobal(lastMouse_.toPoint()));
            } else
                surface->setCursor(Qt::ClosedHandCursor);
            return true;
        }
    }
    if (event->type() == QEvent::MouseMove && looking_) {
        auto *mouse = static_cast<QMouseEvent *>(event);
        const auto delta = mouse->position() - lastMouse_;
        if (relativeLook_) {
            if (delta.isNull())
                return true;
            QCursor::setPos(surface->mapToGlobal(lastMouse_.toPoint()));
        } else
            lastMouse_ = mouse->position();
        mouseAngles_.setX(qBound(-30.0, mouseAngles_.x() - delta.x() * .18, 30.0));
        mouseAngles_.setY(qBound(-30.0, mouseAngles_.y() - delta.y() * .18, 30.0));
        return true;
    }
    if (event->type() == QEvent::MouseButtonRelease &&
        static_cast<QMouseEvent *>(event)->button() == Qt::RightButton) {
        stopMouseLook();
        return true;
    }
    return QDialog::eventFilter(watched, event);
}
void NativeGameView::stopMouseLook() {
    if (relativeLook_) {
        auto *grabber = QWidget::mouseGrabber();
        if (grabber == live_ || grabber == preview_)
            grabber->releaseMouse();
    }
    relativeLook_ = false;
    looking_ = false;
    live_->unsetCursor();
    preview_->unsetCursor();
}
void NativeGameView::keyPressEvent(QKeyEvent *event) {
    if (event->key() == Qt::Key_Escape && (cameraHeld_ || cameraPending_)) {
        releaseCameraInput();
        event->accept();
        return;
    }
    if (event->key() == Qt::Key_Escape && !isWindow()) {
        event->accept();
        return;
    }
    QDialog::keyPressEvent(event);
}
