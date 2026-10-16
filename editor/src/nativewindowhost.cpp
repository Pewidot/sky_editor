#include "nativewindowhost.h"

#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QResizeEvent>
#include <QVector>
#include <cstdlib>
#include <cstring>
#ifdef SKYLANDERS_X11_HOST
#include <xcb/shape.h>
#include <xcb/xcb.h>
#endif

namespace {
struct ProcessIdentity {
    qint64 parent = 0;
    QByteArray ticks;
    QString executable;
};
ProcessIdentity processIdentity(qint64 pid) {
    ProcessIdentity result;
    if (pid <= 1)
        return result;
    QFile file(QString("/proc/%1/stat").arg(pid));
    if (!file.open(QIODevice::ReadOnly))
        return result;
    const auto stat = file.readAll();
    const auto end = stat.lastIndexOf(')');
    const auto fields = stat.mid(end + 2).split(' ');
    if (end < 0 || fields.size() < 20 || fields[0] == "Z")
        return result;
    result.parent = fields[1].toLongLong();
    result.ticks = fields[19];
    result.executable = QFileInfo(QString("/proc/%1/exe").arg(pid)).canonicalFilePath();
    return result;
}
} // namespace

struct NativeWindowHost::State {
    qint64 controller = 0, emulator = 0;
    QByteArray ticks;
    QString executable;
#ifdef SKYLANDERS_X11_HOST
    xcb_connection_t *connection = nullptr;
    xcb_window_t window = XCB_WINDOW_NONE, root = XCB_WINDOW_NONE;
    xcb_atom_t pidAtom = XCB_ATOM_NONE;
    QVector<xcb_rectangle_t> inputShape;
    uint8_t ordering = 0;
    int16_t x = 0, y = 0;
    uint16_t width = 0, height = 0;
#endif
};

NativeWindowHost::NativeWindowHost(QWidget *parent) : QWidget(parent), state_(std::make_unique<State>()) {
    setObjectName("nativeLiveSurface");
    setMinimumSize(320, 180);
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true);
    setAttribute(Qt::WA_NativeWindow);
    setStyleSheet("background:#111820;");
}
NativeWindowHost::~NativeWindowHost() { detach(); }
bool NativeWindowHost::supported() {
#ifdef SKYLANDERS_X11_HOST
    return QGuiApplication::platformName() == "xcb";
#else
    return false;
#endif
}
bool NativeWindowHost::attached() const { return hostedWindow() != 0; }
quint32 NativeWindowHost::hostedWindow() const {
#ifdef SKYLANDERS_X11_HOST
    return state_->window;
#else
    return 0;
#endif
}

#ifdef SKYLANDERS_X11_HOST
namespace {
bool checked(xcb_connection_t *connection, xcb_void_cookie_t cookie) {
    auto *error = xcb_request_check(connection, cookie);
    const bool ok = !error;
    std::free(error);
    return ok;
}
xcb_atom_t atom(xcb_connection_t *connection, const char *name) {
    auto *reply = xcb_intern_atom_reply(connection,
                                        xcb_intern_atom(connection, false, std::strlen(name), name), nullptr);
    const auto value = reply ? reply->atom : XCB_ATOM_NONE;
    std::free(reply);
    return value;
}
qint64 windowPid(xcb_connection_t *connection, xcb_window_t window, xcb_atom_t pidAtom) {
    auto *reply = xcb_get_property_reply(
        connection, xcb_get_property(connection, false, window, pidAtom, XCB_ATOM_CARDINAL, 0, 1), nullptr);
    uint32_t value = 0;
    if (reply && reply->format == 32 && xcb_get_property_value_length(reply) == 4)
        std::memcpy(&value, xcb_get_property_value(reply), 4);
    std::free(reply);
    return value;
}
} // namespace
#endif

bool NativeWindowHost::verifyOwned() const {
#ifdef SKYLANDERS_X11_HOST
    if (!attached() || !state_->connection || xcb_connection_has_error(state_->connection))
        return false;
    const auto identity = processIdentity(state_->emulator);
    return identity.parent == state_->controller && identity.ticks == state_->ticks &&
           identity.executable == state_->executable &&
           windowPid(state_->connection, state_->window, state_->pidAtom) == state_->emulator;
#else
    return false;
#endif
}

