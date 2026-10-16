#include "sceneview.h"
#include "window.h"

#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QCryptographicHash>
#include <QDockWidget>
#include <QDoubleSpinBox>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QFile>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QMouseEvent>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QTabWidget>
#include <QTableWidget>
#include <QTimer>
#include <cmath>
#include <cstdio>

static QByteArray fileHash(const QString &path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly))
        return {};
    QCryptographicHash hash(QCryptographicHash::Sha256);
    if (!hash.addData(&file))
        return {};
    return hash.result();
}

int main(int argc, char **argv) {
    QApplication app(argc, argv);
    if (argc != 3 && argc != 5 && argc != 6)
        return 2;
    const bool capture = argc >= 5;
    const auto initialHash = capture ? fileHash(QString::fromLocal8Bit(argv[3])) : QByteArray{};
    const auto geometryHash = argc == 6 ? fileHash(QString::fromLocal8Bit(argv[5])) : QByteArray{};
    EditorWindow window({QString::fromLocal8Bit(argv[1]), QString::fromLocal8Bit(argv[2])});
    const QJsonObject openingCamera{
        {"pivot", QJsonArray{2, 3, -20}}, {"yawRadians", .2}, {"pitchRadians", -.6}, {"distance", 80}};
    if (!capture && (window.setInitialCamera({}) || !window.setInitialCamera(openingCamera)))
        return 1;
    window.show();
    window.openPath(capture ? QString::fromLocal8Bit(argv[3]) : QStringLiteral("synthetic.bld"),
                    argc == 6 ? QString::fromLocal8Bit(argv[5]) : QString{});
    QElapsedTimer elapsed;
    elapsed.start();
    QTimer poll;
    int capturePhase = 0;
    QObject::connect(&poll, &QTimer::timeout, &app, [&] {
        auto *table = window.findChild<QTableWidget *>("objectsTable");
        if (!table || !table->isEnabled() || table->rowCount() < 1) {
            if (elapsed.elapsed() > 60000) {
                std::fprintf(stderr, "Timed out loading GUI data\n");
                app.exit(1);
            }
            return;
        }
        if (capture && capturePhase == 0) {
            auto *filter = window.findChild<QComboBox *>("typeFilter");
            const int index = filter->findData("tfbActorInfo");
            if (index < 0) {
                std::fprintf(stderr, "No tfbActorInfo type available for capture\n");
                app.exit(1);
                return;
            }
            capturePhase = 1;
            filter->setCurrentIndex(index);
            QMetaObject::invokeMethod(filter, "activated", Q_ARG(int, index));
            return;
        }
        poll.stop();
        auto *preview = static_cast<SceneView *>(window.findChild<QWidget *>("sceneViewport"));
        if (!capture) {
            const auto actual = preview->cameraState();
            if (actual.value("pivot") != openingCamera.value("pivot") ||
                actual.value("distance").toDouble() != 80) {
                std::fprintf(stderr, "Initial camera was lost during asynchronous scene loading\n");
                app.exit(1);
                return;
            }
            preview->frameAll();
        }
        auto *x = window.findChild<QDoubleSpinBox *>("position0");
        auto *stage = window.findChild<QPushButton *>("stagePosition");
        auto *pending = window.findChild<QLabel *>("pendingCount");
        auto *collisionToggle = window.findChild<QCheckBox *>("collisionOverlay");
        auto *collisionInspector = window.findChild<QLabel *>("collisionInspector");
        const qint64 id = capture ? table->item(0, 0)->text().toLongLong() : 1;
        if (capture) {
            int selectedRow = -1;
            for (int row = 0; row < table->rowCount(); ++row)
                if (table->item(row, 2)->text() == "GarageDoor_1") {
                    selectedRow = row;
                    break;
                }
            if (selectedRow < 0) {
                std::fprintf(stderr, "Expected real model GarageDoor_1 was not found\n");
                app.exit(1);
                return;
            }
            table->selectRow(selectedRow);
            QApplication::processEvents();
            const qint64 actorId = table->item(selectedRow, 0)->text().toLongLong();
            QDoubleSpinBox *coordinates[3];
            double original[3];
            QString originalText[3];
            for (int axis = 0; axis < 3; ++axis) {
                coordinates[axis] = window.findChild<QDoubleSpinBox *>(QString("position%1").arg(axis));
                original[axis] = coordinates[axis]->value();
                originalText[axis] = table->item(selectedRow, axis + 3)->text();
            }
            auto *undo = window.findChild<QPushButton *>("undoSelected");
            auto restored = [&] {
                if (!pending->text().startsWith("0 ") || undo->isEnabled())
                    return false;
                for (int axis = 0; axis < 3; ++axis)
                    if (coordinates[axis]->value() != original[axis] ||
                        table->item(selectedRow, axis + 3)->text() != originalText[axis])
                        return false;
                return true;
            };
            // Actual model triangle ownership, not a proxy/marker coordinate.
            preview->frameSelection();
            preview->setSelected(-1);
            preview->grab();
            auto modelPoint = preview->visibleModelPoint(actorId);
            // A stored door can face away from the initial overview. Orbit the
            // selected pivot instead of clicking through occluding geometry.
            for (int attempt = 0; modelPoint.x() < 0 && attempt < 18; ++attempt) {
                const QPointF start = preview->rect().center(), end = start + QPointF(60, 0);
                QMouseEvent press(QEvent::MouseButtonPress, start, preview->mapToGlobal(start),
                                  Qt::MiddleButton, Qt::MiddleButton, Qt::NoModifier);
                QMouseEvent move(QEvent::MouseMove, end, preview->mapToGlobal(end), Qt::NoButton,
                                 Qt::MiddleButton, Qt::NoModifier);
                QMouseEvent release(QEvent::MouseButtonRelease, end, preview->mapToGlobal(end),
                                    Qt::MiddleButton, Qt::NoButton, Qt::NoModifier);
                QApplication::sendEvent(preview, &press);
                QApplication::sendEvent(preview, &move);
                QApplication::sendEvent(preview, &release);
                preview->grab();
                modelPoint = preview->visibleModelPoint(actorId);
            }
            if (modelPoint.x() < 0) {
                std::fprintf(stderr, "Expected real actor mesh has no visible pixels\n");
                app.exit(1);
                return;
            }
            qint64 pickedId = -1;
            const auto originalSelect = preview->onSelect;
            preview->onSelect = [&](qint64 picked) {
                pickedId = picked;
                originalSelect(picked);
            };
            QMouseEvent modelPress(QEvent::MouseButtonPress, modelPoint, preview->mapToGlobal(modelPoint),
                                   Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
            QMouseEvent modelRelease(QEvent::MouseButtonRelease, modelPoint, preview->mapToGlobal(modelPoint),
                                     Qt::LeftButton, Qt::NoButton, Qt::NoModifier);
            QApplication::sendEvent(preview, &modelPress);
            QApplication::sendEvent(preview, &modelRelease);
            preview->onSelect = originalSelect;
            if (pickedId != actorId || table->currentRow() != selectedRow || !stage->isEnabled()) {
                std::fprintf(stderr, "Real model triangle picking failed\n");
                app.exit(1);
                return;
            }
            for (int axis = 0; axis < 3; ++axis)
                coordinates[axis]->setValue(original[axis] + axis + 1);
            stage->click();
            if (!pending->text().startsWith("1 ") || !undo->isEnabled()) {
                std::fprintf(stderr, "Real actor XYZ field staging failed\n");
                app.exit(1);
                return;
            }
            undo->click();
            if (!restored()) {
                std::fprintf(stderr, "Real actor field undo did not exactly restore original UI values\n");
                app.exit(1);
                return;
            }
            // Exercise every axis with actual native-widget mouse events.
            for (int axis = 0; axis < 3; ++axis) {
                preview->grab();
                const auto origin = preview->screenPosition(actorId),
                           handle = preview->translationHandle(axis);
                const auto start = origin + (handle - origin) * .7;
                const auto end = start + (handle - origin) * .2;
                QMouseEvent press(QEvent::MouseButtonPress, start, preview->mapToGlobal(start),
                                  Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
                QMouseEvent move(QEvent::MouseMove, end, preview->mapToGlobal(end), Qt::NoButton,
                                 Qt::LeftButton, Qt::NoModifier);
                QMouseEvent release(QEvent::MouseButtonRelease, end, preview->mapToGlobal(end),
                                    Qt::LeftButton, Qt::NoButton, Qt::NoModifier);
                QApplication::sendEvent(preview, &press);
                QApplication::sendEvent(preview, &move);
                QApplication::sendEvent(preview, &release);
                if (!pending->text().startsWith("1 ") || coordinates[axis]->value() == original[axis]) {
                    std::fprintf(stderr, "Real actor gizmo axis %d did not move\n", axis);
                    app.exit(1);
                    return;
                }
                for (int other = 0; other < 3; ++other)
                    if (other != axis && coordinates[other]->value() != original[other]) {
                        std::fprintf(stderr, "Real actor gizmo unexpectedly changed axis %d\n", other);
                        app.exit(1);
                        return;
                    }
                undo->click();
                if (!restored()) {
                    std::fprintf(stderr, "Real gizmo undo failed on axis %d\n", axis);
                    app.exit(1);
                    return;
                }
            }
            const auto detailPath = QString::fromLocal8Bit(argv[4]) + ".selection.png";
            const auto settleLayout = [] {
                QEventLoop events;
                QTimer::singleShot(40, &events, &QEventLoop::quit);
                events.exec();
            };
            settleLayout();
            const bool detailSaved = window.grab().save(detailPath);
            int boxRow = -1;
            for (int row = 0; row < table->rowCount(); ++row)
                if (table->item(row, 2)->text() == "GarageDoor_4") {
                    boxRow = row;
                    break;
                }
            if (boxRow < 0 || preview->collisionBoxCount() != 3 || !collisionToggle->isEnabled()) {
                std::fprintf(stderr, "Real eligible-box collision inspection did not load\n");
                app.exit(1);
                return;
            }
            table->selectRow(boxRow);
            const qint64 boxId = table->item(boxRow, 0)->text().toLongLong();
            const auto boxCorners = preview->collisionBoxCorners(boxId);
            const QVector3D boxBase(float(coordinates[0]->value()), float(coordinates[1]->value()),
                                    float(coordinates[2]->value()));
            if (boxCorners.size() != 8 ||
                (boxCorners[0] - (boxBase + QVector3D(-5.334f, 0, -.4572f))).length() > 1e-4 ||
                (boxCorners[7] - (boxBase + QVector3D(5.334f, 10.668f, .4572f))).length() > 1e-4 ||
                !collisionInspector->text().contains("10.668") ||
                !collisionInspector->text().contains("0.9144")) {
                std::fprintf(stderr, "Known GarageDoor_4 nominal dimensions/base are incorrect\n");
                app.exit(1);
                return;
            }
            coordinates[0]->setValue(double(boxBase.x()) + 1);
            stage->click();
            const auto movedBox = preview->collisionBoxCorners(boxId);
            if ((movedBox[0] - boxCorners[0] - QVector3D(1, 0, 0)).length() > 1e-4 ||
                !collisionInspector->text().contains("follows pending")) {
                std::fprintf(stderr, "Real box overlay did not follow pending actor translation\n");
                app.exit(1);
                return;
            }
            undo->click();
            if (preview->collisionBoxCorners(boxId) != boxCorners || !pending->text().startsWith("0 ")) {
                std::fprintf(stderr, "Real box overlay undo failed\n");
                app.exit(1);
                return;
            }
            collisionToggle->setChecked(true);
            preview->frameSelection();
            settleLayout();
            const bool collisionSaved =
                window.grab().save(QString::fromLocal8Bit(argv[4]) + ".collision.png");
            table->selectRow(selectedRow);
            preview->frameAll();
            settleLayout();
            const bool saved = window.grab().save(QString::fromLocal8Bit(argv[4]));
            auto *inspectorTabs = window.findChild<QTabWidget *>("inspectorTabs");
            inspectorTabs->setCurrentIndex(2);
            auto *lightingPreset = window.findChild<QComboBox *>("lightingPreset");
            lightingPreset->setCurrentIndex(1);
            Q_EMIT lightingPreset->activated(1);
            collisionToggle->setChecked(false);
            preview->setShowOverlays(false);
            settleLayout();
            const bool lightingSaved = window.grab().save(QString::fromLocal8Bit(argv[4]) + ".lighting.png");
            lightingPreset->setCurrentIndex(0);
            Q_EMIT lightingPreset->activated(0);
            inspectorTabs->setCurrentIndex(0);
            preview->setShowOverlays(true);
            auto *textureToggle = window.findChild<QCheckBox *>("texturePreview");
            const auto texturedView = preview->grab().toImage();
            textureToggle->setChecked(false);
            const auto flatView = preview->grab().toImage();
            const bool flatSaved = window.grab().save(QString::fromLocal8Bit(argv[4]) + ".textures-off.png");
            textureToggle->setChecked(true);
            const bool textureComparison = preview->texturedMeshCount() > 0 && texturedView != flatView;
            const bool sourcePreserved =
                !initialHash.isEmpty() && initialHash == fileHash(QString::fromLocal8Bit(argv[3])) &&
                (argc != 6 ||
                 (!geometryHash.isEmpty() && geometryHash == fileHash(QString::fromLocal8Bit(argv[5]))));
            std::printf("Real 3D scene capture: %s; actors=%d meshes=%d rendered triangles=%d frame=%.2f ms; "
                        "actual-model pick, XYZ field/gizmo movement, exact undo, sources unchanged: %s\n",
                        saved ? argv[4] : "FAILED", preview->objectCount(), preview->meshCount(),
                        preview->renderedTriangleCount(), preview->lastFrameMilliseconds(),
                        sourcePreserved ? "PASS" : "FAIL");
            std::printf("Texture on/off comparison: %d textured meshes, distinct images=%s\n",
                        preview->texturedMeshCount(), textureComparison ? "PASS" : "FAIL");
            app.exit(saved && detailSaved && collisionSaved && lightingSaved && flatSaved &&
                             textureComparison && sourcePreserved
                         ? 0
                         : 1);
            return;
        }
        auto *tabs = window.findChild<QTabWidget *>("inspectorTabs");
        auto *objectsDock = window.findChild<QDockWidget *>("objectsDock");
        auto *inspectorDock = window.findChild<QDockWidget *>("inspectorDock");
        auto *strength = window.findChild<QDoubleSpinBox *>("lightIntensity");
        if (!tabs || tabs->count() != 3 || !objectsDock || !inspectorDock || !strength ||
            window.dockWidgetArea(objectsDock) != Qt::LeftDockWidgetArea ||
            window.dockWidgetArea(inspectorDock) != Qt::RightDockWidgetArea) {
            std::fprintf(stderr, "Dock layout or lighting panel missing\n");
            app.exit(1);
            return;
        }
        tabs->setCurrentIndex(2);
        strength->setValue(1.5);
        if (preview->lightingState().value("intensity").toDouble() != 1.5) {
            std::fprintf(stderr, "Live lighting UI did not reach renderer\n");
            app.exit(1);
            return;
        }
        strength->setValue(.65);
        tabs->setCurrentIndex(0);
        preview->grab(); // Render the depth/picking buffers before clicking.
        if (preview->objectCount() != 2 || preview->meshCount() != 2 ||
            preview->renderedTriangleCount() < 2) {
            std::fprintf(stderr, "3D scene did not load all actors and actual mesh triangles\n");
            app.exit(1);
            return;
        }
        const auto boxCorners = preview->collisionBoxCorners(1);
        if (preview->collisionBoxCount() != 2 || boxCorners.size() != 8 ||
            !preview->collisionBoxCorners(901).isEmpty() ||
            (boxCorners[0] - QVector3D(1, 4.7504663467407227f, -32.273681640625f)).length() > 1e-5 ||
            (boxCorners[7] - QVector3D(9, 10.750466346740723f, -36.273681640625f)).length() > 1e-5 ||
            !collisionToggle->isEnabled()) {
            std::fprintf(stderr,
                         "Collision eligibility, local offset, base-height or native yaw transform failed\n");
            app.exit(1);
            return;
        }
        collisionToggle->setChecked(true);
        const auto location = preview->screenPosition(id);
        QMouseEvent click(QEvent::MouseButtonPress, location, preview->mapToGlobal(location), Qt::LeftButton,
                          Qt::LeftButton, Qt::NoModifier);
        QApplication::sendEvent(preview, &click);
        if (table->currentRow() != 0 || !x->isEnabled() || (!capture && x->value() != 1) ||
            !stage->isEnabled()) {
            std::fprintf(stderr, "Placement preview failed to select editable object\n");
            app.exit(1);
            return;
        }
        const auto originalY = table->item(0, 4)->text();
        const auto originalZ = table->item(0, 5)->text();
        x->setValue(15.5);
        stage->click();
        if (!pending->text().startsWith("1 ") || table->item(0, 3)->text() != "15.5" ||
            table->item(0, 4)->text() != originalY || table->item(0, 5)->text() != originalZ) {
            std::fprintf(stderr, "Staging a position failed to update UI state\n");
            app.exit(1);
            return;
        }
        if ((preview->collisionBoxCorners(1)[0] - boxCorners[0] - QVector3D(14.5f, 0, 0)).length() > 1e-5 ||
            !collisionInspector->text().contains("4, 6, 8") ||
            !collisionInspector->text().contains("follows pending")) {
            std::fprintf(stderr, "Read-only collision inspector/overlay did not follow staged movement\n");
            app.exit(1);
            return;
        }
        preview->setSelected(-1);
        preview->grab();
        const auto offPage = preview->worldToScreen({16, 6, -20});
        QMouseEvent offPageClick(QEvent::MouseButtonPress, offPage, preview->mapToGlobal(offPage),
                                 Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
        QApplication::sendEvent(preview, &offPageClick);
        if (x->value() != 16 || !stage->isEnabled() || !table->selectedItems().isEmpty()) {
            std::fprintf(stderr, "Selecting an actor outside the table page failed\n");
            app.exit(1);
            return;
        }
        const auto beforeFrame = preview->cameraPosition();
        QKeyEvent frameKey(QEvent::KeyPress, Qt::Key_F, Qt::NoModifier);
        QApplication::sendEvent(preview, &frameKey);
        if (preview->cameraPosition() == beforeFrame) {
            std::fprintf(stderr, "Frame-selection shortcut failed\n");
            app.exit(1);
            return;
        }
        preview->setSnap(true);
        preview->setGridSpacing(4);
        preview->grab();
        const auto origin = preview->screenPosition(900), handle = preview->translationHandle(0);
        const auto start = origin + (handle - origin) * .65;
        QMouseEvent press(QEvent::MouseButtonPress, start, preview->mapToGlobal(start), Qt::LeftButton,
                          Qt::LeftButton, Qt::NoModifier);
        QApplication::sendEvent(preview, &press);
        const auto end = start + (handle - origin) * .75;
        QMouseEvent move(QEvent::MouseMove, end, preview->mapToGlobal(end), Qt::NoButton, Qt::LeftButton,
                         Qt::NoModifier);
        QApplication::sendEvent(preview, &move);
        QMouseEvent release(QEvent::MouseButtonRelease, end, preview->mapToGlobal(end), Qt::LeftButton,
                            Qt::NoButton, Qt::NoModifier);
        QApplication::sendEvent(preview, &release);
        if (!pending->text().startsWith("2 ") || x->value() <= 16 || std::fmod(x->value(), 4) != 0) {
            std::fprintf(stderr, "XYZ drag gizmo did not stage a world-space actor move\n");
            app.exit(1);
            return;
        }
        const float movedX = float(x->value());
        preview->setSelected(-1);
        preview->grab();
        const auto movedModel = preview->worldToScreen({movedX, 6, -20});
        QMouseEvent modelClick(QEvent::MouseButtonPress, movedModel, preview->mapToGlobal(movedModel),
                               Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
        QApplication::sendEvent(preview, &modelClick);
        if (!x->isEnabled() || x->value() != movedX) {
            std::fprintf(stderr,
                         "Actor-linked mesh failed to follow a staged position and remain selectable\n");
            app.exit(1);
            return;
        }
        const auto cancelOrigin = preview->screenPosition(900), cancelHandle = preview->translationHandle(0);
        const auto cancelStart = cancelOrigin + (cancelHandle - cancelOrigin) * .6;
        const auto cancelEnd = cancelStart + (cancelHandle - cancelOrigin) * .75;
        QMouseEvent cancelPress(QEvent::MouseButtonPress, cancelStart, preview->mapToGlobal(cancelStart),
                                Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
        QMouseEvent cancelMove(QEvent::MouseMove, cancelEnd, preview->mapToGlobal(cancelEnd), Qt::NoButton,
                               Qt::LeftButton, Qt::NoModifier);
        QApplication::sendEvent(preview, &cancelPress);
        QApplication::sendEvent(preview, &cancelMove);
        QKeyEvent escape(QEvent::KeyPress, Qt::Key_Escape, Qt::NoModifier);
        QApplication::sendEvent(preview, &escape);
        if (x->value() != movedX) {
            std::fprintf(stderr, "Escape failed to restore the pre-drag position\n");
            app.exit(1);
            return;
        }
        const auto beforeFly = preview->cameraPosition();
        const QPointF center(preview->rect().center());
        QMouseEvent look(QEvent::MouseButtonPress, center, preview->mapToGlobal(center), Qt::RightButton,
                         Qt::RightButton, Qt::NoModifier);
        QApplication::sendEvent(preview, &look);
        QKeyEvent walk(QEvent::KeyPress, Qt::Key_W, Qt::NoModifier);
        QApplication::sendEvent(preview, &walk);
        QEventLoop wait;
        QTimer::singleShot(70, &wait, &QEventLoop::quit);
        wait.exec();
        QMouseEvent stopLook(QEvent::MouseButtonRelease, center, preview->mapToGlobal(center),
                             Qt::RightButton, Qt::NoButton, Qt::NoModifier);
        QApplication::sendEvent(preview, &stopLook);
        if (preview->cameraPosition() == beforeFly) {
            std::fprintf(stderr, "RMB/WASD fly camera failed\n");
            app.exit(1);
            return;
        }
        QApplication::sendEvent(preview, &look);
        QApplication::sendEvent(preview, &walk);
        x->setFocus();
        QApplication::processEvents();
        const auto beforeTextFocus = preview->cameraPosition();
        QEventLoop focusWait;
        QTimer::singleShot(70, &focusWait, &QEventLoop::quit);
        focusWait.exec();
        QApplication::sendEvent(x, &frameKey);
        if (preview->cameraPosition() != beforeTextFocus) {
            std::fprintf(stderr, "Camera input leaked into a coordinate field\n");
            app.exit(1);
            return;
        }
        auto *materials = window.findChild<QPushButton *>("materialInspectorButton");
        auto *mode = window.findChild<QComboBox *>("materialDisplayMode");
        auto *isolate = window.findChild<QCheckBox *>("isolateSelection");
        if (!materials || !mode || !isolate) {
            std::fprintf(stderr, "Material diagnosis toolbar missing\n");
            app.exit(1);
            return;
        }
        materials->click();
        auto *materialTable = window.findChild<QTableWidget *>("materialDiagnosticsTable");
        auto *materialFilter = window.findChild<QLineEdit *>("materialDiagnosticsFilter");
        auto *materialDetails = window.findChild<QPlainTextEdit *>("materialDiagnosticsDetails");
        auto *materialFrame = window.findChild<QPushButton *>("materialDiagnosticsFrame");
        if (!materialTable || materialTable->rowCount() != 2 || !materialFilter || !materialDetails ||
            !materialFrame) {
            std::fprintf(stderr, "Material inspector did not load both mesh records\n");
            app.exit(1);
            return;
        }
        materialFilter->setText("actor:900");
        if (!materialTable->isRowHidden(0) || materialTable->isRowHidden(1)) {
            std::fprintf(stderr, "Material row filtering failed\n");
            app.exit(1);
            return;
        }
        materialTable->selectRow(1);
        if (!materialDetails->toPlainText().contains("actor:900:mesh:0") || !materialDetails->isReadOnly()) {
            std::fprintf(stderr, "Material provenance detail selection failed\n");
            app.exit(1);
            return;
        }
        materialFrame->click();
        const auto pivot = preview->cameraState().value("pivot").toArray();
        if (x->isEnabled() || stage->isEnabled() || !table->selectedItems().isEmpty() ||
            !pending->text().startsWith("2 ") || pivot.size() != 3 ||
            std::abs(pivot[0].toDouble() - movedX) > 1e-5 || std::abs(pivot[1].toDouble() - 6) > 1e-5 ||
            std::abs(pivot[2].toDouble() + 20) > 1e-5) {
            std::fprintf(stderr,
                         "Mesh framing lost a pending translation or retained stale actor controls\n");
            app.exit(1);
            return;
        }
        mode->setCurrentText("checker");
        isolate->setChecked(true);
        const auto materialRows = preview->materialReport();
        if (preview->cameraState().value("displayMode") != "checker" ||
            materialRows[0].toObject().value("viewportVisible").toBool() ||
            !materialRows[1].toObject().value("viewportVisible").toBool()) {
            std::fprintf(stderr, "Diagnostic view mode/isolation toolbar wiring failed\n");
            app.exit(1);
            return;
        }
        materialFilter->clear();
        if (materialTable->isRowHidden(0)) {
            std::fprintf(stderr, "Clearing material filter failed\n");
            app.exit(1);
            return;
        }
        window.findChild<QPushButton *>("materialDiagnosticsPreview")->click();
        auto *layerImage = window.findChild<QComboBox *>("materialLayerImage");
        auto *layerUv = window.findChild<QComboBox *>("materialLayerUv");
        auto *layerLoad = window.findChild<QPushButton *>("materialLayerLoad");
        auto *layerView = static_cast<SceneView *>(window.findChild<QWidget *>("materialLayerViewport"));
        if (!layerImage || layerImage->count() != 3 || !layerUv || layerUv->count() != 2 || !layerLoad ||
            !layerView) {
            std::fprintf(stderr, "Bound-image diagnostic window did not populate source choices\n");
            app.exit(1);
            return;
        }
        layerImage->setCurrentIndex(layerImage->findData(11));
        layerUv->setCurrentIndex(layerUv->findData(1));
        layerLoad->click();
        QElapsedTimer layerElapsed;
        layerElapsed.start();
        while (!layerLoad->isEnabled() && layerElapsed.elapsed() < 5000) {
            QEventLoop events;
            QTimer::singleShot(10, &events, &QEventLoop::quit);
            events.exec();
        }
        const auto layerRecord = layerView->selectedMeshReport();
        if (!layerLoad->isEnabled() || layerView->meshCount() != 1 || layerView->objectCount() != 0 ||
            layerRecord.value("textureSourceImageId").toInt() != 11 ||
            layerRecord.value("uvInfo").toObject().value("channel").toInt() != 1 ||
            !pending->text().startsWith("2 ") || x->isEnabled()) {
            std::fprintf(stderr, "Read-only image/UV override failed or changed main edit state\n");
            app.exit(1);
            return;
        }
        const auto layerCamera = layerView->cameraState();
        layerUv->setCurrentIndex(0);
        layerLoad->click();
        layerElapsed.restart();
        while (!layerLoad->isEnabled() && layerElapsed.elapsed() < 5000) {
            QEventLoop events;
            QTimer::singleShot(10, &events, &QEventLoop::quit);
            events.exec();
        }
        if (!layerLoad->isEnabled() ||
            layerView->cameraState().value("pivot") != layerCamera.value("pivot") ||
            layerView->cameraState().value("distance") != layerCamera.value("distance")) {
            std::fprintf(stderr, "Diagnostic camera changed between UV comparisons\n");
            app.exit(1);
            return;
        }
        std::puts("GUI triangles, linked-model picking/movement, off-page selection, snapped/cancelled XYZ "
                  "drag, camera/focus handling, material inspection/filtering, moved-mesh framing and "
                  "diagnostic isolation passed.");
        app.exit(0);
    });
    poll.start(20);
    return app.exec();
}
