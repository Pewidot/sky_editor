#include "backend.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QProcess>
#include <QTimer>
#include <memory>

namespace {
constexpr int backendTimeoutMs = 600000;

BackendResult decode(QProcess &process) {
    BackendResult result;
    const QByteArray output = process.readAllStandardOutput();
    result.diagnostics = QString::fromUtf8(process.readAllStandardError()).trimmed();
    QJsonParseError parse;
    const QJsonDocument document = QJsonDocument::fromJson(output, &parse);
    if (parse.error != QJsonParseError::NoError || !document.isObject()) {
        result.error = QStringLiteral("Backend returned invalid JSON (%1). %2")
                           .arg(parse.errorString(), result.diagnostics);
        return result;
    }
    result.value = document.object();
    if (result.value.contains("error")) {
        const auto error = result.value.value("error");
        result.error = error.isObject() ? error.toObject().value("message").toString() : error.toString();
        if (result.error.isEmpty())
            result.error = QStringLiteral("Backend rejected the request.");
    } else if (process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0) {
        result.error = QStringLiteral("Backend exited unsuccessfully: %1").arg(result.diagnostics);
    }
    return result;
}

void start(QProcess &process, const BackendConfig &config, const QJsonObject &request) {
    process.setProgram(config.node);
    process.setArguments({config.script});
    process.setProcessChannelMode(QProcess::SeparateChannels);
    process.start();
    process.write(QJsonDocument(request).toJson(QJsonDocument::Compact) + '\n');
    process.closeWriteChannel();
}
} // namespace

BackendConfig collisionBackend(const BackendConfig &config) {
    return {config.node, QFileInfo(config.script).absoluteDir().filePath("collision_builder.mjs")};
}

BackendResult callBackend(const BackendConfig &config, const QJsonObject &request) {
    QProcess process;
    start(process, config, request);
    if (!process.waitForStarted(10000))
        return {{}, process.errorString(), {}};
    if (!process.waitForFinished(backendTimeoutMs)) {
        process.kill();
        process.waitForFinished(3000);
        return {{}, QStringLiteral("Backend exceeded the 10-minute timeout."), {}};
    }
    return decode(process);
}

BackendResult renderLevelView(const BackendConfig &config, const QJsonObject &request) {
    // A separate QApplication owns the rendering context; the MCP server stays
    // a QCoreApplication. No shell, emulator or game-file writer is invoked.
    QStringList args{"--backend", config.script,    "--node",
                     config.node, "--render-scene", request.value("output").toString()};
    const QMap<QString, QString> options{{"geometryPath", "geometry-file"},
                                         {"renderer", "renderer"},
                                         {"viewMode", "view-mode"},
                                         {"meshKey", "mesh-key"},
                                         {"frameObject", "frame-object"},
                                         {"textureImageId", "texture-image"},
                                         {"texturePreviewSize", "texture-size"},
                                         {"uvChannel", "uv-channel"},
                                         {"reportPath", "render-report"},
                                         {"expectedSha256", "expected-sha256"}};
    for (auto it = options.cbegin(); it != options.cend(); ++it)
        if (request.contains(it.key()))
            args << "--" + it.value()
                 << (request.value(it.key()).isString()
                         ? request.value(it.key()).toString()
                         : QString::number(request.value(it.key()).toInteger()));
    if (request.contains("camera"))
        args << "--camera-json"
             << QString::fromUtf8(
                    QJsonDocument(request.value("camera").toObject()).toJson(QJsonDocument::Compact));
    if (request.contains("lighting"))
        args << "--lighting-json"
             << QString::fromUtf8(
                    QJsonDocument(request.value("lighting").toObject()).toJson(QJsonDocument::Compact));
    if (request.value("hideOverlays").toBool())
        args << "--no-overlays";
    if (request.value("isolateSelection").toBool())
        args << "--isolate-selection";
    args << "--" << request.value("path").toString();
    QProcess process;
    process.setProgram(QCoreApplication::applicationFilePath());
    process.setArguments(args);
    process.setProcessChannelMode(QProcess::SeparateChannels);
    process.start();
    process.closeWriteChannel();
    if (!process.waitForStarted(10000))
        return {{}, process.errorString(), {}};
    if (!process.waitForFinished(backendTimeoutMs)) {
        process.kill();
        process.waitForFinished(3000);
        return {{}, "Renderer exceeded the 10-minute timeout.", {}};
    }
    return decode(process);
}

void callBackendAsync(QObject *owner, const BackendConfig &config, const QJsonObject &request,
                      std::function<void(BackendResult)> finished, std::function<void(QString)> progress) {
    auto *process = new QProcess(owner);
    auto *timer = new QTimer(process);
    timer->setSingleShot(true);
    auto completed = std::make_shared<bool>(false);
    auto diagnostics = std::make_shared<QByteArray>(), lines = std::make_shared<QByteArray>();
    if (progress)
        QObject::connect(process, &QProcess::readyReadStandardError, process,
                         [process, progress, diagnostics, lines] {
                             const auto bytes = process->readAllStandardError();
                             *diagnostics += bytes;
                             *lines += bytes;
                             while (lines->contains('\n')) {
                                 const int at = lines->indexOf('\n');
                                 const auto line = lines->left(at);
                                 lines->remove(0, at + 1);
                                 if (line.startsWith("PREVIEW_STAGE "))
                                     progress(QString::fromUtf8(line.mid(14).left(200)));
                             }
                             if (lines->size() > 4096)
                                 lines->clear();
                             if (diagnostics->size() > 1024 * 1024)
                                 diagnostics->remove(0, diagnostics->size() - 1024 * 1024);
                         });
    auto complete = [process, timer, completed, finished](BackendResult result) {
        if (*completed)
            return;
        *completed = true;
        timer->stop();
        finished(std::move(result));
        process->deleteLater();
    };
    QObject::connect(process, qOverload<int, QProcess::ExitStatus>(&QProcess::finished), process,
                     [process, complete, diagnostics](int, QProcess::ExitStatus) {
                         auto result = decode(*process);
                         result.diagnostics = QString::fromUtf8(*diagnostics) + result.diagnostics;
                         complete(result);
                     });
    QObject::connect(process, &QProcess::errorOccurred, process,
                     [process, complete](QProcess::ProcessError error) {
                         if (error == QProcess::FailedToStart)
                             complete({{}, process->errorString(), {}});
                     });
    QObject::connect(timer, &QTimer::timeout, process, [process, complete] {
        process->kill();
        complete({{}, QStringLiteral("Backend exceeded the 10-minute timeout."), {}});
    });
    start(*process, config, request);
    timer->start(backendTimeoutMs);
}
