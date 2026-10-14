#include "sceneview.h"
#include "gpurenderer.h"
#include <QGuiApplication>

#include <QCryptographicHash>
#include <QFocusEvent>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QPainter>
#include <QResizeEvent>
#include <QWheelEvent>
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

namespace {
constexpr float pi = 3.14159265358979323846f;
constexpr float focalAngle = .577350269f; // tan(60° / 2)
const std::array<QVector3D, 3> axes{{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}};
const std::array<QColor, 3> axisColors{{QColor("#f45b69"), QColor("#84d26b"), QColor("#62a8ff")}};
QVector3D vector(const QJsonArray &value) {
    return {float(value[0].toDouble()), float(value[1].toDouble()), float(value[2].toDouble())};
}
bool finite(QVector3D value) {
    return std::isfinite(value.x()) && std::isfinite(value.y()) && std::isfinite(value.z());
}
float dot(QVector3D a, QVector3D b) { return QVector3D::dotProduct(a, b); }
QRgb lit(QRgb color, float light) {
    return qRgb(qBound(0, int(qRed(color) * light), 255), qBound(0, int(qGreen(color) * light), 255),
                qBound(0, int(qBlue(color) * light), 255));
}
QRgb lit(QRgb color, QVector3D light) {
    return qRgb(qBound(0, int(qRed(color) * light.x()), 255), qBound(0, int(qGreen(color) * light.y()), 255),
                qBound(0, int(qBlue(color) * light.z()), 255));
}
float segmentDistance(QPointF point, QPointF a, QPointF b) {
    const auto delta = b - a;
    const double length = delta.x() * delta.x() + delta.y() * delta.y();
    if (length < 1)
        return 1e9f;
    const double t = qBound(.12, QPointF::dotProduct(point - a, delta) / length, 1.15);
    const auto closest = a + delta * t;
    return float(std::hypot(point.x() - closest.x(), point.y() - closest.y()));
}
QString placeholderKind(const QJsonObject &object) {
    const auto name = object.value("name").toString().toLower();
    const auto reason = object.value("proxyReason").toString();
    // Heuristic editor symbols only, never asserted as original model identity.
    for (const auto &word : {"trigger", "script", "spawn", "dummy", "camera", "sound", "timer"})
        if (name.contains(word))
            return "logic box";
    if (reason == "No serialized actor model" || reason.isEmpty())
        return "logic box";
    for (const auto &word : {"enemy", "npc", "character", "skylander"})
        if (name.contains(word))
            return "character";
    for (const auto &word : {"chest", "treasure", "loot"})
        if (name.contains(word))
            return "chest";
    for (const auto &word : {"crate", "barrel"})
        if (name.contains(word))
            return "crate";
    for (const auto &word : {"gate", "door"})
        if (name.contains(word))
            return "gate";
    return "unresolved prop";
}
std::vector<QVector3D> placeholderGeometry(const QString &kind) {
    std::vector<QVector3D> out;
    const auto box = [&](QVector3D center, QVector3D half) {
        const std::array<QVector3D, 8> p{{{-1, -1, -1},
                                          {1, -1, -1},
                                          {1, 1, -1},
                                          {-1, 1, -1},
                                          {-1, -1, 1},
                                          {1, -1, 1},
                                          {1, 1, 1},
                                          {-1, 1, 1}}};
        const int indices[]{0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
                            3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2};
        for (const int i : indices)
            out.push_back(center + p[i] * half);
    };
    if (kind == "character") {
        box({0, 1.35f, 0}, {.42f, .6f, .25f});
        box({0, 2.25f, 0}, {.34f, .34f, .32f});
        box({-.23f, .4f, 0}, {.17f, .4f, .22f});
        box({.23f, .4f, 0}, {.17f, .4f, .22f});
        box({-.65f, 1.3f, 0}, {.16f, .55f, .2f});
        box({.65f, 1.3f, 0}, {.16f, .55f, .2f});
    } else if (kind == "chest") {
        box({0, .45f, 0}, {.9f, .45f, .6f});
        box({0, 1.05f, 0}, {.92f, .15f, .62f});
        box({0, .75f, .66f}, {.13f, .2f, .08f});
    } else if (kind == "gate") {
        box({-1.1f, 1.5f, 0}, {.2f, 1.5f, .2f});
        box({1.1f, 1.5f, 0}, {.2f, 1.5f, .2f});
        box({0, 3, 0}, {1.3f, .2f, .2f});
    } else if (kind == "crate")
        box({0, .8f, 0}, {.8f, .8f, .8f});
    else if (kind == "logic box")
        box({0, 0, 0}, {.5f, .5f, .5f});
    else {
        const QVector3D p[]{{0, 1, 0}, {0, -1, 0}, {.7f, 0, 0}, {0, 0, .7f}, {-.7f, 0, 0}, {0, 0, -.7f}};
        for (int i = 2; i < 6; ++i) {
            const int j = i == 5 ? 2 : i + 1;
            out.insert(out.end(), {p[0], p[i], p[j], p[1], p[j], p[i]});
        }
    }
    return out;
}
} // namespace

SceneView::SceneView(QWidget *parent) : QWidget(parent) {
    rendererMode_ = qEnvironmentVariable("SKYLANDERS_RENDERER", "auto");
    setMinimumSize(360, 300);
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true);
    setToolTip("Left-click selects actors or static geometry. Drag XYZ arrows to move actors. Middle-drag or "
               "Alt+left-drag orbits; Shift+middle-drag pans. Hold right mouse and use WASD/QE to fly. Shift "
               "accelerates. F frames selection; Home frames the scene.");
    movement_.setInterval(16);
    connect(&movement_, &QTimer::timeout, this, [this] { navigate(); });
    movementTime_.start();
    movement_.start();
    changed();
}

SceneView::~SceneView() = default;
QJsonObject SceneView::rendererState() const {
    QJsonObject state{{"requested", rendererMode_},
                      {"active", usedGpu_ ? "opengl" : "cpu"},
                      {"frameMilliseconds", lastFrameMs_},
                      {"nativeLightingApplied", false},
                      {"authoredEnvironmentApplied", authoredEnvironment_},
                      {"effectiveLighting", displayMode_ >= 1 && displayMode_ <= 3
                                                ? "none (diagnostic view)"
                                                : "adjustable editor light rig"},
                      {"previewLighting", lightingState()}};
    if (gpu_)
        state.insert("opengl", gpu_->information());
    else if (rendererMode_ != "cpu")
        state.insert("fallbackReason", "Offscreen platform uses CPU unless GPU is explicitly requested");
    return state;
}

