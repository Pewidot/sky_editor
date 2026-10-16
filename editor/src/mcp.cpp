#include "mcp.h"
#include "sceneview.h"

#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QStringList>
#include <cmath>
#include <iostream>
#include <limits>

namespace {
QJsonObject schema(const QJsonObject &properties, const QJsonArray &required) {
    return {{"type", "object"},
            {"properties", properties},
            {"required", required},
            {"additionalProperties", false}};
}
QJsonObject field(const QString &type, const QString &description) {
    return {{"type", type}, {"description", description}};
}
QJsonArray toolsList() {
    const auto path = field("string", "Absolute path to an extracted, supported level.bld IGZ file.");
    const QJsonObject digest{
        {"type", "string"},
        {"pattern", "^[a-f0-9]{64}$"},
        {"description", "Optional source SHA-256 returned by inspect_level; rejects a changed source."}};
    auto coordinate = schema({{"objectId", field("integer", "Object ID from list_level_objects.")},
                              {"position", QJsonObject{{"type", "array"},
                                                       {"items", QJsonObject{{"type", "number"}}},
                                                       {"minItems", 3},
                                                       {"maxItems", 3}}}},
                             {"objectId", "position"});
    const QJsonObject readOnly{{"readOnlyHint", true}, {"destructiveHint", false}, {"openWorldHint", false}};
    const auto vec3 = [](double low, double high) {
        return QJsonObject{{"type", "array"},
                           {"minItems", 3},
                           {"maxItems", 3},
                           {"items", QJsonObject{{"type", "number"}, {"minimum", low}, {"maximum", high}}}};
    };
    auto transformProperties = coordinate.value("properties").toObject();
    transformProperties["rotationDegrees"] = vec3(-360, 360);
    transformProperties["scale"] = vec3(.01, 100);
    coordinate["properties"] = transformProperties;
    const auto lightingSchema =
        schema({{"direction", vec3(-1e4, 1e4)},
                {"ambient", vec3(0, 4)},
                {"keyColor", vec3(0, 4)},
                {"intensity", QJsonObject{{"type", "number"}, {"minimum", 0}, {"maximum", 8}}},
                {"exposure", QJsonObject{{"type", "number"}, {"minimum", -8}, {"maximum", 8}}},
                {"twoSided", field("boolean", "Two-sided diffuse preview; not native game lighting")}},
               {"direction", "ambient", "keyColor", "intensity", "exposure", "twoSided"});
    const QJsonObject meshKey{{"type", "string"},
                              {"pattern", "^(geometry:[0-9]+|actor:[0-9]+:mesh:[0-9]+)$"}};
    const QJsonObject uvChannel{{"type", "integer"}, {"minimum", 0}, {"maximum", 7}};
    const QJsonObject textureSize{{"type", "integer"}, {"minimum", 32}, {"maximum", 1024}};
    const QJsonObject objectId{{"type", "integer"}, {"minimum", 0}};
    return {
        QJsonObject{
            {"name", "import_glb"},
            {"description", "Import static embedded glTF 2.0 as a new workshop scene, with native-exportable "
                            "BOX collision. Does not launch/install. PNG/JPEG need ImageMagick."},
            {"inputSchema",
             schema(
                 {{"path", path},
                  {"output", field("string", "NEW absolute .scene.json path")},
                  {"basePath", field("string", "Optional existing authored scene")},
                  {"expectedSha256", digest},
                  {"alphaPolicy", QJsonObject{{"type", "string"},
                                              {"enum", QJsonArray{"opaque", "reject"}},
                                              {"default", "opaque"},
                                              {"description", "Approximate actual transparency as opaque, "
                                                              "with warnings; reject forbids that loss."}}}},
                 {"path", "output"})},
            {"annotations",
             QJsonObject{{"readOnlyHint", false}, {"destructiveHint", false}, {"openWorldHint", false}}}},
        QJsonObject{{"name", "inspect_level"},
                    {"description", "Read level metadata and object type counts. Does not modify the file."},
                    {"inputSchema", schema({{"path", path}, {"expectedSha256", digest}}, {"path"})},
                    {"annotations", readOnly}},
        QJsonObject{{"name", "list_level_objects"},
                    {"description", "List level objects with filtering and pagination. Only editable objects "
                                    "have verified position fields."},
                    {"inputSchema",
                     schema({{"path", path},
                             {"expectedSha256", digest},
                             {"type", field("string", "Exact object type filter.")},
                             {"query", field("string", "Text filter for object names or types.")},
                             {"offset", QJsonObject{{"type", "integer"}, {"minimum", 0}}},
                             {"limit", QJsonObject{{"type", "integer"}, {"minimum", 1}, {"maximum", 500}}}},
                            {"path"})},
                    {"annotations", readOnly}},
        QJsonObject{
            {"name", "inspect_level_scene"},
            {"description",
             "Read all spatial placements independently of table pagination and decode supported static "
             "geometry. Actor proxies are not game models; only worldEditable root actors have verified "
             "world-space moves. Geometry arrays are omitted by default."},
            {"inputSchema",
             schema(
                 {{"path", path},
                  {"expectedSha256", digest},
                  {"geometryPath",
                   field("string", "Optional companion inner geometry IGZ path; defaults to path.")},
                  {"includeGeometry",
                   QJsonObject{{"type", "boolean"},
                               {"default", false},
                               {"description", "Include vertex/index arrays; can produce a large response. "
                                               "False returns mesh metadata and counts."}}},
                  {"includeTextures",
                   QJsonObject{
                       {"type", "boolean"},
                       {"default", false},
                       {"description", "Include deduplicated RGBA color-map previews and mesh UVs; requires "
                                       "includeGeometry:true. Unsupported layered materials stay flat."}}},
                  {"texturePreviewSize",
                   QJsonObject{
                       {"type", "integer"},
                       {"minimum", 32},
                       {"maximum", 1024},
                       {"default", 256},
                       {"description",
                        "Maximum stored preview-mip dimension; total decoded RGBA is bounded to 8 MiB."}}}},
                 {"path"})},
            {"annotations", readOnly}},
        QJsonObject{
            {"name", "build_level"},
            {"description",
             "Apply verified object position edits to a new level file with a provenance manifest. Refuses "
             "to overwrite existing files; does not add geometry or new objects."},
            {"inputSchema",
             schema({{"path", path},
                     {"expectedSha256", digest},
                     {"output", field("string", "Absolute path for the new file; must not already exist.")},
                     {"edits", QJsonObject{{"type", "array"}, {"items", coordinate}, {"minItems", 1}}}},
                    {"path", "output", "edits"})},
            {"annotations",
             QJsonObject{{"readOnlyHint", false}, {"destructiveHint", false}, {"openWorldHint", false}}}},
        QJsonObject{
            {"name", "inspect_level_collision"},
            {"description",
             "Read native-verified actor box collision dimensions/offsets in world meters, structural "
             "eligibility and rejection reasons. This is partial coverage, not static Havok terrain or "
             "runtime state. Read-only; collision authoring is not exposed."},
            {"inputSchema",
             schema({{"path", path},
                     {"expectedSha256", digest},
                     {"actorId",
                      QJsonObject{{"type", "integer"},
                                  {"minimum", 0},
                                  {"description",
                                   "Optional actor object ID; omit to inspect all tfbActorInfo records."}}}},
                    {"path"})},
            {"annotations", readOnly}},
        QJsonObject{{"name", "inspect_level_materials"},
                    {"description",
                     "Read paginated mesh/material diagnostics, image bindings, source sampler values, UV "
                     "channels/ranges and exact fallback reasons. No vertex/pixel arrays. A textureImageId "
                     "with previewMeshKey is an explicit diagnostic override, not verified shader mapping."},
                    {"inputSchema",
                     schema({{"path", path},
                             {"expectedSha256", digest},
                             {"geometryPath", field("string", "Optional companion inner IGZ")},
                             {"previewMeshKey", meshKey},
                             {"textureImageId", objectId},
                             {"uvChannel", uvChannel},
                             {"texturePreviewSize", textureSize},
                             {"offset", QJsonObject{{"type", "integer"}, {"minimum", 0}}},
                             {"limit", QJsonObject{{"type", "integer"}, {"minimum", 1}, {"maximum", 200}}}},
                            {"path"})},
                    {"annotations", readOnly}},
        QJsonObject{
            {"name", "render_level_view"},
            {"description",
             "Render the real C++ viewport to a NEW PNG, optionally a NEW JSON sidecar. Supports repeatable "
             "cameras, isolated mesh/actor, unlit/checker/missing-material views and diagnostic "
             "bound-image/UV overrides. Does not modify game assets or start shadPS4. renderer:gpu requires "
             "working hardware OpenGL/display; preview light is NOT native game lighting."},
            {"inputSchema",
             schema(
                 {{"path", path},
                  {"expectedSha256", digest},
                  {"geometryPath", field("string", "Optional companion inner IGZ")},
                  {"output", field("string", "NEW PNG path; existing parent required")},
                  {"reportPath", field("string", "Optional NEW provenance JSON path")},
                  {"renderer", QJsonObject{{"type", "string"}, {"enum", QJsonArray{"auto", "cpu", "gpu"}}}},
                  {"viewMode",
                   QJsonObject{{"type", "string"},
                               {"enum", QJsonArray{"material", "unlit", "checker", "missing", "flat"}}}},
                  {"meshKey", meshKey},
                  {"frameObject", objectId},
                  {"textureImageId", objectId},
                  {"uvChannel", uvChannel},
                  {"texturePreviewSize", textureSize},
                  {"hideOverlays", field("boolean", "Hide grid, proxies, gizmos, selection tint and labels")},
                  {"isolateSelection",
                   field("boolean", "Only draw selected actor/mesh; requires meshKey or frameObject")},
                  {"lighting", lightingSchema},
                  {"camera",
                   schema({{"pivot", QJsonObject{{"type", "array"},
                                                 {"minItems", 3},
                                                 {"maxItems", 3},
                                                 {"items", QJsonObject{{"type", "number"},
                                                                       {"minimum", -1e6},
                                                                       {"maximum", 1e6}}}}},
                           {"yawRadians",
                            QJsonObject{{"type", "number"}, {"minimum", -314.159}, {"maximum", 314.159}}},
                           {"pitchRadians",
                            QJsonObject{{"type", "number"}, {"minimum", -1.55}, {"maximum", 1.55}}},
                           {"distance", QJsonObject{{"type", "number"}, {"minimum", .25}, {"maximum", 1e6}}}},
                          {"pivot", "yawRadians", "pitchRadians", "distance"})}},
                 {"path", "output"})},
            {"annotations",
             QJsonObject{{"readOnlyHint", false}, {"destructiveHint", false}, {"openWorldHint", false}}}}};
}
QJsonObject errorResponse(const QJsonValue &id, int code, const QString &message) {
    return {{"jsonrpc", "2.0"}, {"id", id}, {"error", QJsonObject{{"code", code}, {"message", message}}}};
}
QJsonObject resultResponse(const QJsonValue &id, const QJsonObject &result) {
    return {{"jsonrpc", "2.0"}, {"id", id}, {"result", result}};
}
QJsonObject toolResult(const QJsonObject &value, const QString &error = {}) {
    const QJsonObject output =
        error.isEmpty() ? value : QJsonObject{{"error", QJsonObject{{"message", error}}}};
    return {{"isError", !error.isEmpty()},
            {"structuredContent", output},
            {"content", QJsonArray{QJsonObject{{"type", "text"},
                                               {"text", QString::fromUtf8(QJsonDocument(output).toJson(
                                                            QJsonDocument::Compact))}}}}};
}
bool integer(const QJsonValue &value, double minimum, double maximum) {
    const double number = value.toDouble(-1);
    return value.isDouble() && std::isfinite(number) && number >= minimum && number <= maximum &&
           std::floor(number) == number;
}
QString validate(const QString &name, const QJsonObject &arguments) {
    for (auto it = arguments.begin(); it != arguments.end(); ++it)
        if (it.value().isString() && it.value().toString().contains(QChar(0)))
            return "NUL characters are not allowed in arguments.";
    if (!arguments.value("path").isString() || arguments.value("path").toString().isEmpty())
        return "path must be a nonempty string.";
    QStringList allowed{"path", "expectedSha256"};
    if (arguments.contains("expectedSha256") && (!arguments.value("expectedSha256").isString() ||
                                                 !QRegularExpression("^[a-f0-9]{64}$")
                                                      .match(arguments.value("expectedSha256").toString())
                                                      .hasMatch()))
        return "expectedSha256 must contain exactly 64 lowercase hexadecimal characters.";
    if (name == "import_glb") {
        allowed << "output" << "basePath" << "alphaPolicy";
        if (arguments.contains("alphaPolicy") &&
            !QStringList{"opaque", "reject"}.contains(arguments.value("alphaPolicy").toString()))
            return "alphaPolicy must be opaque or reject";
        for (const auto *key : {"path", "output"})
            if (!arguments.value(key).isString() || !QDir::isAbsolutePath(arguments.value(key).toString()))
                return "Import requires absolute paths";
        if (arguments.contains("basePath") &&
            (!arguments.value("basePath").isString() ||
             !QDir::isAbsolutePath(arguments.value("basePath").toString()) ||
             !arguments.contains("expectedSha256")))
            return "basePath requires an absolute path and matching SHA-256";
    } else if (name == "list_level_objects") {
        allowed << "type" << "query" << "offset" << "limit";
        for (const auto &key : {QStringLiteral("type"), QStringLiteral("query")})
            if (arguments.contains(key) && !arguments.value(key).isString())
                return key + " must be a string.";
        if (arguments.contains("offset") && !integer(arguments.value("offset"), 0, 9007199254740991.0))
            return "offset must be a nonnegative integer.";
        if (arguments.contains("limit") && !integer(arguments.value("limit"), 1, 500))
            return "limit must be an integer from 1 to 500.";
    } else if (name == "inspect_level_scene" || name == "inspect_level_materials" ||
               name == "render_level_view") {
        allowed << "geometryPath" << "texturePreviewSize";
        if (name == "inspect_level_scene")
            allowed << "includeGeometry" << "includeTextures";
        else
            allowed << "textureImageId" << "uvChannel";
        if (arguments.contains("geometryPath") && (!arguments.value("geometryPath").isString() ||
                                                   arguments.value("geometryPath").toString().isEmpty()))
            return "geometryPath must be a nonempty string.";
        if (arguments.contains("includeGeometry") && !arguments.value("includeGeometry").isBool())
            return "includeGeometry must be a boolean.";
        if (arguments.contains("includeTextures") && !arguments.value("includeTextures").isBool())
            return "includeTextures must be a boolean.";
        if (name == "inspect_level_scene" && arguments.value("includeTextures").toBool() &&
            !arguments.value("includeGeometry").toBool())
            return "includeTextures requires includeGeometry:true.";
        if (arguments.contains("texturePreviewSize") &&
            !integer(arguments.value("texturePreviewSize"), 32, 1024))
            return "texturePreviewSize must be an integer from 32 to 1024.";
        if (arguments.contains("uvChannel") && !integer(arguments.value("uvChannel"), 0, 7))
            return "uvChannel must be 0..7.";
        if (arguments.contains("textureImageId") &&
            !integer(arguments.value("textureImageId"), 0, 9007199254740991.0))
            return "textureImageId must be a nonnegative integer.";
        const auto keyName = name == "render_level_view" ? "meshKey" : "previewMeshKey";
        if (name != "inspect_level_scene")
            allowed << keyName;
        if (arguments.contains(keyName) &&
            (!arguments.value(keyName).isString() ||
             !QRegularExpression("^(geometry:[0-9]+|actor:[0-9]+:mesh:[0-9]+)$")
                  .match(arguments.value(keyName).toString())
                  .hasMatch()))
            return "Invalid mesh selection key.";
        if (arguments.contains("textureImageId") && !arguments.contains(keyName))
            return "textureImageId requires a mesh key.";
        if (name == "inspect_level_materials") {
            allowed << "offset" << "limit";
            if (arguments.contains("offset") && !integer(arguments.value("offset"), 0, 9007199254740991.0))
                return "Invalid offset.";
            if (arguments.contains("limit") && !integer(arguments.value("limit"), 1, 200))
                return "limit must be 1..200.";
        }
        if (name == "render_level_view") {
            allowed << "output" << "reportPath" << "renderer" << "viewMode" << "frameObject" << "hideOverlays"
                    << "isolateSelection" << "camera" << "lighting";
            if (arguments.contains("lighting") &&
                (!arguments.value("lighting").isObject() ||
                 arguments.value("lighting").toObject().size() != 6 ||
                 !SceneView::validLightingState(arguments.value("lighting").toObject())))
                return "Invalid editor lighting parameters.";
            for (const auto &key : {"output", "reportPath"})
                if ((QString(key) == "output" || arguments.contains(key)) &&
                    (!arguments.value(key).isString() || arguments.value(key).toString().isEmpty()))
                    return QString(key) + " must be a nonempty path.";
            if (arguments.contains("renderer") &&
                !QStringList{"auto", "cpu", "gpu"}.contains(arguments.value("renderer").toString()))
                return "Invalid renderer.";
            if (arguments.contains("viewMode") &&
                !QStringList{"material", "unlit", "checker", "missing", "flat"}.contains(
                    arguments.value("viewMode").toString()))
                return "Invalid viewMode.";
            if (arguments.contains("frameObject") &&
                !integer(arguments.value("frameObject"), 0, 9007199254740991.0))
                return "Invalid frameObject.";
            if (arguments.contains("frameObject") && arguments.contains("meshKey"))
                return "frameObject and meshKey are mutually exclusive.";
            for (const auto &key : {"hideOverlays", "isolateSelection"})
                if (arguments.contains(key) && !arguments.value(key).isBool())
                    return QString(key) + " must be boolean.";
            if (arguments.value("isolateSelection").toBool() && !arguments.contains("frameObject") &&
                !arguments.contains("meshKey"))
                return "isolateSelection requires a selected mesh/actor.";
            if (arguments.contains("camera")) {
                if (!arguments.value("camera").isObject())
                    return "camera must be an object.";
                const auto camera = arguments.value("camera").toObject();
                if (camera.size() != 4 || !camera.value("pivot").isArray() ||
                    camera.value("pivot").toArray().size() != 3)
                    return "Invalid camera fields.";
                const auto number = [](const QJsonValue &v, double lo, double hi) {
                    return v.isDouble() && std::isfinite(v.toDouble()) && v.toDouble() >= lo &&
                           v.toDouble() <= hi;
                };
                for (const auto &v : camera.value("pivot").toArray())
                    if (!number(v, -1e6, 1e6))
                        return "Invalid camera pivot.";
                if (!number(camera.value("yawRadians"), -314.159, 314.159) ||
                    !number(camera.value("pitchRadians"), -1.55, 1.55) ||
                    !number(camera.value("distance"), .25, 1e6))
                    return "Invalid camera orientation/distance.";
            }
        }
    } else if (name == "inspect_level_collision") {
        allowed << "actorId";
        if (arguments.contains("actorId") && !integer(arguments.value("actorId"), 0, 9007199254740991.0))
            return "actorId must be a nonnegative integer.";
    } else if (name == "build_level") {
        allowed << "output" << "edits";
        if (!arguments.value("output").isString() || arguments.value("output").toString().isEmpty())
            return "output must be a nonempty string.";
        if (!arguments.value("edits").isArray() || arguments.value("edits").toArray().isEmpty())
            return "edits must be a nonempty array.";
        for (const auto &entry : arguments.value("edits").toArray()) {
            if (!entry.isObject())
                return "Every edit must be an object.";
            const auto edit = entry.toObject();
            if (!integer(edit.value("objectId"), 0, 9007199254740991.0))
                return "objectId must be a nonnegative integer.";
            if (!edit.value("position").isArray() || edit.value("position").toArray().size() != 3)
                return "position must contain exactly three numbers.";
            for (const auto &value : edit.value("position").toArray())
                if (!value.isDouble() || !std::isfinite(value.toDouble()))
                    return "Position coordinates must be finite numbers.";
            for (auto it = edit.begin(); it != edit.end(); ++it)
                if (!QStringList{"objectId", "position", "rotationDegrees", "scale"}.contains(it.key()))
                    return "Unknown transform field";
            for (const auto *key : {"rotationDegrees", "scale"})
                if (edit.contains(key)) {
                    const auto a = edit.value(key).toArray();
                    if (!edit.value(key).isArray() || a.size() != 3)
                        return "Transform requires three numbers";
                    for (const auto &v : a)
                        if (!v.isDouble() || !std::isfinite(v.toDouble()) ||
                            v.toDouble() < (QString(key) == "scale" ? .01 : -360) ||
                            v.toDouble() > (QString(key) == "scale" ? 100 : 360))
                            return "Transform outside supported range";
                }
        }
    }
    for (auto it = arguments.begin(); it != arguments.end(); ++it)
        if (!allowed.contains(it.key()))
            return "Unknown argument: " + it.key();
    return {};
}
bool readFrame(std::string &line, bool &oversized) {
    constexpr size_t maxFrame = 4 * 1024 * 1024;
    line.clear();
    oversized = false;
    char character;
    while (std::cin.get(character)) {
        if (character == '\n')
            return true;
        if (line.size() == maxFrame) {
            oversized = true;
            std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');
            return true;
        }
        line.push_back(character);
    }
    return !line.empty();
}
} // namespace

