#pragma once

#include <QDialog>
#include <QElapsedTimer>
#include <QImage>
#include <QJsonObject>
#include <QPointF>
#include <QSet>
#include <QTimer>
#include <functional>
#include <optional>

class QLabel;
class QCheckBox;
class QLineEdit;
class QPushButton;
class QSpinBox;
class QDoubleSpinBox;
class NativeWindowHost;

// Displays only frames already verified by PortalDialog. Owns no emulator,
// transport or screenshot files. Camera input stays local to this focused view.
class NativeGameView : public QDialog {
  public:
    explicit NativeGameView(QWidget *parent = nullptr);
    ~NativeGameView() override;
    void setOwnedSession(qint64 controllerPid, qint64 emulatorPid, const QString &emulator);
    bool liveAttached() const;
    QWidget *cameraInputSurface() const;
    static constexpr int MaximumAutomaticCaptures = 30;
    std::function<bool()> requestCapture;
    std::function<bool(const QString &, const QJsonObject &)> requestCamera;
    std::function<void()> requestCameraRestore;
    std::function<void()> requestStop;
    void setCameraState(bool available, bool held, int remainingMs, const QString &reason,
                        bool uiHidden = false);
    void cameraActionFinished(bool success, const QString &message);
    void releaseCameraInput();
    void setCaptureAvailability(bool available, bool controllerBusy, const QString &reason,
                                bool motionBusy = false);
    void captureStarted();
    void presentFrame(const QImage &image, const QString &metadata, const QString &path, qint64 latencyMs);
    void clearFrame(const QString &message);
    void captureFailed(const QString &message);
    void stopRefresh(const QString &message);
    void resetSession();
    bool refreshing() const { return refreshing_; }
    int automaticCaptureCount() const { return automaticCaptures_; }

  protected:
    void closeEvent(QCloseEvent *event) override;
    void hideEvent(QHideEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    bool eventFilter(QObject *watched, QEvent *event) override;

  private:
    QTimer refresh_;
    QTimer movement_;
    QTimer cameraCapture_;
    QTimer heartbeat_;
    QElapsedTimer sinceMovement_;
    QElapsedTimer sinceCompletion_;
    QImage image_;
    bool available_ = false, controllerBusy_ = false, capturing_ = false, refreshing_ = false;
    int automaticCaptures_ = 0, remaining_ = 0;
    QString unavailableReason_;
    QLabel *preview_, *status_, *metadata_, *budget_;
    NativeWindowHost *live_;
    QLabel *liveStatus_;
    QPushButton *fallback_;
    bool snapshotFallback_ = false;
    qint64 controllerPid_ = 0, emulatorPid_ = 0;
    QString emulatorPath_;
    void updateLiveHost();
    QLineEdit *path_;
    QSpinBox *frames_;
    QDoubleSpinBox *cameraSpeed_;
    QPushButton *capture_, *start_, *stop_;
    QPushButton *holdCamera_, *restoreCamera_;
    QPushButton *newBatch_;
    QCheckBox *hideUi_;
    QLabel *cameraStatus_;
    bool cameraAvailable_ = false, cameraHeld_ = false, cameraPending_ = false, restoreRequested_ = false,
         looking_ = false;
    bool relativeLook_ = false;
    bool motionBusy_ = false, heartbeatDue_ = false;
    bool manualCaptureDue_ = false;
    QString pendingCameraOperation_, lastCameraLabel_;
    std::optional<bool> queuedUi_;
    QSet<int> heldKeys_;
    QPointF lastMouse_, mouseAngles_;
    void moveCamera();
    void stopMouseLook();
    void renewCameraLease();
    void captureManually();
    bool dispatchCamera(const QString &operation, const QJsonObject &arguments);
    void captureAfterCamera();
    void requestNextFrame();
    void updateControls();
    void resizeFrame();
};