QJsonObject SceneView::lightingState() const {
    const auto array = [](QVector3D v) { return QJsonArray{v.x(), v.y(), v.z()}; };
    return {{"direction", array(lightDirection_.normalized())},
            {"ambient", array(ambientLight_)},
            {"keyColor", array(keyLight_)},
            {"intensity", keyIntensity_},
            {"exposure", exposure_},
            {"twoSided", twoSidedLighting_},
            {"nativeLightingApplied", false},
            {"purpose", "editor preview rig; no native active-light/shadow reconstruction"}};
}
bool SceneView::validLightingState(const QJsonObject &lighting) {
    auto readVector = [&](const char *key, QVector3D &out, double lower, double upper) {
        const auto a = lighting.value(key).toArray();
        if (a.size() != 3)
            return false;
        for (const auto &v : a)
            if (!v.isDouble() || !std::isfinite(v.toDouble()) || v.toDouble() < lower || v.toDouble() > upper)
                return false;
        out = vector(a);
        return finite(out);
    };
    QVector3D direction, ambient, color;
    const auto intensity = lighting.value("intensity"), exposure = lighting.value("exposure");
    if (!readVector("direction", direction, -1e4, 1e4) || direction.lengthSquared() < 1e-8f ||
        !readVector("ambient", ambient, 0, 4) || !readVector("keyColor", color, 0, 4) ||
        !intensity.isDouble() || !std::isfinite(intensity.toDouble()) || intensity.toDouble() < 0 ||
        intensity.toDouble() > 8 || !exposure.isDouble() || !std::isfinite(exposure.toDouble()) ||
        exposure.toDouble() < -8 || exposure.toDouble() > 8 || !lighting.value("twoSided").isBool())
        return false;
    return true;
}
bool SceneView::setLightingState(const QJsonObject &lighting) {
    if (!validLightingState(lighting))
        return false;
    lightDirection_ = vector(lighting.value("direction").toArray()).normalized();
    ambientLight_ = vector(lighting.value("ambient").toArray());
    keyLight_ = vector(lighting.value("keyColor").toArray());
    const auto intensity = lighting.value("intensity"), exposure = lighting.value("exposure");
    keyIntensity_ = float(intensity.toDouble());
    exposure_ = float(exposure.toDouble());
    twoSidedLighting_ = lighting.value("twoSided").toBool();
    changed();
    return true;
}
QJsonObject SceneView::actorRepresentation(qint64 id) const {
    for (const auto &actor : actors_)
        if (actor.id == id) {
            if (modeledActors_.contains(id))
                return {{"actorId", id}, {"placeholder", false}, {"kind", "decoded model mesh"}};
            QVector3D low(1e10f, 1e10f, 1e10f), high(-1e10f, -1e10f, -1e10f);
            for (const auto &p : actor.placeholderTriangles)
                for (int axis = 0; axis < 3; ++axis) {
                    low[axis] = qMin(low[axis], p[axis]);
                    high[axis] = qMax(high[axis], p[axis]);
                }
            const auto dimensions = high - low;
            return {{"actorId", id},
                    {"placeholder", true},
                    {"kind", actor.proxyKind},
                    {"reason", actor.proxyReason},
                    {"followsCamera", false},
                    {"sizeSource", "fixed editor symbol, not measured game dimensions"},
                    {"classification", "name/reason heuristic; not native model identity"},
                    {"worldDimensions", QJsonArray{dimensions.x(), dimensions.y(), dimensions.z()}},
                    {"triangleCount", int(actor.placeholderTriangles.size() / 3)}};
        }
    return {};
}
QJsonArray SceneView::placeholderReport() const {
    QJsonArray result;
    for (const auto &actor : actors_)
        if (!modeledActors_.contains(actor.id))
            result.append(actorRepresentation(actor.id));
    return result;
}

QVector3D SceneView::forward() const {
    return {std::sin(yaw_) * std::cos(pitch_), std::sin(pitch_), -std::cos(yaw_) * std::cos(pitch_)};
}
QVector3D SceneView::right() const { return QVector3D::crossProduct(forward(), {0, 1, 0}).normalized(); }
QVector3D SceneView::up() const { return QVector3D::crossProduct(right(), forward()).normalized(); }
QVector3D SceneView::cameraPoint(QVector3D world) const {
    const auto relative = world - camera_;
    return {dot(relative, basisRight_), dot(relative, basisUp_), dot(relative, basisForward_)};
}
QVector3D SceneView::ray(QPointF point) const {
    const float scale = qMax(1, height()) / (2 * focalAngle);
    return (forward() + right() * float((point.x() - width() * .5) / scale) +
            up() * float((height() * .5 - point.y()) / scale))
        .normalized();
}
QVector3D SceneView::position(const Actor &actor) const {
    return actor.editable && edits_.contains(actor.id) ? vector(edits_.value(actor.id)) : actor.position;
}
const SceneView::Actor *SceneView::selectedActor() const {
    for (const auto &actor : actors_)
        if (actor.id == selected_)
            return &actor;
    return nullptr;
}
bool SceneView::project(QVector3D world, QPointF &screen, float *depth) const {
    const auto point = cameraPoint(world);
    if (point.z() < near_ || !finite(point))
        return false;
    const float scale = qMax(1, height()) / (2 * focalAngle);
    screen = {width() * .5 + point.x() * scale / point.z(), height() * .5 - point.y() * scale / point.z()};
    if (depth)
        *depth = 1 / point.z();
    return true;
}

