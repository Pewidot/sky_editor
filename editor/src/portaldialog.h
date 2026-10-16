#pragma once

#include "backend.h"
#include <QDialog>
#include <QElapsedTimer>
#include <QImage>
#include <QJsonArray>
#include <QJsonObject>
#include <QPointer>
#include <QProcess>
#include <QSet>
#include <QTimer>
#include <functional>
#include <vector>

class QCheckBox;
class QLabel;
class QLineEdit;
class QPlainTextEdit;
class QPushButton;
class QSpinBox;
class QTableWidget;
class NativeGameView;

class PortalDialog : public QDialog {
  public:
    explicit PortalDialog(BackendConfig config, QWidget *parent = nullptr,
                          const QString &controllerOverride = {});
    ~PortalDialog() override;
    bool controllerRunning() const { return process_.state() != QProcess::NotRunning; }
    bool applyLaunchSettings(const QJsonObject &settings, bool startAfterReady, bool openNativeView,
                             QString *error = nullptr);
    std::function<void(const QString &)> onLaunchFailed;
    std::function<void()> onLaunched;
    std::function<void(NativeGameView *)> hostNativeView;
    void requestShutdown(std::function<void()> complete = {});

  protected:
    void closeEvent(QCloseEvent *) override;
    void resizeEvent(QResizeEvent *) override;

  private:
    BackendConfig config_;
    QString controller_;
    QProcess process_;
    QTimer poll_;
    QTimer timeout_;
    QByteArray buffer_;
    qint64 sequence_ = 0, pendingId_ = 0;
    QString pendingOperation_;
    bool stopQueued_ = false;
    bool ready_ = false, emulatorRunning_ = false, usbReady_ = false, launched_ = false;
    bool closing_ = false, stopAttempted_ = false, resetAfterExit_ = false;
    bool inputSupported_ = false, captureSupported_ = false, inputUncertain_ = false,
         captureUncertain_ = false;
    bool inputProtocolFault_ = false, captureProtocolFault_ = false;
    qint64 lastCaptureRequestId_ = 0;
    QElapsedTimer captureLatency_;
    qint64 lastCaptureLatencyMs_ = 0;
    QPointer<NativeGameView> nativeView_;
    bool nativeCameraAvailable_ = false, nativeCameraHeld_ = false, cameraRestoreQueued_ = false;
    bool nativeUiHidden_ = false;
    qint64 emulatorPid_ = 0;
    bool launchWhenReady_ = false, openNativeAfterLaunch_ = false;
    int nativeCameraRemainingMs_ = 0;
    QString nativeCameraMessage_;
    QImage frame_;
    QSet<QString> seenFramePaths_;
    QJsonArray slots_;
    std::function<void(QJsonObject, QString)> reply_;
    std::vector<std::function<void()>> shutdownCallbacks_;
    QLineEdit *emulator_;
    QLineEdit *game_;
    QLineEdit *session_;
    QLineEdit *resume_;
    QLineEdit *checkpointOutput_;
    QLineEdit *figureFile_;
    QSpinBox *figureId_;
    QSpinBox *variant_;
    QCheckBox *x11_;
    QLabel *status_;
    QTableWidget *table_;
    QPlainTextEdit *log_;
    QPushButton *start_;
    QPushButton *stop_;
    QPushButton *reset_;
    QPushButton *checkpoint_;
    QPushButton *create_;
    QPushButton *insert_;
    QPushButton *swap_;
    QPushButton *remove_;
    QSpinBox *pulseDuration_;
    QSpinBox *captureTimeout_;
    QCheckBox *captureAfterInput_;
    QLabel *gameCapabilities_;
    QLabel *gameFeedback_;
    QLabel *framePreview_ = nullptr;
    QLabel *frameInfo_;
    QLineEdit *capturePath_;
    QPushButton *capture_;
    QPushButton *openNativeView_;
    std::vector<QPushButton *> gameButtons_;

    void startController();
    void launchOwnedSession();
    void send(const QString &operation, const QJsonObject &arguments = {},
              std::function<void(QJsonObject, QString)> complete = {});
    void readOutput();
    void queryStatus();
    void applyStatus(const QJsonObject &status);
    void updateControls();
    void log(const QString &message);
    void sendInput(const QString &kind, const QString &name);
    bool captureFrame();
    void openNativeView();
    bool requestNativeCamera(const QString &operation, const QJsonObject &arguments);
    void requestNativeCameraRestore();
    void applyNativeCameraState(const QJsonObject &state);
    void clearFrame(const QString &message);
    bool showFrame(const QJsonObject &result, QString &error);
    void resizeFrame();
    void advanceShutdown();
    void finishedShutdown();
    static QString newSessionPath();
};
