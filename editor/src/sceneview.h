#pragma once

#include <QElapsedTimer>
#include <QImage>
#include <QJsonArray>
#include <QJsonObject>
#include <QMap>
#include <QSet>
#include <QTimer>
#include <QVector2D>
#include <QVector3D>
#include <QVector>
#include <QWidget>
#include <functional>
#include <memory>
#include <vector>

class GpuSceneRenderer;

// GPU mesh viewport with CPU overlays and an explicit CPU reference fallback.
class SceneView : public QWidget {
  public:
    explicit SceneView(QWidget *parent = nullptr);
    ~SceneView() override;
    QJsonObject rendererState() const;
    QJsonObject lightingState() const;
    bool setLightingState(const QJsonObject &lighting);
    static bool validLightingState(const QJsonObject &lighting);
    QJsonObject actorRepresentation(qint64 id) const;
    QJsonArray placeholderReport() const;
    void setScene(const QJsonObject &scene);
    void setEdits(const QMap<qint64, QJsonArray> &edits);
    void setTransforms(const QMap<qint64, QJsonObject> &transforms);
    void setSelected(qint64 id);
    void setGridSpacing(double spacing);
    void setSnap(bool enabled);
    void setWireframe(bool enabled);
    void setShowSky(bool enabled);
    void setShowTextures(bool enabled);
    bool setDisplayMode(const QString &mode);
    void setShowOverlays(bool enabled);
    void setIsolateSelection(bool enabled);
    bool frameMesh(const QString &selectionKey);
    bool setCameraState(const QJsonObject &camera);
    QJsonArray materialReport() const;
    QJsonObject selectedMeshReport() const;
    int texturedMeshCount() const;
    void setCollisions(const QJsonArray &actors);
    void setShowCollisions(bool enabled);
    QVector<QVector3D> collisionBoxCorners(qint64 actorId) const;
    int collisionBoxCount() const { return collisionBoxes_.size(); }
    void frameAll();
    void frameSelection();
    bool frameObject(qint64 id);
    QJsonObject cameraState() const;
    QPointF screenPosition(qint64 id) const;
    QPointF worldToScreen(QVector3D position) const;
    QPointF translationHandle(int axis) const;
    // Returns a visible mesh-covered pixel, excluding proxy/actor markers.
    // Useful for native-window integration checks without desktop input.
    QPointF visibleModelPoint(qint64 actorId) const;
    int objectCount() const { return actors_.size(); }
    int meshCount() const { return meshes_.size(); }
    int renderedTriangleCount() const { return renderedTriangles_; }
    double lastFrameMilliseconds() const { return lastFrameMs_; }
    QVector3D cameraPosition() const { return camera_; }
    std::function<void(qint64)> onSelect;
    std::function<void(qint64, QVector3D)> onMove;
    std::function<void(QString)> onSelectGeometry;
    std::function<void(QJsonObject)> onInspectMesh;

  protected:
    void paintEvent(QPaintEvent *) override;
    void resizeEvent(QResizeEvent *) override;
    void mousePressEvent(QMouseEvent *) override;
    void mouseMoveEvent(QMouseEvent *) override;
    void mouseReleaseEvent(QMouseEvent *) override;
    void wheelEvent(QWheelEvent *) override;
    void keyPressEvent(QKeyEvent *) override;
    void keyReleaseEvent(QKeyEvent *) override;
    void focusOutEvent(QFocusEvent *) override;