void SceneView::setScene(const QJsonObject &scene) {
    gpu_.reset();
    usedGpu_ = false;
    actors_.clear();
    meshes_.clear();
    modeledActors_.clear();
    edits_.clear();
    selected_ = -1;
    selectedMesh_ = -1;
    textures_.clear();
    // Authored environment data is an editor light rig, never reconstructed
    // native game lighting. Reset on document changes to prevent state leakage.
    authoredEnvironment_ = false;
    backgroundColor_ = qRgb(29, 35, 43);
    lightDirection_ = {-.3f, .85f, .45f};
    ambientLight_ = {.35f, .35f, .35f};
    keyLight_ = {1, 1, 1};
    keyIntensity_ = .65f;
    exposure_ = 0;
    twoSidedLighting_ = true;
    const auto environment = scene.value("environment").toObject();
    if (scene.value("schema") == "skylanders-authored-scene-v1" && environment.value("authored").toBool()) {
        const auto incoming = environment.value("sunDirection").toArray();
        QJsonArray towardSun;
        if (incoming.size() == 3)
            for (const auto &v : incoming)
                towardSun.append(-v.toDouble());
        authoredEnvironment_ = setLightingState({{"direction", towardSun},
                                                 {"ambient", environment.value("ambientColor")},
                                                 {"keyColor", environment.value("sunColor")},
                                                 {"intensity", environment.value("sunIntensity")},
                                                 {"exposure", 0},
                                                 {"twoSided", false}});
        const auto color = environment.value("skyColor").toArray();
        if (color.size() == 3 && std::all_of(color.begin(), color.end(), [](const QJsonValue &v) {
                return v.isDouble() && std::isfinite(v.toDouble()) && v.toDouble() >= 0 && v.toDouble() <= 1;
            }))
            backgroundColor_ =
                QColor::fromRgbF(color[0].toDouble(), color[1].toDouble(), color[2].toDouble()).rgb();
        showSky_ = true;
    }
    QMap<QString, int> textureIds;
    qsizetype textureBytes = 0;
    for (const auto &entry : scene.value("textures").toArray()) {
        const auto texture = entry.toObject();
        const int width = texture.value("width").toInt(), height = texture.value("height").toInt();
        const auto id = texture.value("id").toString();
        if (width < 1 || height < 1 || width > 1024 || height > 1024 || id.size() != 64 ||
            textureIds.contains(id))
            continue;
        const qsizetype expected = qsizetype(width) * height * 4;
        const auto encoded = texture.value("rgbaBase64").toString();
        if (textureBytes + expected > 32 * 1024 * 1024 || encoded.size() != (expected + 2) / 3 * 4)
            continue;
        const auto bytes =
            QByteArray::fromBase64(encoded.toLatin1(), QByteArray::AbortOnBase64DecodingErrors);
        if (bytes.size() != expected || QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex() !=
                                            texture.value("rgbaSha256").toString().toLatin1())
            continue;
        const QImage source(reinterpret_cast<const uchar *>(bytes.constData()), width, height, width * 4,
                            QImage::Format_RGBA8888);
        const auto image = source.convertToFormat(QImage::Format_ARGB32);
        if (image.isNull())
            continue;
        textureIds.insert(id, int(textures_.size()));
        textures_.push_back(image);
        textureBytes += expected;
    }
    collisionBoxes_.clear();
    const auto bounds = scene.value("contentBounds").toObject();
    contentBounds_ = bounds.value("min").toArray().size() == 3 && bounds.value("max").toArray().size() == 3;
    if (contentBounds_) {
        contentMin_ = vector(bounds.value("min").toArray());
        contentMax_ = vector(bounds.value("max").toArray());
    }
    for (const auto &entry : scene.value("objects").toArray()) {
        const auto object = entry.toObject();
        const auto pos = object.value("worldPosition").toArray();
        if (pos.size() != 3 || !finite(vector(pos)))
            continue;
        const auto kind = placeholderKind(object);
        actors_.push_back({object.value("id").toInteger(), object.value("name").toString(), vector(pos),
                           object.value("editable").toBool() && object.value("worldEditable").toBool(), kind,
                           object.value("proxyReason").toString(), placeholderGeometry(kind)});
    }
    for (const auto &entry : scene.value("meshes").toArray()) {
        const auto object = entry.toObject();
        const auto vertices = object.value("positions").toArray();
        const auto indices = object.value("indices").toArray();
        if (vertices.size() % 3 || indices.size() % 3)
            continue;
        Mesh mesh;
        mesh.name = object.value("name").toString("Static mesh");
        mesh.selectionKey = object.value("selectionKey").toString();
        mesh.metadata = object;
        for (const auto &key : {"positions", "indices", "uvs", "normals"})
            mesh.metadata.remove(key);
        mesh.sky = object.value("sky").toBool();
        mesh.unlit = object.value("unlit").toBool();
        if (object.value("actorId").isDouble() && object.value("actorBasePosition").toArray().size() == 3) {
            mesh.actorId = object.value("actorId").toInteger(-1);
            mesh.actorBasePosition = vector(object.value("actorBasePosition").toArray());
        }
        const uint hash = qHash(mesh.name);
        mesh.color = QColor::fromHsv(int(hash % 36) + 20, 45, 165 + int(hash % 35)).rgb();
        if (mesh.sky)
            mesh.color = qRgb(64, 83, 105);
        const auto color = object.value("baseColor").toArray();
        if ((color.size() == 3 || color.size() == 4) &&
            std::all_of(color.begin(), color.end(), [](const QJsonValue &v) {
                return v.isDouble() && std::isfinite(v.toDouble()) && v.toDouble() >= 0 && v.toDouble() <= 1;
            }))
            mesh.color =
                QColor::fromRgbF(color[0].toDouble(), color[1].toDouble(), color[2].toDouble()).rgb();
        bool valid = true;
        mesh.vertices.reserve(vertices.size() / 3);
        for (int i = 0; i < vertices.size(); i += 3) {
            QVector3D pos{float(vertices[i].toDouble()), float(vertices[i + 1].toDouble()),
                          float(vertices[i + 2].toDouble())};
            if (!finite(pos)) {
                valid = false;
                break;
            }
            mesh.vertices.push_back(pos);
        }
        mesh.indices.reserve(indices.size());
        const auto normals = object.value("normals").toArray();
        if (!vertices.empty() && normals.size() == vertices.size()) {
            for (int i = 0; i < normals.size(); i += 3) {
                const double nan = std::numeric_limits<double>::quiet_NaN();
                QVector3D n(float(normals[i].toDouble(nan)), float(normals[i + 1].toDouble(nan)),
                            float(normals[i + 2].toDouble(nan)));
                if (!finite(n) || n.lengthSquared() < 1e-8f || n.lengthSquared() > 1.001f) {
                    mesh.normals.clear();
                    break;
                }
                mesh.normals.push_back(n.normalized());
            }
        }
        for (const auto &value : indices) {
            const int index = value.toInt(-1);
            if (index < 0 || index >= int(mesh.vertices.size())) {
                valid = false;
                break;
            }
            mesh.indices.push_back(index);
        }
        const auto uv = object.value("uvs").toArray();
        const auto wrapS = object.value("textureWrapS").toString(),
                   wrapT = object.value("textureWrapT").toString();
        if (uv.size() == qsizetype(mesh.vertices.size()) * 2) {
            bool validUvs = true;
            for (int i = 0; i < uv.size(); i += 2) {
                const double u = uv[i].toDouble(std::numeric_limits<double>::quiet_NaN()),
                             v = uv[i + 1].toDouble(std::numeric_limits<double>::quiet_NaN());
                if (!std::isfinite(u) || !std::isfinite(v) || std::abs(u) > 65504 || std::abs(v) > 65504) {
                    validUvs = false;
                    break;
                }
                mesh.uvs.emplace_back(float(u), float(v));
            }
            if (validUvs && textureIds.contains(object.value("textureId").toString()) &&
                (wrapS == "clamp" || wrapS == "repeat") && (wrapT == "clamp" || wrapT == "repeat")) {
                mesh.texture = textureIds.value(object.value("textureId").toString());
                mesh.repeatS = wrapS == "repeat";
                mesh.repeatT = wrapT == "repeat";
                mesh.linearFilter = object.value("textureFilter").toString() == "linear";
            } else if (!validUvs)
                mesh.uvs.clear();
        }
        if (valid && !mesh.indices.empty()) {
            if (mesh.actorId >= 0)
                modeledActors_.insert(mesh.actorId);
            meshes_.push_back(std::move(mesh));
        }
    }
    updateGridBounds();
    frameAll();
}
void SceneView::setEdits(const QMap<qint64, QJsonArray> &edits) {
    edits_ = edits;
    changed();
}
void SceneView::setSelected(qint64 id) {
    selected_ = id;
    if (id >= 0)
        selectedMesh_ = -1;
    changed();
}
void SceneView::setGridSpacing(double spacing) {
    if (!std::isfinite(spacing))
        return;
    grid_ = float(qBound(.01, spacing, 10000.));
    changed();
}
void SceneView::setSnap(bool enabled) {
    snap_ = enabled;
    update();
}
void SceneView::setWireframe(bool enabled) {
    wireframe_ = enabled;
    changed();
}
void SceneView::setShowSky(bool enabled) {
    showSky_ = enabled;
    changed();
}
void SceneView::setShowTextures(bool enabled) {
    showTextures_ = enabled;
    changed();
}
bool SceneView::setDisplayMode(const QString &mode) {
    const QStringList modes{"material", "unlit", "checker", "missing", "flat"};
    const int index = modes.indexOf(mode);
    if (index < 0)
        return false;
    displayMode_ = index;
    changed();
    return true;
}
void SceneView::setShowOverlays(bool enabled) {
    showOverlays_ = enabled;
    changed();
}
void SceneView::setIsolateSelection(bool enabled) {
    isolateSelection_ = enabled;
    changed();
}
bool SceneView::meshVisible(int index) const {
    const auto &mesh = meshes_[index];
    if (mesh.sky && !showSky_)
        return false;
    return !isolateSelection_ ||
           (selectedMesh_ >= 0 ? selectedMesh_ == index : selected_ >= 0 && mesh.actorId == selected_);
}
QJsonArray SceneView::materialReport() const {
    QJsonArray result;
    for (int i = 0; i < int(meshes_.size()); ++i) {
        const auto &mesh = meshes_[i];
        auto record = mesh.metadata;
        record.insert("viewportTextured", mesh.texture >= 0);
        record.insert("viewportHasUvs", !mesh.uvs.empty());
        record.insert("viewportSmoothNormals", !mesh.normals.empty());
        record.insert("viewportUnlit", mesh.unlit);
        record.insert("viewportVisible", meshVisible(i));
        result.append(record);
    }
    return result;
}
QJsonObject SceneView::selectedMeshReport() const {
    return selectedMesh_ >= 0 && selectedMesh_ < int(meshes_.size()) ? meshes_[selectedMesh_].metadata
                                                                     : QJsonObject{};
}
bool SceneView::frameMesh(const QString &selectionKey) {
    for (int i = 0; i < int(meshes_.size()); ++i)
        if (meshes_[i].selectionKey == selectionKey && !selectionKey.isEmpty()) {
            selected_ = -1;
            selectedMesh_ = i;
            frameSelection();
            return true;
        }
    return false;
}
bool SceneView::setCameraState(const QJsonObject &camera) {
    const auto p = camera.value("pivot").toArray();
    if (p.size() != 3)
        return false;
    for (const auto &v : p)
        if (!v.isDouble() || !std::isfinite(v.toDouble()) || std::abs(v.toDouble()) > 1e6)
            return false;
    for (const auto &key : {"yawRadians", "pitchRadians", "distance"})
        if (!camera.value(key).isDouble() || !std::isfinite(camera.value(key).toDouble()))
            return false;
    const double yaw = camera.value("yawRadians").toDouble(), pitch = camera.value("pitchRadians").toDouble(),
                 d = camera.value("distance").toDouble();
    if (std::abs(yaw) > 100 * pi || std::abs(pitch) > 1.55 || d < .25 || d > 1e6)
        return false;
    pivot_ = vector(p);
    yaw_ = yaw;
    pitch_ = pitch;
    distance_ = d;
    camera_ = pivot_ - forward() * distance_;
    changed();
    return true;
}
int SceneView::texturedMeshCount() const {
    return int(
        std::count_if(meshes_.begin(), meshes_.end(), [](const Mesh &mesh) { return mesh.texture >= 0; }));
}
void SceneView::setShowCollisions(bool enabled) {
    showCollisions_ = enabled;
    changed();
}
void SceneView::setCollisions(const QJsonArray &actors) {
    collisionBoxes_.clear();
    const auto validVector = [](const QJsonValue &value) {
        if (!value.isArray() || value.toArray().size() != 3)
            return false;
        for (const auto &entry : value.toArray())
            if (!entry.isDouble() || !std::isfinite(entry.toDouble()) || std::abs(entry.toDouble()) > 1e6)
                return false;
        return true;
    };
    for (const auto &entry : actors) {
        const auto actor = entry.toObject();
        if (!actor.value("editable").toBool() || !actor.value("actorId").isDouble())
            continue;
        if (!validVector(actor.value("position")) || !validVector(actor.value("offsetWorld")) ||
            !validVector(actor.value("dimensionsWorld")) || !validVector(actor.value("rotationDegrees")))
            continue;
        const auto dimensions = vector(actor.value("dimensionsWorld").toArray());
        const auto rotation = vector(actor.value("rotationDegrees").toArray());
        if (dimensions.x() <= 0 || dimensions.y() <= 0 || dimensions.z() <= 0 || rotation.x() != 0 ||
            rotation.z() != 0 || std::abs(rotation.y()) > 360)
            continue;
        const auto id = actor.value("actorId").toInteger(-1);
        if (id < 0)
            continue;
        collisionBoxes_.insert(id, {id, vector(actor.value("position").toArray()),
                                    vector(actor.value("offsetWorld").toArray()), dimensions, rotation.y()});
    }
    changed();
}
QVector<QVector3D> SceneView::collisionBoxCorners(qint64 actorId) const {
    const auto found = collisionBoxes_.constFind(actorId);
    if (found == collisionBoxes_.cend())
        return {};
    const auto &box = found.value();
    const auto base = edits_.contains(actorId) ? vector(edits_.value(actorId)) : box.position;
    const float angle = box.yaw * (pi / 180.f), sine = std::sin(angle), cosine = std::cos(angle);
    QVector<QVector3D> corners;
    for (int i = 0; i < 8; ++i) {
        // Width/length centered on local X/Z; Y starts at the box base.
        const QVector3D local = box.offset + QVector3D((i & 1 ? .5f : -.5f) * box.dimensions.x(),
                                                       (i & 2 ? 1.f : 0.f) * box.dimensions.y(),
                                                       (i & 4 ? .5f : -.5f) * box.dimensions.z());
        corners.append(base + QVector3D(cosine * local.x() + sine * local.z(), local.y(),
                                        -sine * local.x() + cosine * local.z()));
    }
    return corners;
}
void SceneView::changed() {
    basisForward_ = forward();
    basisRight_ = right();
    basisUp_ = up();
    dirty_ = true;
    update();
}

