#include "portaldialog.h"
#include "previewlaunch.h"
#include "sceneview.h"
#include "window.h"

#include <QAction>
#include <QApplication>
#include <QDialog>
#include <QDir>
#include <QDockWidget>
#include <QDoubleSpinBox>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QHoverEvent>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QMouseEvent>
#include <QPushButton>
#include <QSettings>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QTest>
#include <QTimer>
#include <QToolButton>
#include <cstdio>
#include <functional>

namespace {
bool require(bool condition, const char *message) {
    if (!condition)
        std::fprintf(stderr, "%s\n", message);
    return condition;
}
bool writeFile(const QString &path, const QByteArray &bytes) {
    QFile file(path);
    return file.open(QIODevice::WriteOnly | QIODevice::Truncate) && file.write(bytes) == bytes.size();
}
bool waitFor(const std::function<bool()> &condition, int milliseconds = 5000) {
    QElapsedTimer timer;
    timer.start();
    while (!condition() && timer.elapsed() < milliseconds)
        QApplication::processEvents(QEventLoop::AllEvents, 20);
    return condition();
}
QJsonArray requests(const QString &path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly))
        return {};
    QJsonArray rows;
    for (const auto &line : file.readAll().split('\n'))
        if (!line.isEmpty())
            rows.append(QJsonDocument::fromJson(line).object());
    return rows;
}
} // namespace