bool NativeWindowHost::attachOwned(qint64 controllerPid, qint64 emulatorPid, const QString &emulator,
                                   QString &error) {
    if (attached()) {
        if (state_->controller == controllerPid && state_->emulator == emulatorPid && verifyOwned()) {
            fitWindow();
            return true;
        }
        detach();
    }
    if (!supported()) {
        error = "Live hosting requires the Qt xcb platform and an SDL X11 session. PNG fallback is explicit.";
        return false;
    }
#ifdef SKYLANDERS_X11_HOST
    const auto identity = processIdentity(emulatorPid);
    const QString expected = QFileInfo(emulator).canonicalFilePath();
    if (controllerPid <= 1 || identity.parent != controllerPid || expected.isEmpty() ||
        identity.executable != expected || identity.ticks.isEmpty()) {
        error = "Refused live window: emulator is not the verified controller's direct child.";
        return false;
    }
    int screenNumber = 0;
    auto *connection = xcb_connect(nullptr, &screenNumber);
    if (!connection || xcb_connection_has_error(connection)) {
        if (connection)
            xcb_disconnect(connection);
        error = "Cannot connect to the X11 display.";
        return false;
    }
    auto screens = xcb_setup_roots_iterator(xcb_get_setup(connection));
    while (screenNumber-- > 0 && screens.rem)
        xcb_screen_next(&screens);
    if (!screens.rem) {
        xcb_disconnect(connection);
        error = "X11 screen unavailable.";
        return false;
    }
    const auto root = screens.data->root, pidAtom = atom(connection, "_NET_WM_PID");
    auto *shapeVersion =
        xcb_shape_query_version_reply(connection, xcb_shape_query_version(connection), nullptr);
    const bool shapeSupported =
        shapeVersion && (shapeVersion->major_version > 1 ||
                         (shapeVersion->major_version == 1 && shapeVersion->minor_version >= 1));
    std::free(shapeVersion);
    if (!shapeSupported) {
        xcb_disconnect(connection);
        error = "X11 ShapeInput support is required to isolate camera input.";
        return false;
    }
    QVector<xcb_window_t> queue{root}, candidates;
    for (int i = 0; i < queue.size() && i < 2048; ++i) {
        const auto window = queue[i];
        if (windowPid(connection, window, pidAtom) == emulatorPid) {
            auto *attributes = xcb_get_window_attributes_reply(
                connection, xcb_get_window_attributes(connection, window), nullptr);
            auto *geometry =
                xcb_get_geometry_reply(connection, xcb_get_geometry(connection, window), nullptr);
            if (attributes && geometry && attributes->_class == XCB_WINDOW_CLASS_INPUT_OUTPUT &&
                attributes->map_state == XCB_MAP_STATE_VIEWABLE && geometry->width >= 320 &&
                geometry->height >= 180)
                candidates.append(window);
            std::free(attributes);
            std::free(geometry);
        }
        auto *tree = xcb_query_tree_reply(connection, xcb_query_tree(connection, window), nullptr);
        if (tree) {
            const auto children = xcb_query_tree_children(tree);
            const int count = xcb_query_tree_children_length(tree);
            for (int j = 0; j < count && queue.size() < 2048; ++j)
                queue.append(children[j]);
        }
        std::free(tree);
    }
    if (candidates.size() != 1) {
        xcb_disconnect(connection);
        error = candidates.isEmpty() ? "Waiting for the owned SDL X11 render window…"
                                     : "Refused ambiguous owned windows; no surface attached.";
        return false;
    }
    const auto window = candidates[0];
    auto *geometry = xcb_get_geometry_reply(connection, xcb_get_geometry(connection, window), nullptr);
    auto *position = xcb_translate_coordinates_reply(
        connection, xcb_translate_coordinates(connection, window, root, 0, 0), nullptr);
    auto *shape = xcb_shape_get_rectangles_reply(
        connection, xcb_shape_get_rectangles(connection, window, XCB_SHAPE_SK_INPUT), nullptr);
    if (!geometry || !position || !shape || xcb_shape_get_rectangles_rectangles_length(shape) > 4096) {
        std::free(geometry);
        std::free(position);
        std::free(shape);
        xcb_disconnect(connection);
        error = "Cannot preserve native window geometry/input shape.";
        return false;
    }
    state_->connection = connection;
    state_->window = window;
    state_->root = root;
    state_->pidAtom = pidAtom;
    state_->controller = controllerPid;
    state_->emulator = emulatorPid;
    state_->ticks = identity.ticks;
    state_->executable = expected;
    state_->x = position->dst_x;
    state_->y = position->dst_y;
    state_->width = geometry->width;
    state_->height = geometry->height;
    state_->ordering = shape->ordering;
    const auto rectangles = xcb_shape_get_rectangles_rectangles(shape);
    for (int i = 0; i < xcb_shape_get_rectangles_rectangles_length(shape); ++i)
        state_->inputShape.append(rectangles[i]);
    std::free(geometry);
    std::free(position);
    std::free(shape);
    // Save-set reparents the foreign window if our X11 connection disappears.
    // Never destroy or take Qt ownership of the SDL/Vulkan surface.
    if (!verifyOwned() ||
        !checked(connection, xcb_change_save_set_checked(connection, XCB_SET_MODE_INSERT, window)) ||
        !checked(connection,
                 xcb_shape_rectangles_checked(connection, XCB_SHAPE_SO_SET, XCB_SHAPE_SK_INPUT,
                                              XCB_CLIP_ORDERING_UNSORTED, window, 0, 0, 0, nullptr)) ||
        !checked(connection,
                 xcb_reparent_window_checked(connection, window, static_cast<xcb_window_t>(winId()), 0, 0)) ||
        !checked(connection, xcb_map_window_checked(connection, window))) {
        detach();
        error = "Native window changed during attachment; no live host retained.";
        return false;
    }
    fitWindow();
    QWidget::window()->activateWindow();
    setFocus();
    error.clear();
    return true;
#else
    Q_UNUSED(controllerPid);
    Q_UNUSED(emulatorPid);
    Q_UNUSED(emulator);
    return false;
#endif
}