void SceneView::updateGridBounds() {
    bool any = false;
    QVector2D minimum, maximum;
    const auto include = [&](QVector3D point) {
        // Keep malformed scene metadata from producing unbounded grid indices.
        if (!finite(point) || std::abs(point.x()) > 1e7f || std::abs(point.z()) > 1e7f)
            return;
        const QVector2D p(point.x(), point.z());
        if (!any) {
            minimum = maximum = p;
            any = true;
        } else
            for (int axis = 0; axis < 2; ++axis) {
                minimum[axis] = qMin(minimum[axis], p[axis]);
                maximum[axis] = qMax(maximum[axis], p[axis]);
            }
    };
    if (contentBounds_) {
        include(contentMin_);
        include(contentMax_);
    }
    if (!any) {
        for (const auto &mesh : meshes_)
            if (!mesh.sky)
                for (const auto &point : mesh.vertices)
                    include(point);
        for (const auto &actor : actors_)
            include(actor.position);
    }
    gridMin_ = any ? minimum : QVector2D(-25, -25);
    gridMax_ = any ? maximum : QVector2D(25, 25);
}

SceneView::WorldGrid SceneView::worldGrid() const {
    // At most ~100 lines per axis. Coarsen in powers of two of the snap step
    // using the saved map extent, NEVER distance_, pivot_ or camera_. Main
    // lines are absolute multiples of eight; world X/Z axes stay at zero.
    const double span =
        qMax(20., qMax(double(gridMax_.x()) - gridMin_.x(), double(gridMax_.y()) - gridMin_.y()));
    const double step = grid_ * std::pow(2., qMax(0., std::ceil(std::log2(span / (80. * grid_)))));
    return {step, qint64(std::floor(gridMin_.x() / step)) - 8, qint64(std::ceil(gridMax_.x() / step)) + 8,
            qint64(std::floor(gridMin_.y() / step)) - 8, qint64(std::ceil(gridMax_.y() / step)) + 8};
}

