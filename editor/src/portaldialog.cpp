#include "portaldialog.h"
#include "nativegameview.h"

#include <QBuffer>
#include <QCheckBox>
#include <QCloseEvent>
#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QGridLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QImageReader>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QRegularExpression>
#include <QResizeEvent>
#include <QSignalBlocker>
#include <QSpinBox>
#include <QTableWidget>
#include <QToolButton>
#include <QUuid>
#include <QVBoxLayout>

QString PortalDialog::newSessionPath() {
    return QDir::temp().filePath("skylanders-portal-" +
                                 QDateTime::currentDateTime().toString("yyyyMMdd-HHmmss-") +
                                 QUuid::createUuid().toString(QUuid::Id128).left(8));
}

PortalDialog::PortalDialog(BackendConfig config, QWidget *parent, const QString &controllerOverride)
    : QDialog(parent), config_(std::move(config)) {
    setWindowTitle("Virtual Portal of Power · shadPS4");
    resize(1080, 640);
    controller_ = controllerOverride.isEmpty()
                      ? QFileInfo(config_.script).absoluteDir().filePath("portal_controller.mjs")
                      : controllerOverride;
    auto *layout = new QVBoxLayout(this);
    const auto fold = [layout, this](const QString &title, const QString &name) {
        auto *toggle = new QToolButton(this);
        toggle->setText(title);
        toggle->setObjectName(name);
        toggle->setCheckable(true);
        toggle->setArrowType(Qt::RightArrow);
        toggle->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
        layout->addWidget(toggle);
        auto *body = new QWidget(this);
        auto *contents = new QVBoxLayout(body);
        contents->setContentsMargins(8, 0, 8, 0);
        layout->addWidget(body);
        body->hide();
        connect(toggle, &QToolButton::toggled, this, [body, toggle](bool open) {
            body->setVisible(open);
            toggle->setArrowType(open ? Qt::DownArrow : Qt::RightArrow);
        });
        return contents;
    };
    auto *settings = fold("Settings", "portalSettingsToggle");
    auto *notice =
        new QLabel("Launch a prepared disposable game tree with an isolated shadPS4 profile. Figure files "
                   "are copied before game writes. Slot state below records commands sent, not confirmation "
                   "that the game recognized a figure. See docs/PORTAL.md for prerequisites.");
    notice->setWordWrap(true);
    notice->setStyleSheet("color: #956300; padding: 5px;");
    setToolTip(notice->text());
    delete notice;
    auto *form = new QFormLayout;
    auto fileRow = [this](QLineEdit *&field, const QString &objectName, const QString &dialogTitle,
                          bool directory) {
        auto *row = new QWidget;
        auto *line = new QHBoxLayout(row);
        line->setContentsMargins(0, 0, 0, 0);
        field = new QLineEdit;
        field->setObjectName(objectName);
        auto *browse = new QPushButton(directory ? "Choose parent…" : "Browse…");
        line->addWidget(field, 1);
        line->addWidget(browse);
        connect(browse, &QPushButton::clicked, this, [this, field, dialogTitle, directory] {
            const QString selected = directory ? QFileDialog::getExistingDirectory(this, dialogTitle)
                                               : QFileDialog::getOpenFileName(this, dialogTitle);
            if (!selected.isEmpty())
                field->setText(directory ? QDir(selected).filePath(QFileInfo(newSessionPath()).fileName())
                                         : selected);
        });
        connect(field, &QLineEdit::textChanged, this, [this] { updateControls(); });
        return row;
    };
    form->addRow("shadPS4 executable",
                 fileRow(emulator_, "portalEmulator", "Select shadPS4 executable", false));
    form->addRow("Prepared game eboot",
                 fileRow(game_, "portalGame", "Select disposable game eboot.bin / eboot.elf", false));
    form->addRow("New session directory",
                 fileRow(session_, "portalSession", "Choose parent for a new isolated session", true));
    auto *resumeRow = new QWidget;
    auto *resumeLayout = new QHBoxLayout(resumeRow);
    resumeLayout->setContentsMargins(0, 0, 0, 0);
    resume_ = new QLineEdit;
    resume_->setObjectName("portalResume");
    resume_->setPlaceholderText("Optional saved-profile checkpoint directory (not a RAM savestate)");
    auto *resumeBrowse = new QPushButton("Browse…");
    resumeLayout->addWidget(resume_, 1);
    resumeLayout->addWidget(resumeBrowse);
    connect(resumeBrowse, &QPushButton::clicked, this, [this] {
        const auto path = QFileDialog::getExistingDirectory(
            this, "Select saved-profile checkpoint containing checkpoint.json");
        if (!path.isEmpty())
            resume_->setText(path);
    });
    form->addRow("Resume checkpoint", resumeRow);
    x11_ = new QCheckBox("Force SDL X11 (required for live host)");
    x11_->setObjectName("portalX11");
    x11_->setChecked(true);
    form->addRow("Display", x11_);
    settings->addLayout(form);
    auto *launch = new QHBoxLayout;
    start_ = new QPushButton("Start");
    start_->setObjectName("portalStart");
    stop_ = new QPushButton("Stop");
    stop_->setObjectName("portalStop");
    reset_ = new QPushButton("New session");
    reset_->setObjectName("portalReset");
    launch->addWidget(start_);
    launch->addWidget(stop_);
    launch->addWidget(reset_);
    launch->addStretch();
    layout->addLayout(launch);
    auto *checkpointRow = new QHBoxLayout;
    checkpointOutput_ = new QLineEdit;
    checkpointOutput_->setObjectName("portalCheckpointOutput");
    checkpointOutput_->setPlaceholderText("New checkpoint directory; parent must exist");
    auto *checkpointBrowse = new QPushButton("Choose parent…");
    checkpoint_ = new QPushButton("Stop & save checkpoint");
    checkpoint_->setObjectName("portalCheckpoint");
    checkpointRow->addWidget(checkpointOutput_, 1);
    checkpointRow->addWidget(checkpointBrowse);
    checkpointRow->addWidget(checkpoint_);
    connect(checkpointBrowse, &QPushButton::clicked, this, [this] {
        const auto parent = QFileDialog::getExistingDirectory(
            this, "Choose persistent parent for a new saved-profile checkpoint");
        if (!parent.isEmpty())
            checkpointOutput_->setText(QDir(parent).filePath(
                "skylanders-checkpoint-" + QDateTime::currentDateTime().toString("yyyyMMdd-HHmmss-") +
                QUuid::createUuid().toString(QUuid::Id128).left(8)));
    });
    connect(checkpointOutput_, &QLineEdit::textChanged, this, [this] { updateControls(); });
    settings->addLayout(checkpointRow);
    auto *checkpointNotice =
        new QLabel("Checkpoint = saved profile + managed figures. Stops the emulator first; resume boots the "
                   "game and uses stored progress, not an exact mid-frame state.");
    checkpoint_->setToolTip(checkpointNotice->text());
    delete checkpointNotice;
    status_ = new QLabel("Starting portal controller…");
    status_->setObjectName("portalStatus");
    status_->setTextFormat(Qt::PlainText);
    status_->setWordWrap(true);
    layout->addWidget(status_);
    auto *body = new QVBoxLayout;
    auto *figures = new QVBoxLayout;
    body->addLayout(figures, 1);
    layout->addLayout(body, 1);
    table_ = new QTableWidget(16, 5);
    table_->setObjectName("portalSlots");
    table_->setHorizontalHeaderLabels({"Slot", "Figure ID", "Variant", "Serial", "Commanded state"});
    table_->setSelectionBehavior(QAbstractItemView::SelectRows);
    table_->setSelectionMode(QAbstractItemView::SingleSelection);
    table_->setEditTriggers(QAbstractItemView::NoEditTriggers);
    table_->verticalHeader()->setVisible(false);
    table_->verticalHeader()->setDefaultSectionSize(23);
    table_->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
    figures->addWidget(table_, 1);
    auto *figureRow = new QHBoxLayout;
    figureId_ = new QSpinBox;
    figureId_->setObjectName("portalFigureId");
    figureId_->setRange(0, 65535);
    variant_ = new QSpinBox;
    variant_->setObjectName("portalVariant");
    variant_->setRange(0, 65535);
    variant_->setDisplayIntegerBase(16);
    variant_->setPrefix("0x");
    create_ = new QPushButton("Create blank figure");
    create_->setObjectName("portalCreate");
    figureRow->addWidget(new QLabel("Figure ID"));
    figureRow->addWidget(figureId_);
    figureRow->addWidget(new QLabel("Variant"));
    figureRow->addWidget(variant_);
    figureRow->addWidget(create_);
    figureRow->addStretch();
    figures->addLayout(figureRow);
    auto *figureForm = new QFormLayout;
    figureForm->addRow("Figure file (copied)", fileRow(figureFile_, "portalFigureFile",
                                                       "Select a 1024-byte virtual figure file", false));
    figures->addLayout(figureForm);
    auto *operations = new QHBoxLayout;
    insert_ = new QPushButton("Insert");
    insert_->setObjectName("portalInsert");
    swap_ = new QPushButton("Swap");
    swap_->setObjectName("portalSwap");
    remove_ = new QPushButton("Remove");
    remove_->setObjectName("portalRemove");
    operations->addWidget(insert_);
    operations->addWidget(swap_);
    operations->addWidget(remove_);
    operations->addStretch();
    figures->addLayout(operations);
    auto *gamePanel = new QGroupBox("Game controls");
    auto *gameLayout = new QVBoxLayout(gamePanel);
    body->addWidget(gamePanel, 1);
    gameCapabilities_ = new QLabel;
    gameCapabilities_->setObjectName("portalGameCapabilities");
    gameCapabilities_->setTextFormat(Qt::PlainText);
    gameCapabilities_->setWordWrap(true);
    auto *timing = new QHBoxLayout;
    pulseDuration_ = new QSpinBox;
    pulseDuration_->setObjectName("portalPulseDuration");
    pulseDuration_->setRange(10, 2000);
    pulseDuration_->setValue(100);
    pulseDuration_->setSuffix(" ms");
    captureTimeout_ = new QSpinBox;
    captureTimeout_->setObjectName("portalCaptureTimeout");
    captureTimeout_->setRange(1000, 30000);
    captureTimeout_->setValue(10000);
    captureTimeout_->setSingleStep(1000);
    captureTimeout_->setSuffix(" ms");
    timing->addWidget(new QLabel("Pulse"));
    timing->addWidget(pulseDuration_);
    timing->addWidget(new QLabel("Capture timeout"));
    timing->addWidget(captureTimeout_);
    auto *pad = new QGridLayout;
    const auto addInput = [this, pad](int row, int column, const QString &label, const QString &kind,
                                      const QString &name, const QString &objectName) {
        auto *button = new QPushButton(label);
        button->setObjectName(objectName);
        button->setAutoRepeat(false);
        button->setAutoDefault(false);
        button->setToolTip(QString("One bounded %1 pulse: %2. No desktop key injection.").arg(kind, name));
        gameButtons_.push_back(button);
        pad->addWidget(button, row, column);
        connect(button, &QPushButton::clicked, this, [this, kind, name] { sendInput(kind, name); });
    };
    addInput(0, 0, "Cross", "button", "cross", "portalCross");
    addInput(0, 1, "Circle", "button", "circle", "portalCircle");
    addInput(0, 2, "Square", "button", "square", "portalSquare");
    addInput(0, 3, "Triangle", "button", "triangle", "portalTriangle");
    addInput(1, 0, "D-pad ↑", "button", "pad_up", "portalDpadUp");
    addInput(1, 1, "D-pad ↓", "button", "pad_down", "portalDpadDown");
    addInput(1, 2, "D-pad ←", "button", "pad_left", "portalDpadLeft");
    addInput(1, 3, "D-pad →", "button", "pad_right", "portalDpadRight");
    addInput(2, 0, "Move ↑", "axis", "left_y_minus", "portalMoveUp");
    addInput(2, 1, "Move ↓", "axis", "left_y_plus", "portalMoveDown");
    addInput(2, 2, "Move ←", "axis", "left_x_minus", "portalMoveLeft");
    addInput(2, 3, "Move →", "axis", "left_x_plus", "portalMoveRight");
    addInput(3, 0, "L1", "button", "l1", "portalL1");
    addInput(3, 1, "R1", "button", "r1", "portalR1");
    addInput(3, 2, "L2", "axis", "l2", "portalL2");
    addInput(3, 3, "R2", "axis", "r2", "portalR2");
    addInput(4, 0, "Options", "button", "options", "portalOptions");
    addInput(4, 1, "Share", "button", "share", "portalShare");
    gameLayout->addLayout(pad);
    auto *captureRow = new QHBoxLayout;
    captureAfterInput_ = new QCheckBox("Capture after input");
    captureAfterInput_->setObjectName("portalCaptureAfterInput");
    captureAfterInput_->setChecked(false);
    capture_ = new QPushButton("Capture fresh frame");
    capture_->setObjectName("portalCapture");
    capture_->setAutoDefault(false);
    captureRow->addWidget(captureAfterInput_);
    captureRow->addWidget(capture_, 1);
    gameLayout->addLayout(captureRow);
    connect(capture_, &QPushButton::clicked, this, [this] { captureFrame(); });
    openNativeView_ = new QPushButton("Live");
    openNativeView_->setObjectName("portalNativeView");
    openNativeView_->setToolTip("Host the owned emulator's live X11 window with bounded WASD/RMB camera "
                                "control; explicit PNG fallback.");
    launch->insertWidget(1, openNativeView_);
    connect(openNativeView_, &QPushButton::clicked, this, [this] { openNativeView(); });
    gameFeedback_ = new QLabel("One bounded pulse per click. Input acknowledgment is not game acceptance.");
    gameFeedback_->setObjectName("portalGameFeedback");
    gameFeedback_->setWordWrap(true);
    gameFeedback_->setTextFormat(Qt::PlainText);
    framePreview_ = new QLabel;
    framePreview_->setObjectName("portalFramePreview");
    framePreview_->setAlignment(Qt::AlignCenter);
    framePreview_->setTextFormat(Qt::PlainText);
    framePreview_->setWordWrap(true);
    framePreview_->setMinimumSize(280, 158);
    framePreview_->setMaximumHeight(260);
    framePreview_->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Expanding);
    framePreview_->setStyleSheet("background:#17212b; color:#d3dde7; border:1px solid #435466; padding:4px;");
    frameInfo_ = new QLabel;
    frameInfo_->setObjectName("portalFrameInfo");
    frameInfo_->setTextFormat(Qt::PlainText);
    frameInfo_->setWordWrap(true);
    capturePath_ = new QLineEdit;
    capturePath_->setObjectName("portalCapturePath");
    capturePath_->setReadOnly(true);
    capturePath_->setPlaceholderText("Verified screenshot path appears here");
    clearFrame("No game frame captured. This preview is a snapshot, not a live stream.");
    log_ = new QPlainTextEdit;
    log_->setReadOnly(true);
    log_->setMaximumBlockCount(300);
    log_->setMaximumHeight(105);
    auto *diagnostics = fold("Snapshots and diagnostics", "portalDiagnosticsToggle");
    diagnostics->addWidget(gameCapabilities_);
    diagnostics->addLayout(timing);
    diagnostics->addWidget(gameFeedback_);
    diagnostics->addWidget(framePreview_);
    diagnostics->addWidget(frameInfo_);
    diagnostics->addWidget(capturePath_);
    diagnostics->addWidget(log_);

    connect(start_, &QPushButton::clicked, this, [this] { launchOwnedSession(); });
    connect(stop_, &QPushButton::clicked, this, [this] {
        if (nativeView_)
            nativeView_->stopRefresh("Stopping the owned emulator.");
        if (pendingId_) {
            stopQueued_ = true;
            if (nativeView_)
                nativeView_->releaseCameraInput();
            return;
        }
        send("portal_stop", {}, [this](QJsonObject result, QString error) {
            if (error.isEmpty()) {
                applyStatus(result);
                log("Stop requested for this dialog's owned emulator.");
            }
        });
    });
    connect(checkpoint_, &QPushButton::clicked, this, [this] {
        if (nativeView_)
            nativeView_->stopRefresh("Stopping the emulator to save a checkpoint.");
        log("Stopping the owned emulator and saving its profile/figures checkpoint…");
        send("portal_checkpoint", {{"output", checkpointOutput_->text()}},
             [this](QJsonObject result, QString error) {
                 if (error.isEmpty()) {
                     resume_->setText(result.value("path").toString());
                     log(QString("Saved checkpoint: %1 (%2 files, %3 recorded figures). Choose New session "
                                 "to resume into a fresh profile.")
                             .arg(result.value("path").toString())
                             .arg(result.value("files").toInt())
                             .arg(result.value("figures").toArray().size()));
                     log(result.value("limitation").toString());
                 }
                 // The emulator can be stopped even if copying the checkpoint failed.
                 queryStatus();
             });
    });
    connect(reset_, &QPushButton::clicked, this, [this] {
        if (nativeView_)
            nativeView_->stopRefresh("Changing controller session.");
        resetAfterExit_ = true;
        if (controllerRunning())
            process_.closeWriteChannel();
        else {
            resetAfterExit_ = false;
            startController();
        }
    });
    connect(create_, &QPushButton::clicked, this, [this] {
        send("portal_create_figure", {{"figureId", figureId_->value()}, {"variant", variant_->value()}},
             [this](QJsonObject result, QString error) {
                 if (error.isEmpty()) {
                     figureFile_->setText(result.value("path").toString());
                     log("Created synthetic figure: " + result.value("path").toString());
                 }
             });
    });
    const auto slotCommand = [this](const QString &operation) {
        QJsonObject arguments{{"slot", table_->currentRow()}};
        if (operation != "portal_remove")
            arguments.insert("file", figureFile_->text());
        send(operation, arguments, [this, operation](QJsonObject result, QString error) {
            if (!error.isEmpty())
                return;
            log(QString("%1 sent for slot %2; recognition must be confirmed in game.")
                    .arg(operation)
                    .arg(result.value("slot").toInt()));
            queryStatus();
        });
    };
    connect(insert_, &QPushButton::clicked, this, [slotCommand] { slotCommand("portal_insert"); });
    connect(swap_, &QPushButton::clicked, this, [slotCommand] { slotCommand("portal_swap"); });
    connect(remove_, &QPushButton::clicked, this, [slotCommand] { slotCommand("portal_remove"); });
    connect(table_, &QTableWidget::itemSelectionChanged, this, [this] { updateControls(); });
    connect(&process_, &QProcess::started, this, [this] {
        ready_ = true;
        updateControls();
        queryStatus();
    });
    connect(&process_, &QProcess::readyReadStandardOutput, this, [this] { readOutput(); });
    connect(&process_, &QProcess::readyReadStandardError, this, [this] {
        const auto message = QString::fromUtf8(process_.readAllStandardError()).trimmed();
        if (!message.isEmpty())
            log(message);
    });
    connect(&process_, &QProcess::errorOccurred, this, [this](QProcess::ProcessError error) {
        if (error == QProcess::FailedToStart) {
            ready_ = false;
            log("Controller failed to start: " + process_.errorString());
            if (onLaunchFailed)
                onLaunchFailed(process_.errorString());
            updateControls();
            if (closing_)
                finishedShutdown();
        }
    });
    connect(&process_, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), this,
            [this](int code, QProcess::ExitStatus) {
                timeout_.stop();
                ready_ = false;
                emulatorRunning_ = false;
                usbReady_ = false;
                pendingId_ = 0;
                reply_ = {};
                emulatorPid_ = 0;
                launchWhenReady_ = false;
                inputSupported_ = captureSupported_ = false;
                nativeCameraAvailable_ = nativeCameraHeld_ = cameraRestoreQueued_ = false;
                if (nativeView_)
                    nativeView_->captureFailed("Controller stopped. Refresh stopped.");
                clearFrame("Controller stopped. Previous snapshot cleared.");
                log(QString("Controller exited (%1).").arg(code));
                updateControls();
                if (closing_)
                    finishedShutdown();
                else if (resetAfterExit_) {
                    resetAfterExit_ = false;
                    startController();
                }
            });
    timeout_.setSingleShot(true);
    connect(&timeout_, &QTimer::timeout, this, [this] {
        log("Controller request timed out. Terminating the controller so it can stop its owned emulator.");
        gameFeedback_->setText("Controller timeout: outcome unknown. Stopping this owned session; no older "
                               "image will be shown.");
        clearFrame("Capture unavailable: controller timed out.");
        if (nativeView_)
            nativeView_->captureFailed("Controller request timed out. Refresh stopped.");
        ready_ = false;
        pendingId_ = 0;
        reply_ = {};
        process_.terminate();
        updateControls();
    });
    poll_.setInterval(1000);
    connect(&poll_, &QTimer::timeout, this, [this] {
        if (!closing_)
            queryStatus();
    });
    // All pointers are initialized before textChanged/selection signals can run.
    session_->setText(newSessionPath());
    applyStatus({{"running", false}, {"slots", QJsonArray{}}});
    table_->selectRow(0);
    for (auto *button : findChildren<QPushButton *>())
        button->setAutoDefault(false);
    startController();
    poll_.start();
}