  private:
    friend class GpuSceneRenderer;
    std::unique_ptr<GpuSceneRenderer> gpu_;
    QString rendererMode_;
    bool usedGpu_ = false;
    QVector3D lightDirection_{-.3f, .85f, .45f};
    QVector3D ambientLight_{.35f, .35f, .35f}, keyLight_{1, 1, 1};
    float keyIntensity_ = .65f, exposure_ = 0;
    bool twoSidedLighting_ = true;
    bool authoredEnvironment_ = false;
    QRgb backgroundColor_ = qRgb(29, 35, 43);
    struct Actor {
        qint64 id;
        QString name;
        QVector3D position;
        bool editable;
        QString proxyKind, proxyReason;
        std::vector<QVector3D> placeholderTriangles;
    };
    struct Mesh {
        QString name;
        QString selectionKey;
        QJsonObject metadata;
        std::vector<QVector3D> vertices;
        std::vector<QVector3D> normals;
        std::vector<QVector3D> originalVertices, originalNormals;
        std::vector<int> indices;
        QRgb color;
        bool sky = false;
        bool unlit = false;
        qint64 actorId = -1;
        QVector3D actorBasePosition;
        std::vector<QVector2D> uvs;
        int texture = -1;
        bool repeatS = false, repeatT = false;
        bool linearFilter = false;
    };
    struct Projected {
        float x, y, inverseZ, uOverZ = 0, vOverZ = 0;
    };
    struct CollisionBox {
        qint64 actorId;
        QVector3D position, offset, dimensions, rotation, scale;
    };
    QMap<qint64, QJsonObject> sourceTransforms_, transforms_;
    std::vector<Actor> actors_;
    std::vector<Mesh> meshes_;
    std::vector<QImage> textures_;
    bool showTextures_ = true;
    int displayMode_ = 0; // material, unlit, checker, missing, flat
    bool showOverlays_ = true, isolateSelection_ = false;
    QMap<qint64, CollisionBox> collisionBoxes_;
    bool showCollisions_ = false;
    QSet<qint64> modeledActors_;
    QMap<qint64, QJsonArray> edits_;
    qint64 selected_ = -1;
    int selectedMesh_ = -1;
    QVector3D camera_{0, 30, 70}, pivot_{0, 0, 0};
    QVector3D basisForward_, basisRight_, basisUp_;
    QVector3D contentMin_, contentMax_;
    bool contentBounds_ = false;
    // Frozen source-scene X/Z extent, independent of camera and staged edits.
    QVector2D gridMin_{-25, -25}, gridMax_{25, 25};
    struct WorldGrid {
        double spacing;
        qint64 firstX, lastX, firstZ, lastZ;
    };
    float yaw_ = 0, pitch_ = -.4f, distance_ = 70, flySpeed_ = 100;
    float near_ = .1f, grid_ = 1, proxySize_ = 2;
    bool snap_ = false, wireframe_ = false, showSky_ = false, dirty_ = true;
    bool looking_ = false, orbiting_ = false, panning_ = false;
    QPointF lastMouse_;
    QSet<int> keys_;
    QTimer movement_;
    QElapsedTimer movementTime_;
    QImage raster_;
    std::vector<float> depth_;
    std::vector<int> owner_;
    int renderedTriangles_ = 0;
    double lastFrameMs_ = 0;
    int draggingAxis_ = -1;
    QVector3D dragStart_;
    float dragParameter_ = 0;

    QVector3D forward() const;
    QVector3D right() const;
    QVector3D up() const;
    QVector3D cameraPoint(QVector3D world) const;
    QVector3D ray(QPointF point) const;
    QVector3D position(const Actor &actor) const;
    const Actor *selectedActor() const;
    bool project(QVector3D world, QPointF &screen, float *depth = nullptr) const;
    float gizmoSize() const;
    int hitAxis(QPointF point) const;
    float axisParameter(QPointF point, QVector3D origin, int axis) const;
    void changed();
    void updateGridBounds();
    WorldGrid worldGrid() const;
    bool meshVisible(int index) const;
    void navigate();
    void render();
    void triangle(QVector3D a, QVector3D b, QVector3D c, QRgb color, int owner, const Mesh *mesh = nullptr,
                  QVector2D uvA = {}, QVector2D uvB = {}, QVector2D uvC = {},
                  QVector3D brightness = {1, 1, 1}, bool tint = false);
    void rasterTriangle(Projected a, Projected b, Projected c, QRgb color, int owner, const Mesh *mesh,
                        QVector3D brightness, bool tint);
    void line(QVector3D a, QVector3D b, QRgb color, bool testDepth = true);
};