void SceneView::frameAll() {
    QVector3D minimum(1e30f, 1e30f, 1e30f), maximum(-1e30f, -1e30f, -1e30f);
    bool any = false;
    auto include = [&](QVector3D point) {
        for (int axis = 0; axis < 3; ++axis) {
            minimum[axis] = qMin(minimum[axis], point[axis]);
            maximum[axis] = qMax(maximum[axis], point[axis]);
        }
        any = true;
    };
    if (contentBounds_) {
        include(contentMin_);
        include(contentMax_);
    } else {
        for (const auto &mesh : meshes_)
            if (!mesh.sky)
                for (const auto &point : mesh.vertices)
                    include(point);
        for (const auto &actor : actors_)
            include(position(actor));
    }
    if (!any) {
        minimum = {-25, 0, -25};
        maximum = {25, 15, 25};
    }
    pivot_ = (minimum + maximum) * .5f;
    const float radius = qMax(10.f, (maximum - minimum).length() * .5f);
    distance_ = radius / focalAngle * 1.2f;
    yaw_ = .6f;
    pitch_ = -.48f;
    camera_ = pivot_ - forward() * distance_;
    proxySize_ = qBound(.25f, radius / 250.f, 5.f);
    flySpeed_ = qMax(10.f, radius * .25f);
    changed();
}
void SceneView::frameSelection() {
    const auto *actor = selectedActor();
    if (actor) {
        pivot_ = position(*actor);
        distance_ = qMax(20.f, proxySize_ * 16);
    } else if (selectedMesh_ >= 0 && selectedMesh_ < int(meshes_.size())) {
        QVector3D minimum(1e30f, 1e30f, 1e30f), maximum(-1e30f, -1e30f, -1e30f);
        const auto &mesh = meshes_[selectedMesh_];
        const auto offset = mesh.actorId >= 0 && edits_.contains(mesh.actorId)
                                ? vector(edits_.value(mesh.actorId)) - mesh.actorBasePosition
                                : QVector3D{};
        for (const auto &vertex : mesh.vertices)
            for (int axis = 0; axis < 3; ++axis) {
                minimum[axis] = qMin(minimum[axis], vertex[axis]);
                maximum[axis] = qMax(maximum[axis], vertex[axis]);
            }
        pivot_ = (minimum + maximum) * .5f + offset;
        distance_ = qMax(5.f, (maximum - minimum).length() * .6f / focalAngle);
    } else {
        frameAll();
        return;
    }
    camera_ = pivot_ - forward() * distance_;
    changed();
}
bool SceneView::frameObject(qint64 id) {
    for (const auto &actor : actors_)
        if (actor.id == id) {
            setSelected(id);
            frameSelection();
            return true;
        }
    return false;
}
QJsonObject SceneView::cameraState() const {
    const auto array = [](QVector3D v) { return QJsonArray{v.x(), v.y(), v.z()}; };
    const auto g = worldGrid();
    return {{"position", array(camera_)},
            {"pivot", array(pivot_)},
            {"forward", array(forward())},
            {"up", array(up())},
            {"yawRadians", yaw_},
            {"pitchRadians", pitch_},
            {"distance", distance_},
            {"verticalFovDegrees", 60},
            {"nearPlane", near_},
            {"worldAxes", "editor Y-up; source transforms follow level_builder worldPosition"},
            {"skyVisible", showSky_},
            {"texturesVisible", showTextures_},
            {"displayMode", QStringList{"material", "unlit", "checker", "missing", "flat"}.at(displayMode_)},
            {"overlaysVisible", showOverlays_},
            {"isolatedSelection", isolateSelection_},
            {"previewLighting", lightingState()},
            {"editorGrid", QJsonObject{{"anchor", "world origin"},
                                       {"followsCamera", false},
                                       {"planeY", 0},
                                       {"spacing", g.spacing},
                                       {"majorEvery", 8},
                                       {"minXZ", QJsonArray{g.firstX * g.spacing, g.firstZ * g.spacing}},
                                       {"maxXZ", QJsonArray{g.lastX * g.spacing, g.lastZ * g.spacing}},
                                       {"purpose", "editor reference only; not game geometry or collision"}}},
            {"lighting", displayMode_ >= 1 && displayMode_ <= 3
                             ? "unlit diagnostic; no reconstructed game lighting"
                             : "adjustable editor preview shading, not reconstructed game lighting"}};
}
QPointF SceneView::screenPosition(qint64 id) const {
    for (const auto &actor : actors_)
        if (actor.id == id) {
            QPointF screen;
            if (project(position(actor), screen))
                return screen;
        }
    return {-1, -1};
}
QPointF SceneView::worldToScreen(QVector3D position) const {
    QPointF screen(-1, -1);
    project(position, screen);
    return screen;
}
QPointF SceneView::visibleModelPoint(qint64 actorId) const {
    if (dirty_ || raster_.size() != size())
        return {-1, -1};
    const auto origin = screenPosition(actorId);
    QPointF result(-1, -1);
    double bestDistance = std::numeric_limits<double>::max();
    for (int y = 0; y < height(); ++y)
        for (int x = 0; x < width(); ++x) {
            const int item = owner_[size_t(y) * width() + x];
            if (item <= 0 || item > int(meshes_.size()) || meshes_[item - 1].actorId != actorId)
                continue;
            const QPointF point(x + .5, y + .5);
            const auto delta = point - origin;
            const double distance = QPointF::dotProduct(delta, delta);
            if (distance < bestDistance) {
                result = point;
                bestDistance = distance;
            }
        }
    return result;
}
float SceneView::gizmoSize() const {
    const auto *actor = selectedActor();
    return actor ? qMax(.01f, cameraPoint(position(*actor)).z()) * (2 * focalAngle) / qMax(1, height()) * 90
                 : 1;
}
QPointF SceneView::translationHandle(int axis) const {
    const auto *actor = selectedActor();
    QPointF result(-1, -1);
    if (actor && axis >= 0 && axis < 3)
        project(position(*actor) + axes[axis] * gizmoSize(), result);
    return result;
}
int SceneView::hitAxis(QPointF point) const {
    const auto *actor = selectedActor();
    if (!actor || !actor->editable)
        return -1;
    QPointF origin;
    if (!project(position(*actor), origin))
        return -1;
    float best = 8;
    int hit = -1;
    for (int axis = 0; axis < 3; ++axis) {
        const auto end = translationHandle(axis);
        if (std::hypot(end.x() - origin.x(), end.y() - origin.y()) < 8)
            continue;
        const float distance = segmentDistance(point, origin, end);
        if (distance < best) {
            hit = axis;
            best = distance;
        }
    }
    return hit;
}
float SceneView::axisParameter(QPointF point, QVector3D origin, int axis) const {
    const auto direction = ray(point);
    const auto offset = origin - camera_;
    const float b = dot(axes[axis], direction);
    const float denominator = 1 - b * b;
    if (denominator < .0001f)
        return 0;
    return (b * dot(direction, offset) - dot(axes[axis], offset)) / denominator;
}