int runMcp(const BackendConfig &config) {
    std::string line;
    auto send = [](const QJsonObject &object) {
        auto bytes = QJsonDocument(object).toJson(QJsonDocument::Compact);
        if (bytes.size() > 64 * 1024 * 1024)
            bytes = QJsonDocument(errorResponse(object.value("id"), -32001,
                                                "Response exceeds the 64 MiB transport limit; omit "
                                                "geometry/textures or request a smaller texturePreviewSize."))
                        .toJson(QJsonDocument::Compact);
        std::cout << bytes.constData() << '\n' << std::flush;
    };
    bool oversized = false;
    while (readFrame(line, oversized)) {
        if (oversized) {
            send(errorResponse(QJsonValue::Null, -32600, "Request exceeds the 4 MiB frame limit"));
            continue;
        }
        if (line.empty())
            continue;
        QJsonParseError parse;
        const auto document = QJsonDocument::fromJson(QByteArray::fromStdString(line), &parse);
        if (parse.error != QJsonParseError::NoError) {
            send(errorResponse(QJsonValue::Null, -32700, "Parse error"));
            continue;
        }
        if (!document.isObject()) {
            send(errorResponse(QJsonValue::Null, -32600, "Invalid request"));
            continue;
        }
        const auto request = document.object();
        const auto id = request.contains("id") ? request.value("id") : QJsonValue(QJsonValue::Null);
        if (request.value("jsonrpc").toString() != "2.0" || !request.value("method").isString() ||
            (request.contains("id") && !id.isNull() && !id.isString() && !id.isDouble())) {
            send(errorResponse(QJsonValue::Null, -32600, "Invalid request"));
            continue;
        }
        if (!request.contains("id"))
            continue; // Notifications never receive a response.
        if (request.contains("params") && !request.value("params").isObject()) {
            send(errorResponse(id, -32602, "params must be an object"));
            continue;
        }
        const auto method = request.value("method").toString();
        const auto params = request.value("params").toObject();
        if (method == "initialize") {
            QString version = params.value("protocolVersion").toString();
            if (!QStringList{"2024-11-05", "2025-03-26", "2025-06-18"}.contains(version))
                version = "2025-03-26";
            send(resultResponse(
                id,
                {{"protocolVersion", version},
                 {"capabilities", QJsonObject{{"tools", QJsonObject{{"listChanged", false}}}}},
                 {"serverInfo", QJsonObject{{"name", "skylanders-level-editor"}, {"version", "0.1.0"}}},
                 {"instructions",
                  "Operate on extracted level IGZ files. Build writes a new file and manifest; apply it to a "
                  "separate test game copy. Runtime validity is not implied by static validation."}}));
        } else if (method == "ping")
            send(resultResponse(id, {}));
        else if (method == "tools/list")
            send(resultResponse(id, {{"tools", toolsList()}}));
        else if (method == "tools/call") {
            const auto name = params.value("name").toString();
            QString operation;
            if (name == "inspect_level")
                operation = "inspect";
            else if (name == "list_level_objects")
                operation = "objects";
            else if (name == "inspect_level_scene")
                operation = "scene";
            else if (name == "build_level")
                operation = "build";
            else if (name == "inspect_level_collision")
                operation = "inspect";
            else if (name == "inspect_level_materials")
                operation = "materials";
            else if (name == "render_level_view")
                operation = "render";
            else if (name == "import_glb")
                operation = "import";
            else {
                send(errorResponse(id, -32602, "Unknown tool: " + name));
                continue;
            }
            if (!params.value("arguments").isObject()) {
                send(errorResponse(id, -32602, "arguments must be an object"));
                continue;
            }
            auto arguments = params.value("arguments").toObject();
            const auto invalid = validate(name, arguments);
            if (!invalid.isEmpty()) {
                send(resultResponse(id, toolResult({}, invalid)));
                continue;
            }
            arguments.insert("operation", operation);
            if (operation == "scene" && !arguments.contains("includeGeometry"))
                arguments.insert("includeGeometry", false);
            const bool collision = name == "inspect_level_collision";
            if (collision && arguments.contains("expectedSha256"))
                arguments.insert("expectedSourceHash", arguments.take("expectedSha256"));
            BackendConfig selected = collision ? collisionBackend(config) : config;
            if (operation == "import") {
                selected.script = QFileInfo(config.script).absoluteDir().filePath("glb_import.mjs");
                arguments.remove("operation");
            }
            const auto result =
                operation == "render" ? renderLevelView(config, arguments) : callBackend(selected, arguments);
            if (!result.diagnostics.isEmpty())
                std::cerr << result.diagnostics.toStdString() << '\n';
            send(resultResponse(id, toolResult(result.value, result.error)));
        } else
            send(errorResponse(id, -32601, "Method not found: " + method));
    }
    return 0;
}
