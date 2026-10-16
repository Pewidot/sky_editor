#pragma once

#include "backend.h"
#include <QJsonArray>
#include <QMap>
#include <QWidget>

class QLabel;
class QLineEdit;
class QPushButton;

struct PreviewProfile {
    QString path;
    QJsonObject document;
    QString error;
    bool ok() const { return error.isEmpty(); }
};

// Only the selected profile path is persisted. Asset pins and installation
// metadata remain in the explicit profile, and the backend validates them again.
QString previewProfilePath();
PreviewProfile readPreviewProfile(const QString &path);
bool storePreviewProfilePath(const QString &path, QString *error = nullptr);
BackendResult previewLaunchRequest(const PreviewProfile &profile, const QString &levelPath,
                                   const QString &sourceSha256, const QMap<qint64, QJsonArray> &edits,
                                   const QMap<qint64, QJsonObject> &transforms = {});
BackendResult validatePreviewLaunchReply(BackendResult result, const PreviewProfile &profile,
                                         const QJsonObject &request);
void preparePreviewLaunchAsync(QObject *owner, const BackendConfig &config, const PreviewProfile &profile,
                               const QString &levelPath, const QString &sourceSha256,
                               const QMap<qint64, QJsonArray> &edits,
                               std::function<void(BackendResult)> finished,
                               const QMap<qint64, QJsonObject> &transforms = {},
                               std::function<void(QString)> progress = {});

class PreviewSettingsPanel : public QWidget {
  public:
    explicit PreviewSettingsPanel(const QString &initialPath, QWidget *parent = nullptr);
    QString profilePath() const;
    void setProfilePath(const QString &path);
    std::function<void(const QString &)> onSaved;
    std::function<void()> onClose;

  private:
    QLineEdit *path_;
    QLabel *summary_;
    QLabel *details_;
    QPushButton *save_;
    PreviewProfile profile_;
    void inspect();
};