void SceneView::rasterTriangle(Projected a, Projected b, Projected c, QRgb color, int item, const Mesh *mesh,
                               QVector3D brightness, bool tint) {
    const float area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (!std::isfinite(area) || std::abs(area) < .01f)
        return;
    if (area < 0) {
        std::swap(b, c);
    }
    const float inverseArea = 1 / std::abs(area);
    const int minX = qMax(0, int(std::floor(qMax(-1.f, std::min({a.x, b.x, c.x})))));
    const int maxX = qMin(width() - 1, int(std::ceil(qMin(float(width()), std::max({a.x, b.x, c.x})))));
    const int minY = qMax(0, int(std::floor(qMax(-1.f, std::min({a.y, b.y, c.y})))));
    const int maxY = qMin(height() - 1, int(std::ceil(qMin(float(height()), std::max({a.y, b.y, c.y})))));
    if (minX > maxX || minY > maxY)
        return;
    ++renderedTriangles_;
    for (int y = minY; y <= maxY; ++y) {
        auto *pixels = reinterpret_cast<QRgb *>(raster_.scanLine(y));
        for (int x = minX; x <= maxX; ++x) {
            const float px = x + .5f, py = y + .5f;
            const float w0 = (c.x - b.x) * (py - b.y) - (c.y - b.y) * (px - b.x);
            const float w1 = (a.x - c.x) * (py - c.y) - (a.y - c.y) * (px - c.x);
            const float w2 = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
            if (w0 < 0 || w1 < 0 || w2 < 0)
                continue;
            const float inverseZ = (w0 * a.inverseZ + w1 * b.inverseZ + w2 * c.inverseZ) * inverseArea;
            const size_t at = size_t(y) * width() + x;
            if (inverseZ > depth_[at]) {
                QRgb shaded = color;
                if (mesh && (displayMode_ == 2 || (mesh->texture >= 0 && showTextures_))) {
                    const float denominator = inverseZ / inverseArea;
                    float u = (w0 * a.uOverZ + w1 * b.uOverZ + w2 * c.uOverZ) / denominator;
                    float v = (w0 * a.vOverZ + w1 * b.vOverZ + w2 * c.vOverZ) / denominator;
                    if (displayMode_ == 2) {
                        const int checker = (int(std::floor(u * 8)) + int(std::floor(v * 8))) & 1;
                        shaded = checker ? qRgb(225, 225, 225) : qRgb(40, 75, 110);
                    } else {
                        const auto &texture = textures_[mesh->texture];
                        u = mesh->repeatS ? u - std::floor(u) : qBound(0.f, u, 1.f);
                        v = mesh->repeatT ? v - std::floor(v) : qBound(0.f, v, 1.f);
                        const int tx = qBound(0, int(u * texture.width()), texture.width() - 1),
                                  ty = qBound(0, int(v * texture.height()), texture.height() - 1);
                        shaded =
                            lit(reinterpret_cast<const QRgb *>(texture.constScanLine(ty))[tx], brightness);
                        if (mesh->linearFilter) {
                            const float fx = u * texture.width() - .5f, fy = v * texture.height() - .5f;
                            const int ix = int(std::floor(fx)), iy = int(std::floor(fy));
                            const float ax = fx - ix, ay = fy - iy;
                            const auto pixel = [&](int x, int y) {
                                x = mesh->repeatS ? (x % texture.width() + texture.width()) % texture.width()
                                                  : qBound(0, x, texture.width() - 1);
                                y = mesh->repeatT
                                        ? (y % texture.height() + texture.height()) % texture.height()
                                        : qBound(0, y, texture.height() - 1);
                                return reinterpret_cast<const QRgb *>(texture.constScanLine(y))[x];
                            };
                            const QRgb pixels[]{pixel(ix, iy), pixel(ix + 1, iy), pixel(ix, iy + 1),
                                                pixel(ix + 1, iy + 1)};
                            const float weights[]{(1 - ax) * (1 - ay), ax * (1 - ay), (1 - ax) * ay, ax * ay};
                            float red = 0, green = 0, blue = 0;
                            for (int i = 0; i < 4; ++i) {
                                red += qRed(pixels[i]) * weights[i];
                                green += qGreen(pixels[i]) * weights[i];
                                blue += qBlue(pixels[i]) * weights[i];
                            }
                            shaded = qRgb(qBound(0, int(std::round(red * brightness.x())), 255),
                                          qBound(0, int(std::round(green * brightness.y())), 255),
                                          qBound(0, int(std::round(blue * brightness.z())), 255));
                        }
                        // RGB-only preview: game alpha/shader semantics are not inferred.
                        if (tint)
                            shaded = qRgb((qRed(shaded) * 3 + 223) / 4, (qGreen(shaded) * 3 + 172) / 4,
                                          (qBlue(shaded) * 3 + 69) / 4);
                    }
                }
                depth_[at] = inverseZ;
                pixels[x] = shaded;
                owner_[at] = item;
            }
        }
    }
}
void SceneView::triangle(QVector3D a, QVector3D b, QVector3D c, QRgb color, int item, const Mesh *mesh,
                         QVector2D uvA, QVector2D uvB, QVector2D uvC, QVector3D brightness, bool tint) {
    const std::array<QVector3D, 3> input{{cameraPoint(a), cameraPoint(b), cameraPoint(c)}};
    std::array<QVector3D, 5> clipped{};
    const std::array<QVector2D, 3> inputUvs{{uvA, uvB, uvC}};
    std::array<QVector2D, 5> clippedUvs{};
    int count = 0;
    for (int i = 0; i < 3; ++i) {
        const auto &current = input[i];
        const auto &previous = input[(i + 2) % 3];
        const bool in = current.z() >= near_, previousIn = previous.z() >= near_;
        if (in != previousIn) {
            const float t = (near_ - previous.z()) / (current.z() - previous.z());
            clippedUvs[count] = inputUvs[(i + 2) % 3] + (inputUvs[i] - inputUvs[(i + 2) % 3]) * t;
            clipped[count++] = previous + (current - previous) * t;
        }
        if (in) {
            clippedUvs[count] = inputUvs[i];
            clipped[count++] = current;
        }
    }
    if (count < 3)
        return;
    const float scale = qMax(1, height()) / (2 * focalAngle);
    auto projectCamera = [&](int i) -> Projected {
        const auto p = clipped[i];
        return {width() * .5f + p.x() * scale / p.z(), height() * .5f - p.y() * scale / p.z(), 1 / p.z(),
                clippedUvs[i].x() / p.z(), clippedUvs[i].y() / p.z()};
    };
    for (int i = 1; i + 1 < count; ++i)
        rasterTriangle(projectCamera(0), projectCamera(i), projectCamera(i + 1), color, item, mesh,
                       brightness, tint);
}
void SceneView::line(QVector3D a, QVector3D b, QRgb color, bool testDepth) {
    auto ca = cameraPoint(a), cb = cameraPoint(b);
    if (ca.z() < near_ && cb.z() < near_)
        return;
    if (ca.z() < near_)
        ca += (cb - ca) * ((near_ - ca.z()) / (cb.z() - ca.z()));
    if (cb.z() < near_)
        cb += (ca - cb) * ((near_ - cb.z()) / (ca.z() - cb.z()));
    const float scale = qMax(1, height()) / (2 * focalAngle);
    QPointF pa(width() * .5 + ca.x() * scale / ca.z(), height() * .5 - ca.y() * scale / ca.z());
    QPointF pb(width() * .5 + cb.x() * scale / cb.z(), height() * .5 - cb.y() * scale / cb.z());
    // Clip the projected segment before stepping, so a near-plane crossing
    // cannot produce millions of offscreen iterations.
    const auto delta = pb - pa;
    double low = 0, high = 1;
    auto clip = [&](double p, double q) {
        if (std::abs(p) < 1e-10)
            return q >= 0;
        const double t = q / p;
        if (p < 0)
            low = qMax(low, t);
        else
            high = qMin(high, t);
        return low <= high;
    };
    if (!clip(-delta.x(), pa.x()) || !clip(delta.x(), width() - 1 - pa.x()) || !clip(-delta.y(), pa.y()) ||
        !clip(delta.y(), height() - 1 - pa.y()))
        return;
    const auto start = pa + delta * low, end = pa + delta * high;
    const int steps =
        qMax(1, int(std::ceil(qMax(std::abs(end.x() - start.x()), std::abs(end.y() - start.y())))));
    for (int step = 0; step <= steps; ++step) {
        const double t = low + (high - low) * step / steps;
        const auto point = pa + delta * t;
        const int x = qBound(0, int(std::round(point.x())), width() - 1),
                  y = qBound(0, int(std::round(point.y())), height() - 1);
        const float inverseZ = float((1 - t) / ca.z() + t / cb.z());
        const size_t at = size_t(y) * width() + x;
        if (!testDepth || inverseZ * 1.00005f >= depth_[at])
            reinterpret_cast<QRgb *>(raster_.scanLine(y))[x] = color;
    }
}

