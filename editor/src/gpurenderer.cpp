#include "gpurenderer.h"
#include "sceneview.h"

#include <QColor>
#include <QOffscreenSurface>
#include <QOpenGLContext>
#include <QOpenGLFunctions_3_3_Core>
#include <QOpenGLShaderProgram>
#include <QSurfaceFormat>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <vector>

namespace {
const char *vertexShader = R"GLSL(#version 330 core
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec2 uv;
uniform vec3 camera, rightAxis, upAxis, forwardAxis, offset;
uniform float aspect, nearPlane;
out vec3 worldNormal;
out vec2 texCoord;
void main() {
    vec3 p = position + offset - camera;
    vec3 v = vec3(dot(p,rightAxis),dot(p,upAxis),dot(p,forwardAxis));
    // Same 60-degree, positive-forward, infinite-far projection as CPU view.
    gl_Position = vec4(v.x / (0.577350269 * aspect), v.y / 0.577350269,
                       v.z - 2.0 * nearPlane, v.z);
    worldNormal = normal; texCoord = uv;
}
)GLSL";
const char *fragmentShader = R"GLSL(#version 330 core
in vec3 worldNormal;
in vec2 texCoord;
uniform sampler2D colorMap;
uniform bool textured, selected, hasUvs, twoSidedLight, unlitMaterial;
uniform float exposureMultiplier;
uniform int displayMode;
uniform vec3 baseColor, lightDirection, ambient, diffuse;
uniform int objectOwner;
layout(location=0) out vec4 color;
layout(location=1) out int owner;
layout(location=2) out float inverseDepth;
void main() {
    float ndl = dot(normalize(worldNormal), lightDirection);
    vec3 shade = (ambient + diffuse * (twoSidedLight ? abs(ndl) : max(0.0,ndl))) * exposureMultiplier;
    vec3 rgb = (textured ? texture(colorMap,texCoord).rgb : baseColor) * shade;
    if (displayMode == 1 || unlitMaterial) rgb = textured ? texture(colorMap,texCoord).rgb : baseColor;
    if (displayMode == 2) rgb = hasUvs ? (mod(floor(texCoord.x*8.0)+floor(texCoord.y*8.0),2.0) < 1.0 ?
        vec3(40.0,75.0,110.0)/255.0 : vec3(225.0)/255.0) : vec3(235.0,35.0,180.0)/255.0;
    if (displayMode == 3) rgb = textured ? vec3(50.0,180.0,100.0)/255.0 : vec3(235.0,35.0,180.0)/255.0;
    if (textured && selected) rgb = mix(rgb, vec3(1.0,0.72,0.20),0.25);
    color = vec4(rgb,1.0); owner = objectOwner; inverseDepth = gl_FragCoord.w;
}
)GLSL";
struct Vertex {
    float x, y, z, nx, ny, nz, u, v;
};
} // namespace

struct GpuSceneRenderer::State : QOpenGLFunctions_3_3_Core {
    QOpenGLContext context;
    QOffscreenSurface surface;
    std::unique_ptr<QOpenGLShaderProgram> program;
    struct Mesh {
        GLuint vao = 0, vbo = 0;
        GLsizei count = 0;
    };
    std::vector<Mesh> meshes;
    std::vector<GLuint> textures;
    GLuint framebuffer = 0, depthBuffer = 0;
    std::array<GLuint, 3> attachments{};
    QSize size;
    QString error, renderer, vendor, version;
    bool attempted = false, ready = false, uploaded = false;

