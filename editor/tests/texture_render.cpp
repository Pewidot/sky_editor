#include "sceneview.h"
#include <QApplication>
#include <QCryptographicHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMouseEvent>
#include <QWheelEvent>
#include <cstdio>

int main(int argc, char **argv) {
    QApplication app(argc, argv);
    // Four unmistakable colors; no copyrighted resources or game process.
    const QByteArray pixels = QByteArray::fromHex("ff0000ff00ff00ff0000ffffffffffff");
    const QString id(64, 'a');
    QJsonObject texture{
        {"id", id},
        {"width", 2},
        {"height", 2},
        {"rgbaBase64", QString::fromLatin1(pixels.toBase64())},
        {"rgbaSha256",
         QString::fromLatin1(QCryptographicHash::hash(pixels, QCryptographicHash::Sha256).toHex())}};
    QJsonObject mesh{{"id", 1},
                     {"selectionKey", "geometry:1"},
                     {"name", "Synthetic textured quad"},
                     {"positions", QJsonArray{-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5}},
                     {"indices", QJsonArray{0, 1, 2, 0, 2, 3}},
                     {"uvs", QJsonArray{0, 0, 1, 0, 1, 1, 0, 1}},
                     {"textureId", id},
                     {"textureWrapS", "clamp"},
                     {"textureWrapT", "clamp"}};
    QJsonObject scene{{"textures", QJsonArray{texture}}, {"meshes", QJsonArray{mesh}}};
    SceneView view;
    view.resize(720, 520);
    view.setGridSpacing(10000);
    view.setScene(scene);
    view.show();
    QApplication::processEvents();
    const auto capture = [&] {
        QImage image(view.size(), QImage::Format_RGB32);
        image.fill(Qt::black);
        view.QWidget::render(&image);
        return image;
    };
    const auto image = capture();
    if (qEnvironmentVariable("SKYLANDERS_RENDERER") == "gpu" &&
        view.rendererState().value("active") != "opengl") {
        std::fprintf(stderr, "GPU test did not use OpenGL: %s\n",
                     QJsonDocument(view.rendererState()).toJson(QJsonDocument::Compact).constData());
        return 11;
    }
    if (view.texturedMeshCount() != 1 || view.meshCount() != 1)
        return 1;
    const QVector3D samples[]{{-2.2f, 0, -2.2f}, {2.2f, 0, -2.2f}, {-2.2f, 0, 2.2f}, {2.2f, 0, 2.2f}};
    for (int sample = 0; sample < 4; ++sample) {
        const auto point = view.worldToScreen(samples[sample]).toPoint();
        if (!image.rect().contains(point))
            return 2;
        const auto pixel = image.pixel(point);
        const int r = qRed(pixel), g = qGreen(pixel), b = qBlue(pixel);
        const bool valid = sample == 0   ? r > 80 && g == 0 && b == 0
                           : sample == 1 ? g > 80 && r == 0 && b == 0
                           : sample == 2 ? b > 80 && r == 0 && g == 0
                                         : r > 80 && r == g && g == b;
        if (!valid) {
            std::fprintf(stderr, "Perspective UV sample %d failed: %d %d %d; renderer=%s; camera=%s\n",
                         sample, r, g, b,
                         QJsonDocument(view.rendererState()).toJson(QJsonDocument::Compact).constData(),
                         QJsonDocument(view.cameraState()).toJson(QJsonDocument::Compact).constData());
            return 3;
        }
    }
    view.setShowTextures(false);
    const auto flat = capture();
    if (flat == image)
        return 4;
    view.setShowTextures(true);
    // Texturing must not alter the depth-buffer owner used for picking.
    QString selected;
    view.onSelectGeometry = [&](QString name) { selected = name; };
    const auto pick = view.worldToScreen(samples[0]);
    QMouseEvent click(QEvent::MouseButtonPress, pick, view.mapToGlobal(pick), Qt::LeftButton, Qt::LeftButton,
                      Qt::NoModifier);
    QApplication::sendEvent(&view, &click);
    if (!selected.contains("Synthetic textured quad"))
        return 7;
    view.setScene(scene); // Reset the selection tint before sampling.
    QWheelEvent zoom(view.rect().center(), view.mapToGlobal(view.rect().center()), {}, QPoint(0, 3360),
                     Qt::NoButton, Qt::NoModifier, Qt::NoScrollPhase, false);
    QApplication::sendEvent(&view, &zoom);
    const auto closeImage = capture();
    if (view.cameraPosition().length() > .251f || view.worldToScreen({-5, 0, 5}).x() >= 0 ||
        view.renderedTriangleCount() < 1)
        return 8;
    int nearSamples = 0;
    for (float z : {-.025f, .025f})
        for (float x : {-.025f, .025f}) {
            const auto point = view.worldToScreen({x, 0, z}).toPoint();
            if (!closeImage.rect().adjusted(10, 40, -10, -40).contains(point))
                continue;
            const auto pixel = closeImage.pixel(point);
            const bool white = x > 0 && z > 0;
            const bool valid =
                white ? qRed(pixel) > 80 && qRed(pixel) == qGreen(pixel) && qGreen(pixel) == qBlue(pixel)
                : x < 0 && z < 0 ? qRed(pixel) > 80 && qGreen(pixel) == 0 && qBlue(pixel) == 0
                : x > 0          ? qGreen(pixel) > 80 && qRed(pixel) == 0 && qBlue(pixel) == 0
                                 : qBlue(pixel) > 80 && qRed(pixel) == 0 && qGreen(pixel) == 0;
            if (!valid) {
                std::fprintf(stderr, "Near-plane UV clipping failed\n");
                return 9;
            }
            nearSamples++;
        }
    if (nearSamples < 2)
        return 10;
    view.setScene(scene);
    view.setShowOverlays(false);
    if (!view.frameMesh("geometry:1") || view.frameMesh("geometry:unknown"))
        return 12;
    const auto camera = view.cameraState();
    if (!view.setCameraState(camera) ||
        view.setCameraState(
            {{"pivot", QJsonArray{0, 0, 0}}, {"yawRadians", 0}, {"pitchRadians", 2}, {"distance", 10}}))
        return 13;
    if (view.setDisplayMode("unknown") || !view.setDisplayMode("unlit"))
        return 14;
    const auto unlit = capture();
    const auto at = view.worldToScreen(samples[0]).toPoint();
    if (unlit.pixel(at) != qRgb(255, 0, 0))
        return 15;
    view.setDisplayMode("missing");
    const auto coverage = capture();
    if (coverage.pixel(at) != qRgb(50, 180, 100))
        return 16;
    view.setDisplayMode("checker");
    const auto checker = capture();
    if (checker == unlit || checker == coverage)
        return 17;
    view.setIsolateSelection(true);
    if (capture() != checker)
        return 18;
    if (view.materialReport().size() != 1 ||
        !view.materialReport()[0].toObject().value("viewportHasUvs").toBool())
        return 19;
    // Corrupt content hash or malformed UVs must retain the geometry as flat.
    texture.insert("rgbaSha256", QString(64, '0'));
    scene.insert("textures", QJsonArray{texture});
    view.setScene(scene);
    if (view.texturedMeshCount() != 0 || view.meshCount() != 1)
        return 5;
    view.setIsolateSelection(false);
    view.setDisplayMode("checker");
    view.frameMesh("geometry:1");
    if (capture() != checker)
        return 20; // Failed material must not hide valid UVs.
    view.setDisplayMode("missing");
    const auto missing = capture();
    if (missing.pixel(view.worldToScreen(samples[0]).toPoint()) != qRgb(235, 35, 180))
        return 21;
    texture.insert("rgbaSha256",
                   QString::fromLatin1(QCryptographicHash::hash(pixels, QCryptographicHash::Sha256).toHex()));
    mesh.insert("textureFilter", "linear");
    scene.insert("textures", QJsonArray{texture});
    scene.insert("meshes", QJsonArray{mesh});
    view.setScene(scene);
    view.setDisplayMode("unlit");
    view.frameMesh("geometry:1");
    const auto smooth = capture();
    const auto center = view.worldToScreen({0, 0, 0}).toPoint();
    const auto mixed = smooth.pixel(center);
    if (std::abs(qRed(mixed) - 128) > 8 || std::abs(qGreen(mixed) - 128) > 8 ||
        std::abs(qBlue(mixed) - 128) > 8)
        return 22;
    texture.insert("rgbaSha256",
                   QString::fromLatin1(QCryptographicHash::hash(pixels, QCryptographicHash::Sha256).toHex()));
    scene.insert("textures", QJsonArray{texture});
    mesh.insert("uvs", QJsonArray{0, 0});
    scene.insert("meshes", QJsonArray{mesh});
    view.setScene(scene);
    if (view.texturedMeshCount() != 0 || view.meshCount() != 1)
        return 6;
    // Ground grid is world-anchored, not a camera/pivot-relative moving patch.
    // Check actual pixels after panning, looking and zooming in both renderers.
    view.setScene(
        {{"contentBounds", QJsonObject{{"min", QJsonArray{-20, 0, -20}}, {"max", QJsonArray{20, 0, 20}}}},
         {"objects", QJsonArray{QJsonObject{{"id", 999}, {"worldPosition", QJsonArray{1000, 1000, 1000}}}}}});
    view.setGridSpacing(1);
    view.setShowOverlays(true);
    view.setDisplayMode("material");
    view.setCameraState(
        {{"pivot", QJsonArray{0, 0, 0}}, {"yawRadians", .6}, {"pitchRadians", -.9}, {"distance", 80}});
    const auto gridState = view.cameraState().value("editorGrid").toObject();
    if (gridState.value("anchor").toString() != "world origin" ||
        gridState.value("followsCamera").toBool(true)) {
        std::fprintf(stderr, "Grid must declare a fixed world anchor\n");
        return 23;
    }
    const QVector3D gridSamples[]{{8, 0, 3.5}, {-8, 0, 3.5}, {1, 0, 3.5}, {0, 0, 3.5}, {3.5, 0, 0}};
    const QRgb gridColors[]{qRgb(76, 91, 102), qRgb(76, 91, 102), qRgb(48, 62, 73), qRgb(62, 105, 153),
                            qRgb(151, 67, 75)};
    for (const auto &cameraState :
         {QJsonObject{
              {"pivot", QJsonArray{0, 0, 0}}, {"yawRadians", .6}, {"pitchRadians", -.9}, {"distance", 80}},
          QJsonObject{
              {"pivot", QJsonArray{3, 0, 2}}, {"yawRadians", .6}, {"pitchRadians", -.9}, {"distance", 80}},
          QJsonObject{{"pivot", QJsonArray{-3, 0, -2}},
                      {"yawRadians", -.3},
                      {"pitchRadians", -.8},
                      {"distance", 130}}}) {
        if (!view.setCameraState(cameraState) ||
            view.cameraState().value("editorGrid").toObject() != gridState) {
            std::fprintf(stderr, "Grid geometry changed with the camera\n");
            return 24;
        }
        const auto gridImage = capture();
        for (int i = 0; i < 5; ++i) {
            const auto point = view.worldToScreen(gridSamples[i]).toPoint();
            if (!gridImage.rect().adjusted(4, 40, -4, -40).contains(point))
                return 25;
            bool matched = false;
            for (int dy = -2; dy <= 2; ++dy)
                for (int dx = -2; dx <= 2; ++dx)
                    if (gridImage.pixel(point + QPoint(dx, dy)) == gridColors[i])
                        matched = true;
            if (!matched) {
                std::fprintf(stderr, "World grid sample %d moved or changed classification\n", i);
                return 26;
            }
        }
    }
    // The light rig affects real pixels in both CPU and GPU, but not unlit mode.
    const QByteArray white = QByteArray::fromHex("ffffffff");
    texture.insert("width", 1);
    texture.insert("height", 1);
    texture.insert("rgbaBase64", QString::fromLatin1(white.toBase64()));
    texture.insert("rgbaSha256",
                   QString::fromLatin1(QCryptographicHash::hash(white, QCryptographicHash::Sha256).toHex()));
    mesh.insert("uvs", QJsonArray{0, 0, 1, 0, 1, 1, 0, 1});
    scene.insert("textures", QJsonArray{texture});
    scene.insert("meshes", QJsonArray{mesh});
    view.setScene(scene);
    view.setShowOverlays(false);
    view.setDisplayMode("material");
    QJsonObject rig{{"direction", QJsonArray{0, 1, 0}},
                    {"ambient", QJsonArray{0, 0, .2}},
                    {"keyColor", QJsonArray{0, 1, 0}},
                    {"intensity", 1},
                    {"exposure", -1},
                    {"twoSided", true}};
    if (!view.setLightingState(rig))
        return 27;
    const auto litImage = capture();
    const auto lightingBefore = view.lightingState();
    const auto p = view.worldToScreen({0, 0, 0}).toPoint();
    const auto rgb = litImage.pixel(p);
    if (qRed(rgb) != 0 || std::abs(qGreen(rgb) - 128) > 2 || std::abs(qBlue(rgb) - 26) > 2) {
        std::fprintf(stderr, "Colored light/exposure pixel failed\n");
        return 28;
    }
    auto invalid = rig;
    invalid.insert("direction", QJsonArray{0, 0, 0});
    if (view.setLightingState(invalid) || view.setLightingState({}) || view.lightingState() != lightingBefore)
        return 29;
    view.setDisplayMode("unlit");
    if (capture().pixel(p) != qRgb(255, 255, 255))
        return 30;
    // Logic keeps a cube, while unresolved visible actors receive explicit
    // editor silhouettes. None of these dimensions depends on the camera.
    const auto actor = [](int id, const char *name, const char *reason, QJsonArray pos) {
        return QJsonObject{
            {"id", id},         {"name", name},         {"proxyReason", reason}, {"worldPosition", pos},
            {"editable", true}, {"worldEditable", true}};
    };
    view.setScene({{"objects", QJsonArray{actor(1, "Trigger", "No serialized actor model", {0, 8, 0})}}});
    view.setShowOverlays(true);
    view.setDisplayMode("material");
    const auto representation = view.actorRepresentation(1);
    if (representation.value("kind") != "logic box" ||
        representation.value("worldDimensions").toArray() != QJsonArray{1, 1, 1})
        return 31;
    int pixelsNear = 0, pixelsFar = 0;
    for (int distance : {30, 180}) {
        view.setCameraState({{"pivot", QJsonArray{0, 8, 0}},
                             {"yawRadians", .6},
                             {"pitchRadians", -.5},
                             {"distance", distance}});
        const auto proxyImage = capture();
        int count = 0;
        for (int y = 35; y < proxyImage.height() - 35; ++y)
            for (int x = 0; x < proxyImage.width(); ++x) {
                const auto c = proxyImage.pixel(x, y);
                if (qGreen(c) > 60 && qGreen(c) > 2 * qRed(c) && qBlue(c) > qGreen(c))
                    ++count;
            }
        if (distance == 30)
            pixelsNear = count;
        else
            pixelsFar = count;
        if (view.actorRepresentation(1) != representation)
            return 32;
    }
    if (pixelsFar < 1 || pixelsNear < 12 * pixelsFar) {
        std::fprintf(stderr, "Proxy camera scaling regressed: near=%d far=%d\n", pixelsNear, pixelsFar);
        return 33;
    }
    view.setScene(
        {{"objects",
          QJsonArray{actor(1, "Enemy_Guard", "Animated/state-driven model is not supported", {0, 0, 0}),
                     actor(2, "Enemy_Trigger", "Animated/state-driven model is not supported", {10, 0, 0}),
                     actor(3, "TreasureChest", "Unsupported model", {20, 0, 0}),
                     actor(4, "MetalGate", "Unsupported model", {30, 0, 0})}}});
    if (view.actorRepresentation(1).value("kind") != "character" ||
        view.actorRepresentation(1).value("triangleCount").toInt() != 72 ||
        view.actorRepresentation(2).value("kind") != "logic box" ||
        view.actorRepresentation(3).value("kind") != "chest" ||
        view.actorRepresentation(4).value("kind") != "gate" || view.placeholderReport().size() != 4)
        return 34;
    // Authored environment, normal and unlit contracts (no game resources).
    QJsonObject authoredMesh{{"id", 1},
                             {"name", "Authored quad"},
                             {"selectionKey", "authored:q"},
                             {"positions", QJsonArray{-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5}},
                             {"indices", QJsonArray{0, 1, 2, 0, 2, 3}},
                             {"normals", QJsonArray{0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0}},
                             {"baseColor", QJsonArray{1, 0, 0, 1}}};
    QJsonObject authored{{"schema", "skylanders-authored-scene-v1"},
                         {"meshes", QJsonArray{authoredMesh}},
                         {"environment", QJsonObject{{"authored", true},
                                                     {"sunDirection", QJsonArray{0, -1, 0}},
                                                     {"ambientColor", QJsonArray{0, 0, 0}},
                                                     {"sunColor", QJsonArray{1, 1, 1}},
                                                     {"sunIntensity", .5},
                                                     {"skyColor", QJsonArray{.2, .3, .4}}}}};
    view.setScene(authored);
    view.setShowOverlays(false);
    view.setDisplayMode("material");
    const auto litAuthored = capture();
    const auto ap = view.worldToScreen({0, 0, 0}).toPoint();
    if (std::abs(qRed(litAuthored.pixel(ap)) - 128) > 2 || qGreen(litAuthored.pixel(ap)) != 0 ||
        !view.rendererState().value("authoredEnvironmentApplied").toBool() ||
        !view.materialReport()[0].toObject().value("viewportSmoothNormals").toBool())
        return 35;
    authoredMesh.insert("unlit", true);
    authored.insert("meshes", QJsonArray{authoredMesh});
    view.setScene(authored);
    if (capture().pixel(view.worldToScreen({0, 0, 0}).toPoint()) != qRgb(255, 0, 0))
        return 36;
    view.setScene(scene);
    if (view.rendererState().value("authoredEnvironmentApplied").toBool())
        return 37;
    std::puts(
        "Texture, picking, grid, lighting, placeholders and authored environment/normal contracts passed.");
    return 0;
}
