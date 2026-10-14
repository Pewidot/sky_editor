#pragma once

#include <QJsonObject>
#include <QString>
#include <functional>

class QObject;

struct BackendConfig {
    QString node;
    QString script;
};

struct BackendResult {
    QJsonObject value;
    QString error;
    QString diagnostics;
    bool ok() const { return error.isEmpty(); }
};

BackendResult callBackend(const BackendConfig &config, const QJsonObject &request);
BackendResult renderLevelView(const BackendConfig &config, const QJsonObject &request);
BackendConfig collisionBackend(const BackendConfig &config);
void callBackendAsync(QObject *owner, const BackendConfig &config, const QJsonObject &request,
                      std::function<void(BackendResult)> finished);