    bool initialize() {
        if (attempted)
            return ready;
        attempted = true;
        QSurfaceFormat format;
        format.setVersion(3, 3);
        format.setProfile(QSurfaceFormat::CoreProfile);
        format.setDepthBufferSize(24);
        format.setStencilBufferSize(0);
        format.setSamples(0);
        context.setFormat(format);
        if (!context.create()) {
            error = "Cannot create OpenGL 3.3 context";
            return false;
        }
        surface.setFormat(context.format());
        surface.create();
        if (!surface.isValid() || !context.makeCurrent(&surface) || !initializeOpenGLFunctions()) {
            error = "Cannot activate OpenGL 3.3 offscreen surface";
            return false;
        }
        renderer = QString::fromLatin1(reinterpret_cast<const char *>(glGetString(GL_RENDERER)));
        vendor = QString::fromLatin1(reinterpret_cast<const char *>(glGetString(GL_VENDOR)));
        version = QString::fromLatin1(reinterpret_cast<const char *>(glGetString(GL_VERSION)));
        program = std::make_unique<QOpenGLShaderProgram>();
        if (!program->addShaderFromSourceCode(QOpenGLShader::Vertex, vertexShader) ||
            !program->addShaderFromSourceCode(QOpenGLShader::Fragment, fragmentShader) || !program->link()) {
            error = program->log();
            context.doneCurrent();
            return false;
        }
        ready = true;
        context.doneCurrent();
        return true;
    }
    void clearFramebuffer() {
        if (framebuffer)
            glDeleteFramebuffers(1, &framebuffer);
        if (depthBuffer)
            glDeleteRenderbuffers(1, &depthBuffer);
        glDeleteTextures(3, attachments.data());
        attachments.fill(0);
        framebuffer = depthBuffer = 0;
        size = {};
    }
    bool resize(QSize wanted) {
        if (size == wanted)
            return true;
        clearFramebuffer();
        size = wanted;
        glGenFramebuffers(1, &framebuffer);
        glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
        glGenTextures(3, attachments.data());
        const GLenum internal[] = {GL_RGBA8, GL_R32I, GL_R32F};
        const GLenum external[] = {GL_RGBA, GL_RED_INTEGER, GL_RED};
        const GLenum types[] = {GL_UNSIGNED_BYTE, GL_INT, GL_FLOAT};
        for (int i = 0; i < 3; ++i) {
            glBindTexture(GL_TEXTURE_2D, attachments[i]);
            glTexImage2D(GL_TEXTURE_2D, 0, internal[i], size.width(), size.height(), 0, external[i], types[i],
                         nullptr);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0 + i, GL_TEXTURE_2D, attachments[i],
                                   0);
        }
        glGenRenderbuffers(1, &depthBuffer);
        glBindRenderbuffer(GL_RENDERBUFFER, depthBuffer);
        glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, size.width(), size.height());
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, depthBuffer);
        if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
            error = "Mixed color/picking/depth framebuffer is unsupported";
            ready = false;
            return false;
        }
        return true;
    }
    ~State() {
        if (!context.makeCurrent(&surface))
            return;
        if (ready || framebuffer) {
            clearFramebuffer();
            for (const auto &m : meshes) {
                glDeleteBuffers(1, &m.vbo);
                glDeleteVertexArrays(1, &m.vao);
            }
            if (!textures.empty())
                glDeleteTextures(GLsizei(textures.size()), textures.data());
        }
        program.reset();
        context.doneCurrent();
    }
};

GpuSceneRenderer::GpuSceneRenderer() : state_(std::make_unique<State>()) {}
GpuSceneRenderer::~GpuSceneRenderer() = default;
QJsonObject GpuSceneRenderer::information() const {
    const auto &s = *state_;
    const auto r = s.renderer.toLower();
    return {
        {"api", "OpenGL 3.3 core"},
        {"device", s.renderer},
        {"vendor", s.vendor},
        {"version", s.version},
        {"softwareRasterizerDetected", r.contains("llvmpipe") || r.contains("softpipe") ||
                                           r.contains("software") || r.contains("swiftshader")},
        {"error", s.error},
        {"cachedMeshBuffers", int(s.meshes.size())},
        {"cachedTextures", int(s.textures.size())},
        {"nativeLightingApplied", false},
        {"lighting", "adjustable editor light rig"},
        {"cpuWorkRemaining", "color/owner/inverse-depth readback, grid, proxies, collision and UI overlays"}};
}