void NativeWindowHost::detach() {
#ifdef SKYLANDERS_X11_HOST
    if (state_->connection) {
        if (verifyOwned()) {
            const auto connection = state_->connection;
            const auto window = state_->window;
            checked(connection,
                    xcb_reparent_window_checked(connection, window, state_->root, state_->x, state_->y));
            const uint32_t dimensions[]{state_->width, state_->height};
            checked(connection,
                    xcb_configure_window_checked(
                        connection, window, XCB_CONFIG_WINDOW_WIDTH | XCB_CONFIG_WINDOW_HEIGHT, dimensions));
            checked(connection, xcb_shape_rectangles_checked(
                                    connection, XCB_SHAPE_SO_SET, XCB_SHAPE_SK_INPUT, state_->ordering,
                                    window, 0, 0, state_->inputShape.size(), state_->inputShape.constData()));
            checked(connection, xcb_change_save_set_checked(connection, XCB_SET_MODE_DELETE, window));
            checked(connection, xcb_map_window_checked(connection, window));
        }
        xcb_disconnect(state_->connection);
    }
#endif
    state_ = std::make_unique<State>();
}
void NativeWindowHost::fitWindow() {
#ifdef SKYLANDERS_X11_HOST
    if (!verifyOwned())
        return;
    // SDL may restore a desktop position after initial creation. It is now a
    // child: its coordinates must stay host-local rather than desktop-global.
    const uint32_t dimensions[]{0, 0, uint32_t(qMax(1, qRound(width() * devicePixelRatioF()))),
                                uint32_t(qMax(1, qRound(height() * devicePixelRatioF())))};
    auto *geometry = xcb_get_geometry_reply(state_->connection,
                                            xcb_get_geometry(state_->connection, state_->window), nullptr);
    const bool unchanged = geometry && geometry->x == 0 && geometry->y == 0 &&
                           geometry->width == dimensions[2] && geometry->height == dimensions[3];
    std::free(geometry);
    if (unchanged)
        return;
    checked(state_->connection,
            xcb_configure_window_checked(state_->connection, state_->window,
                                         XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y | XCB_CONFIG_WINDOW_WIDTH |
                                             XCB_CONFIG_WINDOW_HEIGHT,
                                         dimensions));
#endif
}
void NativeWindowHost::resizeEvent(QResizeEvent *event) {
    QWidget::resizeEvent(event);
    fitWindow();
}
