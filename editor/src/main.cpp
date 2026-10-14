#include "backend.h"
#include "mcp.h"
#include "sceneview.h"
#include "window.h"

#include <QApplication>
#include <QCommandLineParser>
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QTimer>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

int main(int argc, char **argv) {
    bool mcp = false, render = false, requestGpu = qEnvironmentVariable("SKYLANDERS_RENDERER") == "gpu";
    // Qt's X11 platform consumes --geometry as a window-placement option.
    // Preserve the legacy companion-file argument before QApplication sees it.
    QString legacyGeometry;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--mcp") == 0)
            mcp = true;
        if (std::strcmp(argv[i], "--geometry") == 0 && i + 1 < argc)
            legacyGeometry = QString::fromLocal8Bit(argv[i + 1]);
        if (std::strncmp(argv[i], "--geometry=", 11) == 0)
            legacyGeometry = QString::fromLocal8Bit(argv[i] + 11);
        if (std::strcmp(argv[i], "--render-scene") == 0 || std::strncmp(argv[i], "--render-scene=", 15) == 0)
            render = true;
        if (std::strcmp(argv[i], "--renderer=gpu") == 0 ||
            (std::strcmp(argv[i], "--renderer") == 0 && i + 1 < argc && std::strcmp(argv[i + 1], "gpu") == 0))
            requestGpu = true;
    }
    if (render && !mcp && !requestGpu && qEnvironmentVariableIsEmpty("QT_QPA_PLATFORM"))
        qputenv("QT_QPA_PLATFORM", "offscreen");
    std::unique_ptr<QCoreApplication> app;
    if (mcp)
        app = std::make_unique<QCoreApplication>(argc, argv);
    else
        app = std::make_unique<QApplication>(argc, argv);
    QCoreApplication::setApplicationName("skylanders-level-editor");
    QCoreApplication::setApplicationVersion("0.1.0");
    QCommandLineParser parser;
    parser.setApplicationDescription("Experimental Skylanders IGZ position editor and MCP server.");
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addOption({"mcp", "Run the newline-delimited JSON-RPC MCP server on stdin/stdout (no GUI)."});
    parser.addOption(
        {"backend", "Path to tools/level_builder.mjs.", "path", QStringLiteral(LEVEL_BUILDER_DEFAULT)});
    parser.addOption({"node", "Node.js executable.", "path", "node"});
    parser.addOption({"geometry", "Optional companion inner geometry IGZ for the 3D viewport.", "path"});
    parser.addOption({"geometry-file",
                      "Companion inner geometry IGZ (preferred; avoids Qt's native --geometry option).",
                      "path"});
    parser.addOption({"smoke-test", "Show the GUI briefly, then exit (for offscreen startup verification)."});
    parser.addOption({"render-scene",
                      "Render the actual scene viewport to a NEW 1280x800 PNG, print JSON provenance, then "
                      "exit. Defaults to offscreen; no game process.",
                      "output.png"});
    parser.addOption({"frame-object",
                      "With --render-scene, frame a source RVTB actor object ID instead of the whole map.",
                      "id"});
    parser.addOption({"renderer",
                      "Mesh renderer: auto (GPU on desktop, CPU offscreen), cpu, or gpu. GPU captures fail "
                      "if unavailable or recognized as software OpenGL.",
                      "mode"});
    parser.addOption({"benchmark-frames",
                      "With --render-scene, measure 1..120 warm redraws (including readback and CPU "
                      "overlays, excluding loading).",
                      "count"});
    parser.addOption({"render-report",
                      "With --render-scene, also save its provenance/renderer/benchmark JSON to a NEW file.",
                      "output.json"});
    parser.addOption({"view-mode",
                      "Capture diagnostic mode: material, unlit, checker (8 cells/UV unit), missing "
                      "(green/magenta), flat.",
                      "mode", "material"});
    parser.addOption({"mesh-key",
                      "Capture only one decoded mesh by its source-bound selectionKey; frames its bounds.",
                      "key"});
    parser.addOption(
        {"texture-image",
         "Diagnostic ONLY: use this image object ID if bound to --mesh-key. Never changes the game.", "id"});
    parser.addOption({"texture-size",
                      "Maximum stored texture mip dimension, 32..1024; shared 8 MiB budget. Use --mesh-key "
                      "for high-resolution details.",
                      "pixels", "256"});
    parser.addOption({"uv-channel",
                      "Diagnostic stored TEXCOORD channel 0..7; not an inferred shader mapping.", "channel",
                      "0"});
    parser.addOption(
        {"camera-json",
         "Capture camera JSON with pivot[3], yawRadians, pitchRadians and distance; overrides auto framing.",
         "json"});
    parser.addOption({"lighting-json",
                      "Capture editor light rig: direction[3], ambient[3], keyColor[3], intensity, exposure, "
                      "twoSided. Not native game lighting.",
                      "json"});
    parser.addOption({"no-overlays", "Capture without grid, proxies, gizmos, selection tint or labels."});
    parser.addOption({"isolate-selection",
                      "Capture only selected actor/mesh geometry; requires --frame-object or --mesh-key."});
    parser.addOption({"expected-sha256", "Capture source hash guard.", "sha256"});
    parser.addPositionalArgument("level", "Optional extracted inner level.bld IGZ file.", "[level]");
    parser.process(*app);
    const auto renderer = parser.isSet("renderer") ? parser.value("renderer")
                                                   : qEnvironmentVariable("SKYLANDERS_RENDERER", "auto");
    if (renderer != "auto" && renderer != "cpu" && renderer != "gpu") {
        std::fprintf(stderr, "--renderer must be auto, cpu or gpu\n");
        return 2;
    }
    qputenv("SKYLANDERS_RENDERER", renderer.toUtf8());
    const auto companion = parser.isSet("geometry-file") ? parser.value("geometry-file")
                           : parser.isSet("geometry")    ? parser.value("geometry")
                                                         : legacyGeometry;
    int benchmarkFrames = 0;
    if (parser.isSet("benchmark-frames")) {
        bool valid = false;
        benchmarkFrames = parser.value("benchmark-frames").toInt(&valid);
        if (!valid || benchmarkFrames < 1 || benchmarkFrames > 120 || !parser.isSet("render-scene")) {
            std::fprintf(stderr, "--benchmark-frames requires --render-scene and a count in 1..120\n");
            return 2;
        }
    }
    if (parser.isSet("frame-object") && !parser.isSet("render-scene")) {
        std::fprintf(stderr, "--frame-object requires --render-scene\n");
        return 2;
    }
    if (parser.isSet("render-report") && !parser.isSet("render-scene")) {
        std::fprintf(stderr, "--render-report requires --render-scene\n");
        return 2;
    }
    const BackendConfig config{parser.value("node"), QFileInfo(parser.value("backend")).absoluteFilePath()};
    for (const auto &option :
         {"view-mode", "mesh-key", "texture-image", "texture-size", "uv-channel", "camera-json",
          "lighting-json", "no-overlays", "isolate-selection", "expected-sha256"})
        if (parser.isSet(option) && !parser.isSet("render-scene")) {
            std::fprintf(stderr, "--%s requires --render-scene\n", option);
            return 2;
        }
    if (parser.isSet("render-scene")) {
        if (mcp || parser.isSet("smoke-test") || parser.positionalArguments().size() != 1) {
            std::fprintf(
                stderr,
                "--render-scene requires one extracted level and cannot combine with --mcp/--smoke-test\n");
            return 2;
        }
        const auto output = QFileInfo(parser.value("render-scene")).absoluteFilePath();
        const auto reportPath = parser.isSet("render-report")
                                    ? QFileInfo(parser.value("render-report")).absoluteFilePath()
                                    : QString{};
        if (!reportPath.isEmpty() && (reportPath == output || QFileInfo::exists(reportPath) ||
                                      !QFileInfo(reportPath).absoluteDir().exists())) {
            std::fprintf(stderr,
                         "Render report must be a different NEW file with an existing parent directory\n");
            return 2;
        }
        if (QFileInfo::exists(output) || !QFileInfo(output).absoluteDir().exists()) {
            std::fprintf(stderr, "Render output must be a new file with an existing parent directory\n");
            return 2;
        }
        bool sizeOk = false, uvOk = false;
        const int textureSize = parser.value("texture-size").toInt(&sizeOk),
                  uvChannel = parser.value("uv-channel").toInt(&uvOk);
        if (!sizeOk || textureSize < 32 || textureSize > 1024 || !uvOk || uvChannel < 0 || uvChannel > 7 ||
            (parser.isSet("frame-object") && parser.isSet("mesh-key")) ||
            (parser.isSet("isolate-selection") && !parser.isSet("frame-object") &&
             !parser.isSet("mesh-key"))) {
            std::fprintf(
                stderr, "Invalid texture size, UV channel or mutually exclusive framing/selection options\n");
            return 2;
        }
        QJsonObject request{{"operation", "scene"},
                            {"path", parser.positionalArguments().first()},
                            {"includeGeometry", true},
                            {"includeTextures", true},
                            {"texturePreviewSize", textureSize},
                            {"uvChannel", uvChannel}};
        if (parser.isSet("mesh-key"))
            request.insert("previewMeshKey", parser.value("mesh-key"));
        if (parser.isSet("expected-sha256"))
            request.insert("expectedSha256", parser.value("expected-sha256"));
        if (parser.isSet("texture-image")) {
            bool valid = false;
            const auto imageId = parser.value("texture-image").toLongLong(&valid);
            if (!valid || imageId < 0 || imageId > 9007199254740991LL || !parser.isSet("mesh-key")) {
                std::fprintf(stderr, "--texture-image requires a nonnegative object ID and --mesh-key\n");
                return 2;
            }
            request.insert("textureImageId", imageId);
        }
        if (!companion.isEmpty())
            request.insert("geometryPath", companion);
        const auto result = callBackend(config, request);
        if (!result.error.isEmpty()) {
            std::fprintf(stderr, "%s\n", result.error.toUtf8().constData());
            return 1;
        }
        SceneView view;
        view.resize(1280, 800);
        view.setScene(result.value);
        if (!view.setDisplayMode(parser.value("view-mode"))) {
            std::fprintf(stderr, "Invalid --view-mode\n");
            return 2;
        }
        view.setShowOverlays(!parser.isSet("no-overlays"));
        if (parser.isSet("mesh-key") && !view.frameMesh(parser.value("mesh-key"))) {
            std::fprintf(stderr, "--mesh-key does not identify a decoded mesh\n");
            return 2;
        }
        QJsonObject framedObject;
        if (parser.isSet("frame-object")) {
            bool valid = false;
            const auto id = parser.value("frame-object").toLongLong(&valid);
            if (!valid || id < 0 || id > 9007199254740991LL || !view.frameObject(id)) {
                std::fprintf(stderr, "--frame-object requires an existing, world-positioned actor ID\n");
                return 2;
            }
            for (const auto &entry : result.value.value("objects").toArray()) {
                const auto object = entry.toObject();
                if (object.value("id").toInteger(-1) == id) {
                    for (const auto &key : {"id", "type", "name", "offset", "size", "worldPosition"})
                        if (object.contains(key))
                            framedObject.insert(key, object.value(key));
                    break;
                }
            }
        }
        if (parser.isSet("isolate-selection"))
            view.setIsolateSelection(true);
        if (parser.isSet("camera-json")) {
            QJsonParseError error;
            const auto camera = QJsonDocument::fromJson(parser.value("camera-json").toUtf8(), &error);
            if (error.error != QJsonParseError::NoError || !camera.isObject() ||
                !view.setCameraState(camera.object())) {
                std::fprintf(stderr, "Invalid --camera-json; expected finite bounded pivot, yawRadians, "
                                     "pitchRadians and distance\n");
                return 2;
            }
        }
        if (parser.isSet("lighting-json")) {
            QJsonParseError error;
            const auto lighting = QJsonDocument::fromJson(parser.value("lighting-json").toUtf8(), &error);
            if (error.error != QJsonParseError::NoError || !lighting.isObject() ||
                !view.setLightingState(lighting.object())) {
                std::fprintf(stderr,
                             "Invalid --lighting-json; expected finite bounded editor lighting parameters\n");
                return 2;
            }
        }
        view.show();
        app->processEvents();
        QImage rendered(view.size(), QImage::Format_RGB32);
        rendered.fill(Qt::black);
        view.QWidget::render(&rendered);
        std::vector<double> samples;
        for (int i = 0; i < benchmarkFrames; ++i) {
            view.setShowOverlays(!parser.isSet("no-overlays"));
            view.QWidget::render(&rendered);
            samples.push_back(view.lastFrameMilliseconds());
        }
        std::sort(samples.begin(), samples.end());
        QJsonObject measurements{{"warmFrames", benchmarkFrames},
                                 {"includesReadbackAndCpuOverlays", true},
                                 {"excludesLoading", true}};
        if (!samples.empty()) {
            measurements.insert("minimumMilliseconds", samples.front());
            measurements.insert("maximumMilliseconds", samples.back());
            measurements.insert("medianMilliseconds", samples[samples.size() / 2]);
        }
        const auto rendering = view.rendererState();
        if (renderer == "gpu" &&
            (rendering.value("active") != "opengl" ||
             rendering.value("opengl").toObject().value("softwareRasterizerDetected").toBool())) {
            std::fprintf(stderr, "Requested hardware OpenGL capture unavailable: %s\n",
                         QJsonDocument(rendering).toJson(QJsonDocument::Compact).constData());
            return 1;
        }
        QFile file(output);
        if (!file.open(QIODevice::WriteOnly | QIODevice::NewOnly)) {
            std::fprintf(stderr, "Cannot create new render output\n");
            return 1;
        }
        if (!rendered.save(&file, "PNG")) {
            file.close();
            file.remove();
            std::fprintf(stderr, "PNG encoding failed; partial output removed\n");
            return 1;
        }
        file.close();
        QFile verify(output);
        if (!verify.open(QIODevice::ReadOnly)) {
            std::fprintf(stderr, "Cannot verify render output\n");
            return 1;
        }
        const auto pngHash = QCryptographicHash::hash(verify.readAll(), QCryptographicHash::Sha256).toHex();
        const QJsonObject report{
            {"output", output},
            {"sourceSha256", result.value.value("sha256")},
            {"geometrySha256", result.value.value("geometrySha256")},
            {"actors", view.objectCount()},
            {"meshes", view.meshCount()},
            {"texturedMeshes", view.texturedMeshCount()},
            {"width", 1280},
            {"height", 800},
            {"pngSha256", QString::fromLatin1(pngHash)},
            {"camera", view.cameraState()},
            {"renderer", rendering},
            {"renderMeasurements", measurements},
            {"materialDiagnostics", view.materialReport()},
            {"textureCounts", result.value.value("textureCounts")},
            {"placeholders", view.placeholderReport()},
            {"diagnosticRequest", QJsonObject{{"meshKey", parser.value("mesh-key")},
                                              {"uvChannel", uvChannel},
                                              {"textureImageId", request.value("textureImageId")},
                                              {"textureSize", textureSize},
                                              {"shaderMappingVerified", false}}},
            {"framedObject", framedObject},
            {"previewOnly", true},
            {"gameFilesWritten", false}};
        if (!reportPath.isEmpty()) {
            QFile sidecar(reportPath);
            const auto bytes = QJsonDocument(report).toJson(QJsonDocument::Indented);
            if (!sidecar.open(QIODevice::WriteOnly | QIODevice::NewOnly) ||
                sidecar.write(bytes) != bytes.size()) {
                std::fprintf(stderr, "Failed to create render report; completed PNG remains at %s\n",
                             output.toUtf8().constData());
                return 1;
            }
        }
        std::puts(QJsonDocument(report).toJson(QJsonDocument::Compact).constData());
        return 0;
    }
    if (mcp)
        return runMcp(config);
    EditorWindow window(config);
    window.show();
    if (!parser.positionalArguments().isEmpty()) {
        const auto path = parser.positionalArguments().first();
        const auto geometry = companion;
        QTimer::singleShot(0, &window, [&window, path, geometry] { window.openPath(path, geometry); });
    }
    if (parser.isSet("smoke-test"))
        QTimer::singleShot(100, app.get(), &QCoreApplication::quit);
    return app->exec();
}
