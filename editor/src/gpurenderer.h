#pragma once

#include <QJsonObject>
#include <memory>

class SceneView;
// GPU mesh pass shared by the interactive viewport and reference captures.
// CPU overlays/proxies remain separate until their GPU passes are implemented.
class GpuSceneRenderer {
  public:
    GpuSceneRenderer();
    ~GpuSceneRenderer();
    bool render(SceneView &view);
    QJsonObject information() const;

  private:
    struct State;
    std::unique_ptr<State> state_;
};