bool GpuSceneRenderer::render(SceneView &v) {
    auto &s = *state_;
    if (!s.initialize() || !s.context.makeCurrent(&s.surface))
        return false;
    const auto finish = [&] {
        s.glBindFramebuffer(GL_FRAMEBUFFER, 0);
        s.context.doneCurrent();
    };
    if (!s.resize(v.size())) {
        finish();
        return false;
    }
    if (!s.uploaded) {
        s.textures.resize(v.textures_.size());
        if (!s.textures.empty())
            s.glGenTextures(GLsizei(s.textures.size()), s.textures.data());
        for (size_t i = 0; i < v.textures_.size(); ++i) {
            const auto image = v.textures_[i].convertToFormat(QImage::Format_RGBA8888);
            s.glBindTexture(GL_TEXTURE_2D, s.textures[i]);
            s.glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, image.width(), image.height(), 0, GL_RGBA,
                           GL_UNSIGNED_BYTE, image.constBits());
            s.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
            s.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        }
        for (const auto &mesh : v.meshes_) {
            std::vector<Vertex> vertices;
            vertices.reserve(mesh.indices.size());
            for (size_t i = 0; i + 2 < mesh.indices.size(); i += 3) {
                const auto a = mesh.vertices[mesh.indices[i]], b = mesh.vertices[mesh.indices[i + 1]],
                           c = mesh.vertices[mesh.indices[i + 2]];
                auto n = QVector3D::crossProduct(b - a, c - a).normalized();
                if (n.isNull())
                    n = {0, 1, 0};
                for (int j = 0; j < 3; ++j) {
                    const auto index = mesh.indices[i + j];
                    const auto p = mesh.vertices[index];
                    const auto normal = mesh.normals.empty() ? n : mesh.normals[index];
                    const auto uv = !mesh.uvs.empty() ? mesh.uvs[index] : QVector2D{};
                    vertices.push_back(
                        {p.x(), p.y(), p.z(), normal.x(), normal.y(), normal.z(), uv.x(), uv.y()});
                }
            }
            State::Mesh buffer;
            buffer.count = GLsizei(vertices.size());
            s.glGenVertexArrays(1, &buffer.vao);
            s.glBindVertexArray(buffer.vao);
            s.glGenBuffers(1, &buffer.vbo);
            s.glBindBuffer(GL_ARRAY_BUFFER, buffer.vbo);
            s.glBufferData(GL_ARRAY_BUFFER, GLsizeiptr(vertices.size() * sizeof(Vertex)), vertices.data(),
                           GL_STATIC_DRAW);
            for (int i = 0; i < 3; ++i) {
                s.glEnableVertexAttribArray(i);
                s.glVertexAttribPointer(i, i == 2 ? 2 : 3, GL_FLOAT, GL_FALSE, sizeof(Vertex),
                                        reinterpret_cast<const void *>(size_t(i == 0   ? 0
                                                                              : i == 1 ? 3
                                                                                       : 6) *
                                                                       sizeof(float)));
            }
            s.meshes.push_back(buffer);
        }
        s.uploaded = true;
    }
    s.glBindFramebuffer(GL_FRAMEBUFFER, s.framebuffer);
    const GLenum targets[] = {GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1, GL_COLOR_ATTACHMENT2};
    s.glDrawBuffers(3, targets);
    s.glViewport(0, 0, v.width(), v.height());
    const GLfloat background[] = {qRed(v.backgroundColor_) / 255.f, qGreen(v.backgroundColor_) / 255.f,
                                  qBlue(v.backgroundColor_) / 255.f, 1};
    const GLfloat zero[] = {0, 0, 0, 0};
    const GLint zeroInt[] = {0, 0, 0, 0};
    s.glClearBufferfv(GL_COLOR, 0, background);
    s.glClearBufferiv(GL_COLOR, 1, zeroInt);
    s.glClearBufferfv(GL_COLOR, 2, zero);
    s.glClearDepth(1);
    s.glClear(GL_DEPTH_BUFFER_BIT);
    s.glEnable(GL_DEPTH_TEST);
    s.glDepthFunc(GL_LESS);
    s.glDisable(GL_CULL_FACE);
    s.glDisable(GL_BLEND);
    s.program->bind();
    s.program->setUniformValue("camera", v.camera_);
    s.program->setUniformValue("rightAxis", v.basisRight_);
    s.program->setUniformValue("upAxis", v.basisUp_);
    s.program->setUniformValue("forwardAxis", v.basisForward_);
    s.program->setUniformValue("aspect", float(v.width()) / v.height());
    s.program->setUniformValue("nearPlane", v.near_);
    s.program->setUniformValue("lightDirection", v.lightDirection_.normalized());
    s.program->setUniformValue("ambient", v.ambientLight_);
    s.program->setUniformValue("diffuse", v.keyLight_ * v.keyIntensity_);
    s.program->setUniformValue("twoSidedLight", v.twoSidedLighting_);
    s.program->setUniformValue("exposureMultiplier", std::exp2(v.exposure_));
    s.program->setUniformValue("colorMap", 0);
    s.glActiveTexture(GL_TEXTURE0);
    s.program->setUniformValue("displayMode", v.displayMode_);
    for (size_t i = 0; i < v.meshes_.size(); ++i) {
        const auto &mesh = v.meshes_[i];
        if (!v.meshVisible(int(i)))
            continue;
        QVector3D offset;
        if (mesh.actorId >= 0 && v.edits_.contains(mesh.actorId)) {
            const auto edit = v.edits_[mesh.actorId];
            offset = QVector3D(edit[0].toDouble(), edit[1].toDouble(), edit[2].toDouble()) -
                     mesh.actorBasePosition;
        }
        const bool selected =
            v.showOverlays_ && v.displayMode_ == 0 &&
            (v.selectedMesh_ == int(i) || (mesh.actorId >= 0 && mesh.actorId == v.selected_));
        const QColor color = QColor::fromRgb(selected ? qRgb(223, 172, 69) : mesh.color);
        s.program->setUniformValue("offset", offset);
        s.program->setUniformValue("selected", selected);
        s.program->setUniformValue("baseColor", QVector3D(color.redF(), color.greenF(), color.blueF()));
        s.program->setUniformValue("objectOwner", int(i) + 1);
        const bool textured =
            mesh.texture >= 0 && (v.displayMode_ == 3 || (v.showTextures_ && v.displayMode_ != 4));
        s.program->setUniformValue("textured", textured);
        s.program->setUniformValue("hasUvs", !mesh.uvs.empty());
        s.program->setUniformValue("unlitMaterial", mesh.unlit);
        if (textured) {
            s.glBindTexture(GL_TEXTURE_2D, s.textures[mesh.texture]);
            s.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER,
                              mesh.linearFilter ? GL_LINEAR : GL_NEAREST);
            s.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER,
                              mesh.linearFilter ? GL_LINEAR : GL_NEAREST);
            s.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, mesh.repeatS ? GL_REPEAT : GL_CLAMP_TO_EDGE);
            s.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, mesh.repeatT ? GL_REPEAT : GL_CLAMP_TO_EDGE);
        }
        s.glBindVertexArray(s.meshes[i].vao);
        s.glDrawArrays(GL_TRIANGLES, 0, s.meshes[i].count);
        v.renderedTriangles_ += s.meshes[i].count / 3;
    }
    s.glBindVertexArray(0);
    s.program->release();
    s.glPixelStorei(GL_PACK_ALIGNMENT, 4);
    // Exact owner and inverse-depth attachments preserve existing selection,
    // depth-tested proxies and overlays without CPU mesh rasterization.
    QImage pixels(v.size(), QImage::Format_RGB32);
    std::vector<int> owners(v.owner_.size());
    std::vector<float> inverseDepth(v.depth_.size());
    s.glReadBuffer(GL_COLOR_ATTACHMENT0);
    s.glReadPixels(0, 0, v.width(), v.height(), GL_BGRA, GL_UNSIGNED_BYTE, pixels.bits());
    s.glReadBuffer(GL_COLOR_ATTACHMENT1);
    s.glReadPixels(0, 0, v.width(), v.height(), GL_RED_INTEGER, GL_INT, owners.data());
    s.glReadBuffer(GL_COLOR_ATTACHMENT2);
    s.glReadPixels(0, 0, v.width(), v.height(), GL_RED, GL_FLOAT, inverseDepth.data());
    const auto error = s.glGetError();
    if (error != GL_NO_ERROR) {
        s.error = QString("OpenGL render/readback error 0x%1").arg(error, 0, 16);
        s.ready = false;
        finish();
        return false;
    }
    for (int y = 0; y < v.height(); ++y) {
        std::memcpy(v.raster_.scanLine(y), pixels.constScanLine(v.height() - y - 1), size_t(v.width()) * 4);
        const size_t source = size_t(v.height() - y - 1) * v.width(), target = size_t(y) * v.width();
        std::copy_n(owners.begin() + source, v.width(), v.owner_.begin() + target);
        std::copy_n(inverseDepth.begin() + source, v.width(), v.depth_.begin() + target);
    }
    finish();
    return true;
}