void SceneView::render() {
    if (width() < 1 || height() < 1)
        return;
    QElapsedTimer elapsed;
    elapsed.start();
    raster_ = QImage(size(), QImage::Format_RGB32);
    raster_.fill(backgroundColor_);
    depth_.assign(size_t(width()) * height(), 0);
    owner_.assign(depth_.size(), 0);
    renderedTriangles_ = 0;
    const QVector3D light = lightDirection_.normalized();
    usedGpu_ = false;
    if (rendererMode_ != "cpu" &&
        (rendererMode_ == "gpu" || QGuiApplication::platformName() != "offscreen")) {
        if (!gpu_)
            gpu_ = std::make_unique<GpuSceneRenderer>();
        usedGpu_ = gpu_->render(*this);
        if (!usedGpu_) {
            raster_.fill(backgroundColor_);
            std::fill(depth_.begin(), depth_.end(), 0);
            std::fill(owner_.begin(), owner_.end(), 0);
            renderedTriangles_ = 0;
        }
    }
    for (int item = 0; item < int(meshes_.size()); ++item) {
        const auto &mesh = meshes_[item];
        if (!meshVisible(item))
            continue;
        const auto offset = mesh.actorId >= 0 && edits_.contains(mesh.actorId)
                                ? vector(edits_[mesh.actorId]) - mesh.actorBasePosition
                                : QVector3D{};
        if (!usedGpu_)
            for (size_t i = 0; i + 2 < mesh.indices.size(); i += 3) {
                const auto a = mesh.vertices[mesh.indices[i]] + offset,
                           b = mesh.vertices[mesh.indices[i + 1]] + offset,
                           c = mesh.vertices[mesh.indices[i + 2]] + offset;
                // CPU reference uses the triangle-average normal; OpenGL interpolates
                // the individual vertex normals per fragment for smooth shading.
                const auto normal = mesh.normals.empty()
                                        ? QVector3D::crossProduct(b - a, c - a).normalized()
                                        : (mesh.normals[mesh.indices[i]] + mesh.normals[mesh.indices[i + 1]] +
                                           mesh.normals[mesh.indices[i + 2]])
                                              .normalized();
                const bool selected =
                    showOverlays_ && displayMode_ == 0 &&
                    (selectedMesh_ == item || (mesh.actorId >= 0 && mesh.actorId == selected_));
                QRgb base = selected ? qRgb(223, 172, 69) : mesh.color;
                if (displayMode_ == 3)
                    base = mesh.texture >= 0 ? qRgb(50, 180, 100) : qRgb(235, 35, 180);
                if (displayMode_ == 2 && mesh.uvs.empty())
                    base = qRgb(235, 35, 180);
                const float ndl = dot(normal, light);
                const QVector3D brightness =
                    mesh.unlit || (displayMode_ >= 1 && displayMode_ <= 3)
                        ? QVector3D(1, 1, 1)
                        : (ambientLight_ +
                           keyLight_ *
                               (keyIntensity_ * (twoSidedLighting_ ? std::abs(ndl) : qMax(0.f, ndl)))) *
                              std::exp2(exposure_);
                const bool textured = displayMode_ == 2
                                          ? !mesh.uvs.empty()
                                          : displayMode_ < 2 && mesh.texture >= 0 && showTextures_;
                triangle(a, b, c, lit(base, brightness), item + 1, textured ? &mesh : nullptr,
                         textured ? mesh.uvs[mesh.indices[i]] : QVector2D{},
                         textured ? mesh.uvs[mesh.indices[i + 1]] : QVector2D{},
                         textured ? mesh.uvs[mesh.indices[i + 2]] : QVector2D{}, brightness, selected);
            }
        if (wireframe_)
            for (size_t i = 0; i + 2 < mesh.indices.size(); i += 3) {
                const auto a = mesh.vertices[mesh.indices[i]] + offset,
                           b = mesh.vertices[mesh.indices[i + 1]] + offset,
                           c = mesh.vertices[mesh.indices[i + 2]] + offset;
                line(a, b, qRgb(52, 58, 62));
                line(b, c, qRgb(52, 58, 62));
                line(c, a, qRgb(52, 58, 62));
            }
    }
    if (!showOverlays_) {
        dirty_ = false;
        lastFrameMs_ = elapsed.nsecsElapsed() / 1e6;
        return;
    }
    const auto g = worldGrid();
    for (qint64 i = g.firstX; i <= g.lastX; ++i) {
        const QRgb color = i == 0 ? qRgb(62, 105, 153) : i % 8 == 0 ? qRgb(76, 91, 102) : qRgb(48, 62, 73);
        line({float(i * g.spacing), 0, float(g.firstZ * g.spacing)},
             {float(i * g.spacing), 0, float(g.lastZ * g.spacing)}, color);
    }
    for (qint64 i = g.firstZ; i <= g.lastZ; ++i) {
        const QRgb color = i == 0 ? qRgb(151, 67, 75) : i % 8 == 0 ? qRgb(76, 91, 102) : qRgb(48, 62, 73);
        line({float(g.firstX * g.spacing), 0, float(i * g.spacing)},
             {float(g.lastX * g.spacing), 0, float(i * g.spacing)}, color);
    }
    for (int item = 0; item < int(actors_.size()); ++item) {
        const auto &actor = actors_[item];
        if (isolateSelection_ && (selectedMesh_ >= 0 || actor.id != selected_))
            continue;
        const auto center = position(actor);
        QPointF screen;
        if (!project(center, screen) || screen.x() < -25 || screen.x() > width() + 25 || screen.y() < -25 ||
            screen.y() > height() + 25)
            continue;
        const QRgb idle = actor.proxyKind == "character"                             ? qRgb(219, 117, 112)
                          : actor.proxyKind == "chest" || actor.proxyKind == "crate" ? qRgb(192, 151, 84)
                          : actor.proxyKind == "gate"                                ? qRgb(149, 144, 197)
                                                                                     : qRgb(65, 182, 198);
        const QRgb base = selected_ == actor.id       ? qRgb(255, 185, 60)
                          : edits_.contains(actor.id) ? qRgb(230, 138, 63)
                          : actor.editable            ? idle
                                                      : qRgb(146, 155, 162);
        if (modeledActors_.contains(actor.id)) {
            const float inverseZ = 1 / cameraPoint(center).z();
            for (int dy = -2; dy <= 2; ++dy)
                for (int dx = -2; dx <= 2; ++dx) {
                    const int x = int(screen.x()) + dx, y = int(screen.y()) + dy;
                    if (x < 0 || y < 0 || x >= width() || y >= height())
                        continue;
                    const size_t at = size_t(y) * width() + x;
                    const int owner = owner_[at];
                    const bool sameActorMesh = owner > 0 && meshes_[owner - 1].actorId == actor.id;
                    if (sameActorMesh || inverseZ >= depth_[at]) {
                        reinterpret_cast<QRgb *>(raster_.scanLine(y))[x] = base;
                        owner_[at] = -item - 1;
                    }
                }
            continue;
        }
        for (size_t triangleIndex = 0; triangleIndex < actor.placeholderTriangles.size();
             triangleIndex += 3) {
            const auto a = center + actor.placeholderTriangles[triangleIndex];
            const auto b = center + actor.placeholderTriangles[triangleIndex + 1];
            const auto c = center + actor.placeholderTriangles[triangleIndex + 2];
            const auto normal = QVector3D::crossProduct(b - a, c - a).normalized();
            triangle(a, b, c, lit(base, .5f + .5f * std::abs(dot(normal, light))), -item - 1);
        }
    }
    if (showCollisions_)
        for (auto it = collisionBoxes_.cbegin(); it != collisionBoxes_.cend(); ++it) {
            const auto corners = collisionBoxCorners(it.key());
            const QRgb color = it.key() == selected_ ? qRgb(255, 208, 90) : qRgb(231, 125, 246);
            for (int i = 0; i < 8; ++i)
                for (int bit : {1, 2, 4})
                    if (!(i & bit))
                        line(corners[i], corners[i | bit], color,
                             false); // Explicit x-ray overlay; does not alter picking/depth.
        }
    dirty_ = false;
    lastFrameMs_ = elapsed.nsecsElapsed() / 1e6;
}

void SceneView::paintEvent(QPaintEvent *) {
    if (dirty_ || raster_.size() != size())
        render();
    QPainter painter(this);
    painter.drawImage(0, 0, raster_);
    if (!showOverlays_)
        return;
    painter.setRenderHint(QPainter::Antialiasing);
    // Keep navigation help and scene counts readable over pale map surfaces.
    painter.fillRect(QRect(0, 0, width(), 28), QColor(19, 25, 31, 210));
    painter.fillRect(QRect(0, height() - 29, width(), 29), QColor(19, 25, 31, 210));
    painter.setPen(QColor("#c9d6df"));
    painter.drawText(
        12, 20,
        QString("PERSPECTIVE  ·  %1 actors (%2 models / %3 proxies)  ·  %4 meshes  ·  sky %5%6")
            .arg(actors_.size())
            .arg(modeledActors_.size())
            .arg(actors_.size() - modeledActors_.size())
            .arg(meshes_.size())
            .arg(showSky_ ? "visible" : "hidden")
            .arg((usedGpu_ ? "  ·  OpenGL" : "  ·  CPU") +
                 (showCollisions_
                      ? QString("  ·  %1 eligible boxes (x-ray, partial)").arg(collisionBoxes_.size())
                      : QString{})));
    painter.setPen(QColor("#9dafbb"));
    painter.drawText(
        12, height() - 12,
        QString(
            "MMB orbit | RMB + WASD/QE fly | F frame | snap %1 (%2) | world grid %3 | RGB textures %4/%5%6")
            .arg(snap_ ? "on" : "off")
            .arg(grid_)
            .arg(worldGrid().spacing)
            .arg(showTextures_ ? texturedMeshCount() : 0)
            .arg(meshes_.size())
            .arg(showTextures_ ? " (preview)" : " (off)"));
    const auto *actor = selectedActor();
    if (actor) {
        QPointF origin;
        if (project(position(*actor), origin)) {
            const auto label = QString("#%1 %2").arg(actor->id).arg(actor->name);
            const auto baseline = origin + QPointF(12, -14);
            const auto labelBounds = painter.fontMetrics()
                                         .boundingRect(label)
                                         .translated(baseline.toPoint())
                                         .adjusted(-4, -2, 4, 2);
            painter.fillRect(labelBounds, QColor(19, 25, 31, 210));
            painter.setPen(QColor("#ffe2a1"));
            painter.drawText(baseline, label);
            if (actor->editable)
                for (int axis = 0; axis < 3; ++axis) {
                    const auto end = translationHandle(axis);
                    const auto delta = end - origin;
                    const double length = std::hypot(delta.x(), delta.y());
                    if (length < 8)
                        continue;
                    const QColor color = draggingAxis_ == axis ? QColor("#ffe36b") : axisColors[axis];
                    painter.setPen(QPen(color, 3));
                    painter.drawLine(origin, end);
                    const auto direction = delta / length;
                    const QPointF side(-direction.y(), direction.x());
                    painter.setBrush(color);
                    painter.drawPolygon(
                        QPolygonF{end, end - direction * 10 + side * 4, end - direction * 10 - side * 4});
                    painter.drawText(end + QPointF(5, -5), QString("XYZ").mid(axis, 1));
                }
        }
    }
    if (actors_.empty() && meshes_.empty()) {
        painter.setPen(QColor("#b7c6d2"));
        painter.drawText(rect(), Qt::AlignCenter,
                         "Open a level to load its 3D scene.\nLoad a companion geometry IGZ to show decoded "
                         "map triangles.");
    }
}
void SceneView::resizeEvent(QResizeEvent *) { changed(); }