PortalDialog::~PortalDialog() {
    poll_.stop();
    if (nativeView_) {
        nativeView_->close();
        nativeView_->stopRefresh("Portal closed.");
        nativeView_->requestCapture = {};
        nativeView_->requestCamera = {};
        nativeView_->requestCameraRestore = {};
    }
    if (controllerRunning()) {
        process_.closeWriteChannel();
        if (!process_.waitForFinished(1000)) {
            process_.terminate();
            process_.waitForFinished(7000);
        }
    }
}
bool PortalDialog::applyLaunchSettings(const QJsonObject &settings, bool startAfterReady, bool openNativeView,
                                       QString *error) {
    if (closing_ || emulatorRunning_ || launched_ || launchWhenReady_) {
        if (error)
            *error = "A running, closing or already-used Portal session cannot be reconfigured. Create a "
                     "fresh session.";
        return false;
    }
    for (const auto &key : {"emulator", "game", "session"})
        if (settings.value(key).toString().isEmpty()) {
            if (error)
                *error = QString("Prepared launch is missing %1.").arg(key);
            return false;
        }
    emulator_->setText(settings.value("emulator").toString());
    game_->setText(settings.value("game").toString());
    session_->setText(settings.value("session").toString());
    resume_->setText(settings.value("resumeFrom").toString());
    x11_->setChecked(settings.value("x11").toBool(true));
    launchWhenReady_ = startAfterReady;
    openNativeAfterLaunch_ = openNativeView;
    updateControls();
    if (launchWhenReady_ && ready_ && !pendingId_)
        launchOwnedSession();
    if (error)
        error->clear();
    return true;
}
void PortalDialog::launchOwnedSession() {
    if (!ready_ || pendingId_ || closing_ || launched_ || emulatorRunning_)
        return;
    launchWhenReady_ = false;
    QJsonObject arguments{{"emulator", emulator_->text()},
                          {"game", game_->text()},
                          {"session", session_->text()},
                          {"x11", x11_->isChecked()}};
    if (!resume_->text().isEmpty())
        arguments.insert("resumeFrom", resume_->text());
    send("portal_start", arguments, [this](QJsonObject result, QString error) {
        if (error.isEmpty()) {
            launched_ = true;
            applyStatus(result);
            log("Launched isolated session: " + result.value("session").toString());
            if (openNativeAfterLaunch_) {
                openNativeAfterLaunch_ = false;
                openNativeView();
            }
            if (onLaunched)
                onLaunched();
        } else if (onLaunchFailed)
            onLaunchFailed(error);
    });
}
void PortalDialog::log(const QString &message) {
    log_->appendPlainText(QDateTime::currentDateTime().toString("HH:mm:ss ") + message);
}
void PortalDialog::startController() {
    launched_ = false;
    ready_ = false;
    emulatorRunning_ = false;
    usbReady_ = false;
    buffer_.clear();
    slots_ = {};
    inputSupported_ = captureSupported_ = inputUncertain_ = captureUncertain_ = false;
    inputProtocolFault_ = captureProtocolFault_ = false;
    lastCaptureRequestId_ = 0;
    seenFramePaths_.clear();
    lastCaptureLatencyMs_ = 0;
    nativeCameraAvailable_ = nativeCameraHeld_ = cameraRestoreQueued_ = false;
    nativeCameraRemainingMs_ = 0;
    if (nativeView_)
        nativeView_->resetSession();
    clearFrame("No game frame captured in this session.");
    if (QFileInfo::exists(session_->text()))
        session_->setText(newSessionPath());
    applyStatus({{"running", false}, {"slots", QJsonArray{}}});
    process_.setProcessChannelMode(QProcess::SeparateChannels);
    process_.start(config_.node, {controller_});
    log("Controller: " + controller_);
    updateControls();
}
void PortalDialog::send(const QString &operation, const QJsonObject &arguments,
                        std::function<void(QJsonObject, QString)> complete) {
    if (!ready_ || pendingId_)
        return;
    pendingId_ = ++sequence_;
    pendingOperation_ = operation;
    reply_ = std::move(complete);
    process_.write(
        QJsonDocument(QJsonObject{{"id", pendingId_}, {"operation", operation}, {"arguments", arguments}})
            .toJson(QJsonDocument::Compact) +
        '\n');
    const int timeout = operation == "portal_checkpoint" ? 120000
                        : operation == "portal_capture"  ? arguments.value("timeoutMs").toInt(10000) + 5000
                        : operation == "portal_input"    ? arguments.value("durationMs").toInt(100) + 5000
                                                         : 30000;
    timeout_.start(timeout);
    updateControls();
}
void PortalDialog::readOutput() {
    buffer_ += process_.readAllStandardOutput();
    while (true) {
        const auto end = buffer_.indexOf('\n');
        if (end < 0)
            break;
        const auto line = buffer_.left(end);
        buffer_.remove(0, end + 1);
        QJsonParseError parse;
        const auto document = QJsonDocument::fromJson(line, &parse);
        if (parse.error != QJsonParseError::NoError || !document.isObject()) {
            log("Invalid controller response.");
            continue;
        }
        const auto response = document.object();
        if (response.value("id").toInteger(-1) != pendingId_) {
            log("Unexpected controller response ID.");
            continue;
        }
        timeout_.stop();
        pendingId_ = 0;
        pendingOperation_.clear();
        auto complete = std::move(reply_);
        reply_ = {};
        const auto errorValue = response.value("error");
        QString error =
            errorValue.isObject() ? errorValue.toObject().value("message").toString() : errorValue.toString();
        if (!error.isEmpty() && response.value("code").isString())
            error.prepend(response.value("code").toString() + ": ");
        if (!error.isEmpty())
            log("Error: " + error);
        if (complete)
            complete(response.value("result").toObject(), error);
        updateControls();
        if (stopQueued_ && !pendingId_ && !closing_) {
            stopQueued_ = false;
            stop_->click();
        }
        if (cameraRestoreQueued_ && !pendingId_ && !closing_)
            requestNativeCameraRestore();
        if (launchWhenReady_ && !pendingId_ && !closing_)
            launchOwnedSession();
        if (closing_)
            advanceShutdown();
    }
    if (buffer_.size() > 1024 * 1024) {
        log("Controller response exceeds 1 MiB; terminating.");
        process_.terminate();
        buffer_.clear();
    }
}
void PortalDialog::queryStatus() {
    if (!ready_ || pendingId_ || closing_)
        return;
    if (cameraRestoreQueued_) {
        requestNativeCameraRestore();
        return;
    }
    send("portal_status", {}, [this](QJsonObject result, QString error) {
        if (error.isEmpty())
            applyStatus(result);
    });
}
void PortalDialog::applyStatus(const QJsonObject &status) {
    const bool wasInputUncertain = inputUncertain_;
    emulatorRunning_ = status.value("running").toBool();
    usbReady_ = status.value("usbBackendReady").toBool();
    emulatorPid_ = emulatorRunning_ ? status.value("pid").toInteger() : 0;
    applyNativeCameraState(status.value("nativeCamera").toObject());
    const auto capabilities = status.value("capabilities").toObject();
    inputSupported_ = capabilities.value("inputPulse").toBool();
    captureSupported_ = capabilities.value("captureGameFrame").toBool();
    inputUncertain_ = !status.value("uncertainInputRequestIds").toArray().isEmpty();
    captureUncertain_ = status.value("captureUncertain").toBool();
    gameCapabilities_->setText(
        !emulatorRunning_
            ? "Start an owned session. The official binary has no input/capture capability."
            : QString("Input: %1 · Native capture: %2%3%4")
                  .arg(inputSupported_ ? "supported" : "unsupported",
                       captureSupported_ ? "supported" : "unsupported",
                       inputUncertain_ ? "\nInput release unconfirmed: wait for a late release or stop." : "",
                       captureUncertain_ ? "\nCapture timed out: start a new session before capturing again."
                                         : ""));
    if (inputProtocolFault_ || captureProtocolFault_)
        gameCapabilities_->setText(gameCapabilities_->text() +
                                   "\nResponse/preview verification failed; start a new session.");
    if (wasInputUncertain && !inputUncertain_ && emulatorRunning_ && !inputProtocolFault_) {
        gameFeedback_->setText(
            "Late input release confirmed. Controls are available again; game response remains unconfirmed.");
        log(gameFeedback_->text());
    }
    if (!emulatorRunning_ && !frame_.isNull())
        clearFrame("Owned emulator stopped. Previous snapshot cleared.");
    slots_ = status.value("slots").toArray();
    status_->setText(QString("Emulator: %1 · IPC: %2 · Portal: %3")
                         .arg(emulatorRunning_ ? "running" : "stopped",
                              status.value("ipcHandshake").toBool() ? "complete" : "waiting",
                              usbReady_ ? "initialized" : "waiting"));
    status_->setToolTip("Slot state records commands sent, not in-game figure recognition.");
    if (status.value("failure").isString())
        log("Emulator failure: " + status.value("failure").toString());
    const int selected = qMax(0, table_->currentRow());
    const QSignalBlocker blocker(table_);
    for (int slot = 0; slot < 16; ++slot) {
        const auto figure = slot < slots_.size() ? slots_[slot].toObject() : QJsonObject{};
        const QStringList values{
            QString::number(slot), figure.isEmpty() ? "—" : QString::number(figure.value("figureId").toInt()),
            figure.isEmpty() ? "—" : QString("0x%1").arg(figure.value("variant").toInt(), 4, 16, QChar('0')),
            figure.value("serial").toString("—"),
            figure.isEmpty() ? "empty" : "insert sent (not acknowledged)"};
        for (int column = 0; column < values.size(); ++column) {
            auto *item = new QTableWidgetItem(values[column]);
            item->setToolTip(figure.value("writableCopy").toString());
            table_->setItem(slot, column, item);
        }
    }
    table_->selectRow(selected);
    updateControls();
}
void PortalDialog::updateControls() {
    const bool idle = ready_ && !pendingId_ && !closing_;
    const bool motion =
        pendingOperation_ == "portal_camera_move" || pendingOperation_ == "portal_camera_renew";
    const int slot = table_->currentRow();
    const bool occupied = slot >= 0 && slot < slots_.size() && slots_[slot].isObject();
    start_->setEnabled(idle && !launched_ && !emulator_->text().isEmpty() && !game_->text().isEmpty() &&
                       !session_->text().isEmpty());
    stop_->setEnabled(ready_ && (!pendingId_ || motion) && !closing_ && emulatorRunning_);
    checkpoint_->setEnabled(idle && launched_ && !checkpointOutput_->text().isEmpty());
    // A failed start may have partially initialized the controller. Always let
    // the user create a fresh controller when no owned emulator is running.
    reset_->setEnabled(!closing_ && !pendingId_ && !emulatorRunning_);
    const bool configure = !launched_ && !pendingId_ && !closing_;
    emulator_->parentWidget()->setEnabled(configure);
    game_->parentWidget()->setEnabled(configure);
    session_->parentWidget()->setEnabled(configure);
    resume_->parentWidget()->setEnabled(configure);
    x11_->setEnabled(configure);
    checkpointOutput_->setEnabled(!pendingId_ && !closing_);
    create_->setEnabled(idle && launched_);
    const bool canWrite = idle && emulatorRunning_ && usbReady_ && slot >= 0;
    insert_->setEnabled(canWrite && !occupied && !figureFile_->text().isEmpty());
    swap_->setEnabled(canWrite && occupied && !figureFile_->text().isEmpty());
    remove_->setEnabled(canWrite && occupied);
    const bool gameReady = idle && emulatorRunning_ && usbReady_;
    for (auto *button : gameButtons_)
        button->setEnabled(gameReady && !nativeCameraHeld_ && inputSupported_ && !inputUncertain_ &&
                           !inputProtocolFault_);
    capture_->setEnabled(gameReady && captureSupported_ && !captureUncertain_ && !captureProtocolFault_);
    pulseDuration_->setEnabled(idle && inputSupported_);
    captureTimeout_->setEnabled(idle && captureSupported_ && !captureUncertain_);
    captureAfterInput_->setEnabled(idle && inputSupported_ && captureSupported_ && !captureUncertain_ &&
                                   !captureProtocolFault_);
    openNativeView_->setEnabled(!closing_);
    if (nativeView_) {
        nativeView_->setOwnedSession(process_.processId(), emulatorPid_, emulator_->text());
        const bool available = ready_ && !closing_ && emulatorRunning_ && usbReady_ && captureSupported_ &&
                               !captureUncertain_ && !captureProtocolFault_ && !inputProtocolFault_;
        nativeView_->setCaptureAvailability(
            available, pendingId_ != 0,
            closing_                       ? "Portal is closing."
            : !ready_ || !emulatorRunning_ ? "No running owned emulator."
            : !captureSupported_           ? "This emulator does not support native game capture."
            : !usbReady_                   ? "Waiting for the owned session to initialize."
                         : "Capture is unavailable after a timeout or protocol fault. Start a new session.",
            motion);
        nativeView_->setCameraState(available && nativeCameraAvailable_, nativeCameraHeld_,
                                    nativeCameraRemainingMs_, nativeCameraMessage_, nativeUiHidden_);
    }
}
void PortalDialog::sendInput(const QString &kind, const QString &name) {
    if (!ready_ || pendingId_ || closing_ || !emulatorRunning_ || !usbReady_ || !inputSupported_ ||
        inputUncertain_ || inputProtocolFault_)
        return;
    clearFrame("Input changes the game state. Waiting for a new snapshot.");
    gameFeedback_->setText(QString("Sending %1 for %2 ms; waiting for press and release…")
                               .arg(name)
                               .arg(pulseDuration_->value()));
    send("portal_input", {{"kind", kind}, {"name", name}, {"durationMs", pulseDuration_->value()}},
         [this, name](QJsonObject result, QString error) {
             if (closing_)
                 return;
             if (!error.isEmpty()) {
                 gameFeedback_->setText("Input failed or timed out: " + error +
                                        "\nNo game acceptance is inferred.");
                 queryStatus();
                 return;
             }
             if (!result.value("acknowledged").toBool() || !result.value("pressed").toBool() ||
                 !result.value("released").toBool() || result.value("requestId").toInteger() <= 0) {
                 inputProtocolFault_ = true;
                 gameFeedback_->setText("Incomplete input acknowledgment. Controls locked until a new "
                                        "session; game response is unknown.");
                 log(gameFeedback_->text());
                 queryStatus();
                 return;
             }
             const auto message =
                 QString("%1: press + release acknowledged (request %2). Game response remains unconfirmed.")
                     .arg(name)
                     .arg(result.value("requestId").toInteger());
             gameFeedback_->setText(message);
             log(message);
             if (captureAfterInput_->isChecked() && captureSupported_ && !captureUncertain_ &&
                 !captureProtocolFault_)
                 captureFrame();
             else
                 queryStatus();
         });
}
bool PortalDialog::captureFrame() {
    if (!ready_ || pendingId_ || closing_ || !emulatorRunning_ || !usbReady_ || !captureSupported_ ||
        captureUncertain_ || captureProtocolFault_)
        return false;
    captureLatency_.start();
    if (nativeView_)
        nativeView_->captureStarted();
    clearFrame("Waiting for a fresh native game frame…");
    gameFeedback_->setText("Capturing the owned game's frame; an older screenshot will not be substituted.");
    send("portal_capture", {{"timeoutMs", captureTimeout_->value()}},
         [this](QJsonObject result, QString error) {
             if (closing_)
                 return;
             if (error.isEmpty()) {
                 if (showFrame(result, error)) {
                     gameFeedback_->setText("Fresh native snapshot received. This is not live video; input "
                                            "ACKs do not prove in-game acceptance.");
                     log("Fresh game frame: " + capturePath_->text());
                 } else
                     captureProtocolFault_ = true;
             }
             if (!error.isEmpty()) {
                 clearFrame("No fresh frame available. Previous image cleared.");
                 gameFeedback_->setText("Capture failed: " + error);
                 log(gameFeedback_->text());
                 if (nativeView_)
                     nativeView_->captureFailed("Capture failed. Refresh stopped: " + error);
             }
             queryStatus();
         });
    return true;
}
void PortalDialog::openNativeView() {
    if (closing_)
        return;
    if (!nativeView_) {
        nativeView_ = new NativeGameView(this);
        nativeView_->requestCapture = [this] { return captureFrame(); };
        nativeView_->requestCamera = [this](const QString &operation, const QJsonObject &arguments) {
            return requestNativeCamera(operation, arguments);
        };
        nativeView_->requestCameraRestore = [this] { requestNativeCameraRestore(); };
    }
    if (hostNativeView) {
        if (nativeView_->isWindow())
            nativeView_->setWindowFlags(Qt::Widget);
        hostNativeView(nativeView_);
        nativeView_->show();
    } else {
        nativeView_->show();
        nativeView_->raise();
        nativeView_->activateWindow();
    }
    updateControls();
    if (!frame_.isNull())
        nativeView_->presentFrame(frame_, frameInfo_->text(), capturePath_->text(), lastCaptureLatencyMs_);
}
void PortalDialog::applyNativeCameraState(const QJsonObject &state) {
    nativeCameraAvailable_ = state.value("available").toBool();
    nativeCameraHeld_ = state.value("enabled").toBool();
    nativeCameraRemainingMs_ = state.value("remainingMs").toInt();
    nativeUiHidden_ = state.value("uiHidden").toBool();
    nativeCameraMessage_ =
        !state.value("lastFault").toString().isEmpty() ? state.value("lastFault").toString()
        : nativeCameraAvailable_
            ? "Enable free camera, then focus the view for WASD / Q/E / RMB. Active until Restore; heartbeat "
              "protects against an abandoned hold."
            : "Native camera unavailable: start the supported owned emulator/game session.";
}
bool PortalDialog::requestNativeCamera(const QString &operation, const QJsonObject &arguments) {
    if (!ready_ || pendingId_ || closing_ || !emulatorRunning_ || !usbReady_)
        return false;
    if (operation != "portal_camera_disable" &&
        (!nativeCameraAvailable_ || captureUncertain_ || captureProtocolFault_ || inputProtocolFault_))
        return false;
    send(operation, arguments, [this, operation](QJsonObject result, QString error) {
        if (error.isEmpty())
            applyNativeCameraState(result);
        else {
            nativeCameraMessage_ = "Native camera request failed: " + error;
            log(nativeCameraMessage_);
        }
        updateControls();
        if (nativeView_)
            nativeView_->cameraActionFinished(error.isEmpty(), nativeCameraMessage_);
        if (closing_ || cameraRestoreQueued_)
            return;
        if (!pendingId_ && operation != "portal_camera_move" && operation != "portal_camera_renew")
            queryStatus();
    });
    return true;
}
void PortalDialog::requestNativeCameraRestore() {
    cameraRestoreQueued_ = true;
    if (!ready_ || closing_ || !emulatorRunning_) {
        cameraRestoreQueued_ = false;
        return;
    }
    if (pendingId_)
        return;
    cameraRestoreQueued_ = false;
    requestNativeCamera("portal_camera_disable", {});
}
void PortalDialog::clearFrame(const QString &message) {
    frame_ = QImage();
    framePreview_->setPixmap(QPixmap());
    framePreview_->setText(message);
    framePreview_->setProperty("capturePath", QString());
    capturePath_->clear();
    frameInfo_->setText("Snapshot only · never a desktop capture");
    if (nativeView_)
        nativeView_->clearFrame(message);
}
bool PortalDialog::showFrame(const QJsonObject &result, QString &error) {
    const auto reject = [&error](const QString &message) {
        error = message;
        return false;
    };
    const qint64 request = result.value("requestId").toInteger();
    if (!result.value("acknowledged").toBool() || !result.value("fresh").toBool() ||
        !result.value("gameOnly").toBool() || request <= lastCaptureRequestId_)
        return reject(
            "Missing freshness/game-only acknowledgment or repeated request ID; start a new session.");
    const QString root = QFileInfo(session_->text()).canonicalFilePath();
    const QString expected = QDir(root).filePath("user/screenshots");
    const QFileInfo info(result.value("path").toString());
    const QString canonical = info.canonicalFilePath();
    if (root.isEmpty() || canonical.isEmpty() || info.isSymLink() || !info.isFile() ||
        QFileInfo(expected).canonicalFilePath() != expected ||
        QFileInfo(canonical).absolutePath() != expected)
        return reject("Screenshot is not a regular file in this owned session's screenshots directory.");
    if (seenFramePaths_.contains(canonical))
        return reject("Screenshot path was already displayed; refusing a stale frame.");
    const auto digest = result.value("sha256").toString();
    static const QRegularExpression hashPattern("^[0-9a-f]{64}$");
    const qint64 expectedBytes = result.value("bytes").toInteger();
    if (expectedBytes < 45 || expectedBytes > 64 * 1024 * 1024 || info.size() != expectedBytes ||
        !hashPattern.match(digest).hasMatch())
        return reject("Invalid screenshot size/hash metadata.");
    QFile file(canonical);
    if (!file.open(QIODevice::ReadOnly))
        return reject("Cannot open the returned screenshot: " + file.errorString());
    const QByteArray bytes = file.read(64 * 1024 * 1024 + 1);
    if (bytes.size() != expectedBytes ||
        QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex() != digest.toLatin1())
        return reject("Screenshot changed after capture; SHA-256 verification failed.");
    QBuffer buffer;
    buffer.setData(bytes);
    buffer.open(QIODevice::ReadOnly);
    QImageReader reader(&buffer, "png");
    const QSize dimensions = reader.size();
    if (!dimensions.isValid() || dimensions.width() != result.value("width").toInt() ||
        dimensions.height() != result.value("height").toInt() ||
        qint64(dimensions.width()) * dimensions.height() > 64 * 1024 * 1024)
        return reject("Invalid or excessively large screenshot dimensions.");
    if (dimensions.width() > 1280 || dimensions.height() > 720)
        reader.setScaledSize(dimensions.scaled(1280, 720, Qt::KeepAspectRatio));
    frame_ = reader.read();
    if (frame_.isNull())
        return reject("PNG preview decode failed: " + reader.errorString());
    lastCaptureRequestId_ = request;
    seenFramePaths_.insert(canonical);
    capturePath_->setText(canonical);
    capturePath_->setToolTip(canonical);
    framePreview_->setProperty("capturePath", canonical);
    frameInfo_->setText(QString("Fresh snapshot — not live · %1 × %2 · %3\nSHA-256: %4…")
                            .arg(dimensions.width())
                            .arg(dimensions.height())
                            .arg(QDateTime::currentDateTime().toString("HH:mm:ss"), digest.left(20)));
    lastCaptureLatencyMs_ = captureLatency_.isValid() ? captureLatency_.elapsed() : 0;
    if (nativeView_)
        nativeView_->presentFrame(frame_, frameInfo_->text(), canonical, lastCaptureLatencyMs_);
    resizeFrame();
    return true;
}
void PortalDialog::resizeFrame() {
    if (!framePreview_ || frame_.isNull())
        return;
    const QSize available = framePreview_->contentsRect().size() - QSize(10, 10);
    if (available.width() > 0 && available.height() > 0)
        framePreview_->setPixmap(
            QPixmap::fromImage(frame_).scaled(available, Qt::KeepAspectRatio, Qt::SmoothTransformation));
}
void PortalDialog::resizeEvent(QResizeEvent *event) {
    QDialog::resizeEvent(event);
    resizeFrame();
}
void PortalDialog::requestShutdown(std::function<void()> complete) {
    if (complete)
        shutdownCallbacks_.push_back(std::move(complete));
    closing_ = true;
    poll_.stop();
    if (nativeView_) {
        nativeView_->stopRefresh("Portal is closing.");
        nativeView_->close();
    }
    updateControls();
    advanceShutdown();
}
void PortalDialog::advanceShutdown() {
    if (!controllerRunning()) {
        finishedShutdown();
        return;
    }
    if (pendingId_)
        return;
    if (emulatorRunning_ && !stopAttempted_) {
        stopAttempted_ = true;
        log("Closing portal: stopping this dialog's owned emulator…");
        send("portal_stop", {}, [this](QJsonObject result, QString error) {
            if (error.isEmpty())
                applyStatus(result);
        });
    } else
        process_.closeWriteChannel();
}
void PortalDialog::finishedShutdown() {
    auto callbacks = std::move(shutdownCallbacks_);
    shutdownCallbacks_.clear();
    for (const auto &complete : callbacks)
        complete();
    if (closing_)
        close();
}
void PortalDialog::closeEvent(QCloseEvent *event) {
    if (controllerRunning()) {
        event->ignore();
        requestShutdown();
    } else
        event->accept();
}