int main(int argc, char **argv) {
    if (argc != 3)
        return 2;
    QTemporaryDir temporary;
    if (!temporary.isValid())
        return 2;
    const auto discovery = temporary.filePath("config");
    QDir().mkpath(discovery);
    qputenv("XDG_CONFIG_HOME", discovery.toUtf8());
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, temporary.filePath("isolated-settings"));
    QApplication app(argc, argv);
    const BackendConfig backend{QString::fromLocal8Bit(argv[1]), QString::fromLocal8Bit(argv[2])};
    const auto recordPath = temporary.filePath("requests.jsonl");
    qputenv("SKYLANDERS_PREVIEW_TEST_REQUESTS", recordPath.toUtf8());
    const auto eventPath = temporary.filePath("events.jsonl");
    qputenv("SKYLANDERS_PREVIEW_TEST_EVENTS", eventPath.toUtf8());
    const auto level = temporary.filePath("synthetic.bld"),
               profilePath = temporary.filePath("selected-profile.json");
    if (!writeFile(level, "synthetic non-game fixture"))
        return 2;
    const QString digest(64, '0');
    const QJsonObject map{{"sourceSha256", digest},
                          {"loadString", "Level_314_Know_It_All_Island"},
                          {"label", "Synthetic island"},
                          {"archivePath", "level/fixture.bld"},
                          {"archiveSource", "/synthetic/original.bld"},
                          {"archiveSourceSha256", digest},
                          {"previewInner", "/synthetic/preview.bld"},
                          {"previewInnerSha256", digest},
                          {"titleArchive", "/synthetic/title.bld"},
                          {"titleArchiveSha256", digest}};
    const QJsonObject document{{"schema", "skylanders-game-preview-v1"},
                               {"emulator", "/synthetic/shadps4"},
                               {"emulatorSha256", digest},
                               {"gameRoot", "/synthetic/game"},
                               {"gameExecutableSha256", digest},
                               {"checkpoint", "/synthetic/checkpoint"},
                               {"outputRoot", "/synthetic/previews"},
                               {"gamePins", QJsonObject{{"permanent/global.bld", digest}}},
                               {"assetRoots", QJsonArray{"/synthetic/assets"}},
                               {"maps", QJsonArray{map}}};
    if (!require(previewProfilePath().isEmpty(), "Settings test must not read the user's real profile"))
        return 1;
    const auto defaultPath = QDir(discovery).filePath("skylanders-level-editor/preview-profile.json");
    QDir().mkpath(QFileInfo(defaultPath).absolutePath());
    if (!writeFile(defaultPath, QJsonDocument(document).toJson()) ||
        !writeFile(profilePath, QJsonDocument(document).toJson()))
        return 2;
    if (!require(previewProfilePath() == defaultPath, "Default prepared profile discovery failed"))
        return 1;
    const auto profile = readPreviewProfile(profilePath);
    if (!require(profile.ok() && profile.path == QFileInfo(profilePath).canonicalFilePath(),
                 "Prepared profile did not load"))
        return 1;
    QString error;
    if (!require(!storePreviewProfilePath(temporary.filePath("missing.json"), &error) && !error.isEmpty() &&
                     previewProfilePath() == defaultPath,
                 "Invalid profile must not replace saved selection"))
        return 1;
    {
        PreviewSettingsPanel settings(temporary.filePath("missing.json"));
        auto *field = settings.findChild<QLineEdit *>("previewProfilePath");
        auto *save = settings.findChild<QPushButton *>("previewProfileSave");
        auto *toggle = settings.findChild<QToolButton *>("previewProfileDetailsToggle");
        auto *details = settings.findChild<QLabel *>("previewProfileDetails");
        bool saved = false;
        settings.onSaved = [&](const QString &selected) { saved = selected == profile.path; };
        if (!require(field && save && toggle && details && !save->isEnabled() && details->isHidden(),
                     "Settings must reject missing profiles and hide technical details"))
            return 1;
        field->setText(profilePath);
        if (!require(save->isEnabled() && details->text().contains("/synthetic/checkpoint") &&
                         details->text().contains("Synthetic island"),
                     "Settings did not show emulator/game/checkpoint/map details"))
            return 1;
        toggle->click();
        if (!require(!details->isHidden(), "Details fold did not open"))
            return 1;
        save->click();
        if (!require(saved && previewProfilePath() == profile.path, "Profile selection was not persisted"))
            return 1;
    }
    {
        PreviewSettingsPanel reopened(previewProfilePath());
        if (!require(reopened.profilePath() == profile.path, "Reopened settings lost the saved profile"))
            return 1;
    }
    const auto invalidPath = temporary.filePath("invalid.json");
    for (int variant = 0; variant < 5; ++variant) {
        auto invalid = document;
        if (variant == 0)
            invalid.insert("schema", "unrelated");
        if (variant == 1)
            invalid.insert("emulator", "relative-program");
        if (variant == 2)
            invalid.insert("maps", QJsonArray{map, map});
        if (variant == 3)
            invalid.remove("assetRoots");
        if (variant == 4)
            invalid.insert("emulatorSha256", "unbound");
        if (!writeFile(invalidPath, QJsonDocument(invalid).toJson()) ||
            !require(!readPreviewProfile(invalidPath).ok(), "Invalid profile was accepted"))
            return 1;
    }
    const QMap<qint64, QJsonArray> edits{{1, QJsonArray{42, 1.7504663467407227, -32.273681640625}}};
    const auto request = previewLaunchRequest(profile, level, digest, edits);
    if (!require(request.ok() &&
                     request.value.value("edits").toArray().at(0).toObject().value("id").toInteger() == 1 &&
                     !request.value.value("edits").toArray().at(0).toObject().contains("objectId"),
                 "Preview request must use exact backend id contract"))
        return 1;
    if (!require(!previewLaunchRequest(profile, level, QString(64, 'a'), {}).ok(),
                 "Unknown source hash must not guess a chapter"))
        return 1;
    if (!require(!previewLaunchRequest(profile, level, digest, {{-1, QJsonArray{1, 2, 3}}}).ok() &&
                     !previewLaunchRequest(profile, level, digest, {{1, QJsonArray{1, 2}}}).ok(),
                 "Malformed position edits accepted"))
        return 1;
    qputenv("SKYLANDERS_PREVIEW_TEST_MODE", "success");
    QObject owner;
    BackendResult response;
    bool finished = false;
    int ticks = 0;
    QTimer heartbeat;
    QObject::connect(&heartbeat, &QTimer::timeout, [&] { ++ticks; });
    heartbeat.start(10);
    preparePreviewLaunchAsync(&owner, backend, profile, level, digest, edits, [&](BackendResult result) {
        response = std::move(result);
        finished = true;
    });
    if (!require(waitFor([&] { return finished; }) && response.ok() && ticks > 0,
                 "Preparation did not complete asynchronously")) {
        std::fprintf(stderr, "%s\n", qPrintable(response.error));
        return 1;
    }
    heartbeat.stop();
    if (!require(requests(recordPath).size() == 1 && requests(recordPath).at(0).toObject() == request.value,
                 "Backend received different current-map edits"))
        return 1;
    for (int variant = 0; variant < 8; ++variant) {
        auto changed = response;
        if (variant == 0)
            changed.value.insert("sourceSha256", QString(64, 'a'));
        if (variant == 1)
            changed.value.insert("levelPath", "/synthetic/other.bld");
        if (variant == 2)
            changed.value.insert("editCount", 0);
        if (variant == 3) {
            auto wrong = changed.value.value("map").toObject();
            wrong.insert("loadString", "Level_Old_Map");
            changed.value.insert("map", wrong);
        }
        if (variant == 4)
            changed.value.insert("emulator", "/synthetic/other-emulator");
        if (variant == 5)
            changed.value.insert("game", "relative-eboot.bin");
        if (variant == 6)
            changed.value.insert("emulatorStarted", true);
        if (variant == 7)
            changed.value.insert("profilePath", "/synthetic/other-profile.json");
        if (!require(!validatePreviewLaunchReply(changed, profile, request.value).ok(),
                     "Mismatched preparation reply would launch the wrong map"))
            return 1;
    }
    finished = false;
    preparePreviewLaunchAsync(&owner, backend, profile, level, QString(64, 'a'), {},
                              [&](BackendResult result) {
                                  response = std::move(result);
                                  finished = true;
                              });
    if (!require(waitFor([&] { return finished; }) && !response.ok() && requests(recordPath).size() == 1,
                 "Unknown map invoked preparation instead of failing closed"))
        return 1;

    // A failed preparation must not create even a synthetic portal session.
    qputenv("SKYLANDERS_PREVIEW_TEST_MODE", "failure");
    EditorWindow window(backend);
    window.show();
    window.openPath(level);
    auto *play = window.findChild<QPushButton *>("playCurrentMap");
    auto *settingsAction = window.findChild<QAction *>("previewSettingsAction");
    auto *table = window.findChild<QTableWidget *>("objectsTable");
    auto *status = window.findChild<QLabel *>("previewLaunchStatus");
    if (!require(play && settingsAction && table && status && waitFor([&] {
                     return table->isEnabled() && table->rowCount() == 1 && play->isEnabled();
                 }),
                 "Current-map play UI did not load"))
        return 1;
    auto *settingsDock = window.findChild<QDockWidget *>("previewSettingsDock");
    if (!require(settingsDock && settingsDock->isHidden() && play->text() == "Play",
                 "Preview controls should start compact"))
        return 1;
    settingsAction->trigger();
    if (!require(settingsDock->isVisible() && !settingsDock->isFloating() &&
                     window.findChildren<QDialog *>().isEmpty(),
                 "Preview settings opened a popup instead of the integrated panel"))
        return 1;
    window.findChild<QPushButton *>("previewProfileSave")->click();
    if (!require(settingsDock->isHidden(), "Saving the profile should return to the map inspector"))
        return 1;
    table->selectRow(0);
    auto *x = window.findChild<QDoubleSpinBox *>("position0");
    x->setValue(42); // Intentionally do not press Stage first.
    play->click();
    if (!require(waitFor([&] {
                     return play->isEnabled() && status->property("state").toString() == "error" &&
                            status->toolTip().contains("Synthetic preview preparation failed");
                 }),
                 "Preparation failure did not reach UI"))
        return 1;
    auto recorded = requests(recordPath);
    if (!require(recorded.size() == 2 &&
                     recorded.at(1).toObject().value("edits") == request.value.value("edits"),
                 "Play lost unstaged visible coordinates or pending edits"))
        return 1;
    if (!require(!window.findChild<QLineEdit *>("portalEmulator") &&
                     window.findChild<QLabel *>("pendingCount")->text().startsWith("1 "),
                 "Failed preparation created a portal or discarded pending edits"))
        return 1;
    // Successful/repeated Play uses the sibling synthetic controller fixture,
    // which refuses any real emulator name and never starts a child process.
    qputenv("SKYLANDERS_PREVIEW_TEST_MODE", "success");
    const auto eventCount = [&](const QString &operation) {
        int count = 0;
        for (const auto &event : requests(eventPath))
            if (event.toObject().value("operation").toString() == operation)
                ++count;
        return count;
    };
    const auto portalReady = [&] {
        auto *stop = window.findChild<QPushButton *>("portalStop");
        return play->isEnabled() && stop && stop->isEnabled();
    };
    play->click();
    if (!require(waitFor([&] { return eventCount("portal_start") == 1 && portalReady(); }),
                 "Play did not apply prepared settings to the synthetic portal"))
        return 1;
    auto *portalDock = window.findChild<QDockWidget *>("portalControlsDock");
    auto *liveDock = window.findChild<QDockWidget *>("liveViewportDock");
    auto *editorDock = window.findChild<QDockWidget *>("editorViewportDock");
    auto *workspace = window.findChild<QMainWindow *>("viewportWorkspace");
    auto *liveView = window.findChild<QDialog *>("nativeGameView");
    if (!require(portalDock && portalDock->isHidden() && liveDock && editorDock && liveView &&
                     !liveView->isWindow() && liveView->window() == &window && workspace &&
                     workspace->tabifiedDockWidgets(editorDock).contains(liveDock) &&
                     status->property("state").toString() == "running",
                 "Play must use one main window with a tabbed live viewport and hidden portal controls")) {
        std::fprintf(stderr,
                     "portalHidden=%d live=%d editor=%d view=%d viewWindow=%d windowMatches=%d workspace=%d "
                     "tabs=%d state=%s\n",
                     portalDock && portalDock->isHidden(), !!liveDock, !!editorDock, !!liveView,
                     liveView && liveView->isWindow(), liveView && liveView->window() == &window, !!workspace,
                     workspace && workspace->tabifiedDockWidgets(editorDock).contains(liveDock),
                     qPrintable(status->property("state").toString()));
        return 1;
    }
    const auto settle = [&] { waitFor([] { return false; }, 100); };
    auto *objectsDock = window.findChild<QDockWidget *>("objectsDock");
    auto *inspectorDock = window.findChild<QDockWidget *>("inspectorDock");
    settle();
    const auto originalSize = window.size();
    const int workspaceWidth = workspace->width();
    window.resizeDocks({objectsDock, inspectorDock}, {200, 270}, Qt::Horizontal);
    settle();
    if (!require(workspace->width() >= workspaceWidth && window.size() == originalSize,
                 "Shrinking sidebars must give space to the central view without growing the window"))
        return 1;
    // Send input only to this synthetic window's actual dock separator.
    const int oldInspectorWidth = inspectorDock->width(), oldWorkspaceWidth = workspace->width();
    const QPointF separator(inspectorDock->x() - 3, inspectorDock->y() + inspectorDock->height() / 2);
    const QPointF dragged = separator - QPointF(50, 0);
    QHoverEvent hover(QEvent::HoverMove, separator, window.mapToGlobal(separator), QPointF(), Qt::NoModifier);
    QApplication::sendEvent(&window, &hover);
    QTest::mouseMove(window.windowHandle(), separator.toPoint());
    QTest::mousePress(window.windowHandle(), Qt::LeftButton, Qt::NoModifier, separator.toPoint());
    QTest::mouseMove(window.windowHandle(), dragged.toPoint(), 30);
    QTest::mouseRelease(window.windowHandle(), Qt::LeftButton, Qt::NoModifier, dragged.toPoint());
    settle();
    if (!require(inspectorDock->width() > oldInspectorWidth && workspace->width() < oldWorkspaceWidth,
                 "Dragging the inspector separator did not resize the central view")) {
        std::fprintf(stderr, "inspector %d -> %d workspace %d -> %d separator %.0f,%.0f\n", oldInspectorWidth,
                     inspectorDock->width(), oldWorkspaceWidth, workspace->width(), separator.x(),
                     separator.y());
        return 1;
    }
    const int stableInspector = inspectorDock->width(), stableWorkspace = workspace->width();
    auto *scene = static_cast<SceneView *>(window.findChild<QWidget *>("sceneViewport"));
    scene->onSelectGeometry(QString(2000, 'W'));
    settle();
    if (!require(inspectorDock->width() == stableInspector && workspace->width() == stableWorkspace,
                 "Long object names expanded the inspector instead of retaining the viewport size"))
        return 1;
    for (auto *dock : window.findChildren<QDockWidget *>())
        if (!require(!(dock->features() & QDockWidget::DockWidgetFloatable),
                     "Dock dragging may create an unwanted floating window"))
            return 1;
    window.findChild<QAction *>("splitViewports")->trigger();
    settle();
    if (!require(!workspace->tabifiedDockWidgets(editorDock).contains(liveDock) && !liveDock->isFloating(),
                 "Side-by-side views did not remain docked"))
        return 1;
    const int beforeEditor = editorDock->width(), beforeLive = liveDock->width();
    workspace->resizeDocks({editorDock, liveDock}, {beforeEditor + 100, beforeLive - 100}, Qt::Horizontal);
    settle();
    if (!require(editorDock->width() > beforeEditor && liveDock->width() < beforeLive &&
                     editorDock->isVisible() && liveDock->isVisible() && workspace->window() == &window,
                 "Split viewports did not resize independently inside the main window"))
        return 1;
    window.findChild<QAction *>("tabbedViewports")->trigger();
    if (!require(workspace->tabifiedDockWidgets(editorDock).contains(liveDock),
                 "Tabbed views could not be restored"))
        return 1;
    const auto firstSession = window.findChild<QLineEdit *>("portalSession")->text();
    window.findChild<QPushButton *>("portalStop")->click();
    if (!require(waitFor([&] {
                     return eventCount("portal_stop") == 1 &&
                            !window.findChild<QPushButton *>("portalStop")->isEnabled();
                 }),
                 "Synthetic stop did not settle"))
        return 1;
    play->click();
    if (!require(waitFor([&] { return eventCount("portal_start") == 2 && portalReady(); }) &&
                     window.findChild<QLineEdit *>("portalSession")->text() != firstSession,
                 "Play after Stop must replace the idle controller and start a fresh session"))
        return 1;
    play->click(); // Restart a still-running owned preview, without reselecting the profile.
    if (!require(waitFor([&] { return eventCount("portal_start") == 3 && portalReady(); }) &&
                     eventCount("portal_stop") == 2,
                 "Repeated Play must stop only its previous owned preview before restarting"))
        return 1;
    QStringList sequence;
    for (const auto &event : requests(eventPath))
        sequence << event.toObject().value("operation").toString();
    // The first Stop above is explicit user input, before the next Play.
    // Only the final, still-running restart must prepare before portal_stop.
    const QStringList expectedSequence{"prepare",     "prepare",     "prepare",        "portal_start",
                                       "portal_stop", "prepare",     "controller_eof", "portal_start",
                                       "prepare",     "portal_stop", "controller_eof", "portal_start"};
    if (!require(sequence == expectedSequence,
                 "Prepare must validate first, then stop the old controller before launching a new one")) {
        std::fprintf(stderr, "Observed: %s\n", qPrintable(sequence.join(", ")));
        return 1;
    }
    const auto requestsBeforeUnknown = requests(recordPath).size();
    const int stopsBeforeUnknown = eventCount("portal_stop");
    auto unsupported = document;
    auto otherMap = map;
    otherMap.insert("sourceSha256", QString(64, 'a'));
    unsupported.insert("maps", QJsonArray{otherMap});
    if (!writeFile(profilePath, QJsonDocument(unsupported).toJson()))
        return 2;
    play->click();
    if (!require(waitFor([&] { return play->isEnabled() && status->toolTip().contains("no route"); }) &&
                     requests(recordPath).size() == requestsBeforeUnknown &&
                     eventCount("portal_stop") == stopsBeforeUnknown,
                 "Unknown current map fell back or stopped an existing preview before validation"))
        return 1;
    auto *portal = static_cast<PortalDialog *>(portalDock->widget());
    if (!require(portal, "Synthetic portal window missing during cleanup"))
        return 1;
    portal->close();
    if (!require(waitFor([&] {
                     return eventCount("controller_eof") == 3 &&
                            !window.findChild<QLineEdit *>("portalEmulator");
                 }),
                 "Owned synthetic portal did not close cleanly"))
        return 1;
    const int startedBeforeCancel = eventCount("portal_start");
    // Restore the supported profile, then cancel the new preparation before
    // its asynchronous response. It must never launch later.
    if (!writeFile(profilePath, QJsonDocument(document).toJson()))
        return 2;
    if (!require(waitFor([&] { return play->isEnabled(); }), "Play did not become available"))
        return 1;
    play->click();
    if (!require(window.findChild<QLabel *>("preparationStage") &&
                     window.findChild<QLabel *>("preparationStage")->isVisible(),
                 "Preparation must appear in Live immediately"))
        return 1;
    window.findChild<QPushButton *>("stopGamePreview")->click();
    if (!require(waitFor([&] { return play->isEnabled(); }) &&
                     eventCount("portal_start") == startedBeforeCancel &&
                     status->property("state").toString() == "stopped",
                 "Cancelled preparation launched a late emulator"))
        return 1;
    // Losing a saved profile must retain that selection, not silently choose
    // the still-present default profile with a different route.
    QFile::remove(profilePath);
    if (!require(previewProfilePath() == profile.path && !readPreviewProfile(previewProfilePath()).ok(),
                 "Missing selected profile silently fell back"))
        return 1;
    qunsetenv("SKYLANDERS_PREVIEW_TEST_REQUESTS");
    qunsetenv("SKYLANDERS_PREVIEW_TEST_MODE");
    qunsetenv("SKYLANDERS_PREVIEW_TEST_EVENTS");
    std::printf("Preview settings, identity binding, async edits, no-launch failures and owned-session "
                "restarts: PASS (synthetic only)\n");
    return 0;
}