void SceneView::mousePressEvent(QMouseEvent *event) {
    setFocus();
    lastMouse_ = event->position();
    if (event->button() == Qt::RightButton) {
        looking_ = true;
        setCursor(Qt::BlankCursor);
        return;
    }
    if (event->button() == Qt::MiddleButton ||
        (event->button() == Qt::LeftButton && event->modifiers().testFlag(Qt::AltModifier))) {
        panning_ = event->modifiers().testFlag(Qt::ShiftModifier);
        orbiting_ = !panning_;
        setCursor(Qt::ClosedHandCursor);
        return;
    }
    if (event->button() != Qt::LeftButton)
        return;
    draggingAxis_ = hitAxis(event->position());
    if (draggingAxis_ >= 0) {
        dragStart_ = position(*selectedActor());
        dragParameter_ = axisParameter(event->position(), dragStart_, draggingAxis_);
        setCursor(Qt::SizeAllCursor);
        update();
        return;
    }
    if (dirty_)
        render();
    const int x = int(event->position().x()), y = int(event->position().y());
    if (x < 0 || y < 0 || x >= width() || y >= height())
        return;
    int item = owner_[size_t(y) * width() + x];
    // A few pixels of tolerance makes distant point actors practical to select.
    const bool actorMeshHit = item > 0 && meshes_[item - 1].actorId >= 0;
    if (item >= 0 && !actorMeshHit)
        for (int dy = -5; dy <= 5 && item >= 0; ++dy)
            for (int dx = -5; dx <= 5; ++dx) {
                const int sx = qBound(0, x + dx, width() - 1), sy = qBound(0, y + dy, height() - 1);
                const int nearby = owner_[size_t(sy) * width() + sx];
                if (nearby < 0) {
                    item = nearby;
                    break;
                }
            }
    if (item < 0 && -item - 1 < int(actors_.size())) {
        selected_ = actors_[-item - 1].id;
        selectedMesh_ = -1;
        if (onSelect)
            onSelect(selected_);
    } else if (item > 0 && item - 1 < int(meshes_.size())) {
        const auto &mesh = meshes_[item - 1];
        const auto metadata = mesh.metadata;
        if (mesh.actorId >= 0) {
            selected_ = mesh.actorId;
            selectedMesh_ = -1;
            if (onSelect)
                onSelect(selected_);
        } else {
            selected_ = -1;
            selectedMesh_ = item - 1;
            if (onSelectGeometry)
                onSelectGeometry(meshes_[selectedMesh_].name);
        }
        if (onInspectMesh)
            onInspectMesh(metadata);
    }
    changed();
}
void SceneView::mouseMoveEvent(QMouseEvent *event) {
    const auto delta = event->position() - lastMouse_;
    lastMouse_ = event->position();
    if (draggingAxis_ >= 0) {
        QVector3D moved = dragStart_;
        moved[draggingAxis_] += axisParameter(event->position(), dragStart_, draggingAxis_) - dragParameter_;
        if (snap_)
            moved[draggingAxis_] = std::round(moved[draggingAxis_] / grid_) * grid_;
        moved[draggingAxis_] = qBound(-1e6f, moved[draggingAxis_], 1e6f);
        if (finite(moved) && onMove)
            onMove(selected_, moved);
        return;
    }
    if (looking_ || orbiting_) {
        yaw_ += float(delta.x()) * .006f;
        pitch_ = qBound(-pi * .49f, pitch_ - float(delta.y()) * .006f, pi * .49f);
        if (orbiting_)
            camera_ = pivot_ - forward() * distance_;
        else
            pivot_ = camera_ + forward() * distance_;
        changed();
    } else if (panning_) {
        const float scale = distance_ * (2 * focalAngle) / qMax(1, height());
        const auto move = right() * float(-delta.x() * scale) + up() * float(delta.y() * scale);
        camera_ += move;
        pivot_ += move;
        changed();
    } else
        setCursor(hitAxis(event->position()) >= 0 ? Qt::SizeAllCursor : Qt::ArrowCursor);
}
void SceneView::mouseReleaseEvent(QMouseEvent *event) {
    if (event->button() == Qt::RightButton) {
        looking_ = false;
        keys_.clear();
    }
    if (event->button() == Qt::LeftButton)
        draggingAxis_ = -1;
    if (event->button() == Qt::MiddleButton || event->button() == Qt::LeftButton) {
        orbiting_ = false;
        panning_ = false;
    }
    setCursor(Qt::ArrowCursor);
    update();
}
void SceneView::wheelEvent(QWheelEvent *event) {
    const float factor = std::pow(.85f, event->angleDelta().y() / 120.f);
    if (looking_)
        flySpeed_ = qBound(.1f, flySpeed_ / factor, 100000.f);
    else {
        distance_ = qBound(.25f, distance_ * factor, 3000000.f);
        camera_ = pivot_ - forward() * distance_;
        changed();
    }
    event->accept();
}
void SceneView::keyPressEvent(QKeyEvent *event) {
    if (event->key() == Qt::Key_F && !looking_) {
        frameSelection();
        event->accept();
        return;
    }
    if (event->key() == Qt::Key_Home && !looking_) {
        frameAll();
        event->accept();
        return;
    }
    if (event->key() == Qt::Key_Escape) {
        if (draggingAxis_ >= 0 && onMove)
            onMove(selected_, dragStart_);
        draggingAxis_ = -1;
        looking_ = orbiting_ = panning_ = false;
        keys_.clear();
        setCursor(Qt::ArrowCursor);
        return;
    }
    keys_.insert(event->key());
    event->accept();
}
void SceneView::keyReleaseEvent(QKeyEvent *event) {
    if (!event->isAutoRepeat())
        keys_.remove(event->key());
    event->accept();
}
void SceneView::focusOutEvent(QFocusEvent *) {
    keys_.clear();
    looking_ = orbiting_ = panning_ = false;
    draggingAxis_ = -1;
    setCursor(Qt::ArrowCursor);
}
void SceneView::navigate() {
    const float seconds = qMin(.1f, movementTime_.restart() / 1000.f);
    if (!looking_ || keys_.isEmpty() || !isEnabled())
        return;
    QVector3D direction;
    if (keys_.contains(Qt::Key_W))
        direction += forward();
    if (keys_.contains(Qt::Key_S))
        direction -= forward();
    if (keys_.contains(Qt::Key_D))
        direction += right();
    if (keys_.contains(Qt::Key_A))
        direction -= right();
    if (keys_.contains(Qt::Key_E))
        direction += QVector3D(0, 1, 0);
    if (keys_.contains(Qt::Key_Q))
        direction -= QVector3D(0, 1, 0);
    if (direction.isNull())
        return;
    const auto move = direction.normalized() * flySpeed_ * seconds * (keys_.contains(Qt::Key_Shift) ? 4 : 1);
    camera_ += move;
    pivot_ += move;
    changed();
}
