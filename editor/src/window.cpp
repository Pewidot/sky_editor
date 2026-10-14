#include "window.h"
#include "portaldialog.h"
#include "sceneview.h"

#include <QCheckBox>
#include <QCloseEvent>
#include <QColorDialog>
#include <QComboBox>
#include <QDateTime>
#include <QDialog>
#include <QDockWidget>
#include <QDoubleSpinBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QMenu>
#include <QMenuBar>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QSignalBlocker>
#include <QSplitter>
#include <QStatusBar>
#include <QStyle>
#include <QTabWidget>
#include <QTableWidget>
#include <QTimer>
#include <QVBoxLayout>
#include <cmath>

EditorWindow::EditorWindow(BackendConfig config) : config_(std::move(config)) {
    setWindowTitle("Trap Team · Level Workshop");
    resize(1480, 940);
    setDockNestingEnabled(true);
    setStyleSheet(R"CSS(
        QMainWindow, QDialog { background: #161b22; color: #dce4ef; }
        QWidget { background: #1b2430; color: #dce4ef; font-size: 12px; }
        QDockWidget { font-weight: 600; border: 0; }
        QDockWidget::title { background: #222b36; padding: 9px 10px; border-bottom: 1px solid #344151; }
        QMainWindow::separator { width: 5px; height: 5px; background: #11161d; }
        QMainWindow::separator:hover { background: #458ce6; }
        QMenuBar, QMenu, QStatusBar { background: #1c232d; color: #c6d2e1; }
        QMenuBar::item:selected, QMenu::item:selected { background: #304765; }
        QMenu::item { padding: 7px 22px; }
        QPushButton { background: #293443; border: 1px solid #3c4b5e; border-radius: 5px; padding: 7px 11px; }
        QPushButton:hover { background: #35475e; border-color: #6486af; }
        QPushButton:pressed { background: #1d2a3c; }
        QPushButton:disabled { color: #677588; background: #202833; border-color: #2b3543; }
        QPushButton#primaryBuild, QPushButton#stagePosition { background: #2763a4; border-color: #458de0; color: white; }
        QPushButton#primaryBuild:hover, QPushButton#stagePosition:hover { background: #337ac4; }
        QLineEdit, QComboBox, QDoubleSpinBox, QSpinBox, QPlainTextEdit { background: #151d27; border: 1px solid #354356;
            border-radius: 4px; padding: 5px; selection-background-color: #315e91; color: #dce4ef; }
        QLineEdit:focus, QComboBox:focus, QDoubleSpinBox:focus { border-color: #5b9ce8; }
        QComboBox QAbstractItemView { background: #202c3a; color: #dce4ef; selection-background-color: #315e91; }
        QTableWidget { background: #18212c; alternate-background-color: #1d2835; color: #dce4ef;
            border: 0; gridline-color: #283648; selection-background-color: #2c527e; selection-color: white; }
        QHeaderView::section { background: #222e3d; color: #98acc5; padding: 7px 6px; border: 0; border-right: 1px solid #354151; }
        QGroupBox { border: 1px solid #344152; border-radius: 5px; margin-top: 15px; padding: 12px 8px 8px; }
        QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 4px; color: #9eb8d8; }
        QTabWidget::pane { border: 0; background: #1b2430; }
        QTabBar::tab { background: #202a37; color: #99abc1; padding: 10px 13px; border-bottom: 2px solid #202a37; }
        QTabBar::tab:selected { color: #edf4ff; background: #283649; border-bottom-color: #66a7f5; }
        QScrollArea { border: 0; background: #1b2430; }
        QScrollBar:vertical { background: #19212c; width: 10px; }
        QScrollBar::handle:vertical { background: #405066; border-radius: 4px; min-height: 24px; }
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
        QCheckBox { spacing: 8px; padding: 4px 0; }
        QLabel#brand { color: #ecf4ff; font-size: 15px; font-weight: 700; padding: 4px 12px 4px 2px; }
        QLabel#mutedNotice { color: #96a8bf; font-size: 11px; }
        QToolTip { background: #25354a; color: #f0f5ff; border: 1px solid #59718f; padding: 6px; }
    )CSS");
    auto *central = new QWidget(this);
    auto *layout = new QVBoxLayout(central);
    layout->setContentsMargins(8, 6, 8, 6);
    layout->setSpacing(6);
    auto *toolbar = new QHBoxLayout;
    auto *brand = new QLabel("LEVEL WORKSHOP");
    brand->setObjectName("brand");
    toolbar->addWidget(brand);
    open_ = new QPushButton("Open level…");
    geometry_ = new QPushButton("Geometry…");
    build_ = new QPushButton("Build copy…");
    build_->setObjectName("primaryBuild");
    open_->setIcon(style()->standardIcon(QStyle::SP_DirOpenIcon));
    build_->setIcon(style()->standardIcon(QStyle::SP_DialogSaveButton));
    toolbar->addWidget(open_);
    toolbar->addWidget(geometry_);
    auto *portal = new QPushButton("Virtual portal…");
    toolbar->addWidget(portal);
    toolbar->addStretch();
    toolbar->addWidget(build_);
    layout->addLayout(toolbar);
    summary_ = new QLabel("Open the inner level.bld IGZ extracted from a game .bld archive.");
    summary_->setTextFormat(Qt::PlainText);
    summary_->setWordWrap(true);
    summary_->setTextInteractionFlags(Qt::TextSelectableByMouse);
    auto *notice =
        new QLabel("3D placement editor · static map geometry is read-only · actors without decoded models "
                   "use proxies · verified root actors have world-space move gizmos · test exports in game.");
    notice->setWordWrap(true);
    notice->setObjectName("mutedNotice");
    auto *filters = new QVBoxLayout;
    types_ = new QComboBox;
    types_->setObjectName("typeFilter");
    types_->addItem("All types", "");
    types_->setMinimumWidth(0);
    types_->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
    types_->setMinimumContentsLength(16);
    query_ = new QLineEdit;
    query_->setPlaceholderText("Search names and types");
    filter_ = new QPushButton("Filter");
    filters->addWidget(types_);
    filters->addWidget(query_);
    filters->addWidget(filter_);
    auto *viewControls = new QHBoxLayout;
    auto *frameAll = new QPushButton("Frame map (Home)");
    auto *frameSelected = new QPushButton("Frame selected (F)");
    auto *snap = new QCheckBox("Snap");
    snap->setObjectName("snapEnabled");
    auto *grid = new QDoubleSpinBox;
    grid->setObjectName("gridSpacing");
    grid->setRange(.01, 10000);
    grid->setValue(1);
    grid->setPrefix("Step: ");
    auto *wireframe = new QCheckBox("Triangle edges");
    auto *sky = new QCheckBox("Sky geometry");
    skyToggle_ = sky;
    auto *textures = new QCheckBox("RGB textures · preview");
    textures->setObjectName("texturePreview");
    textures->setChecked(true);
    textures->setToolTip("Read-only 256px stored-mip color preview. Unsupported/layered materials stay flat. "
                         "No game shader, alpha blending or normal-map reconstruction.");
    viewControls->addWidget(frameAll);
    viewControls->addWidget(frameSelected);
    viewControls->addStretch();
    layout->addLayout(viewControls);
    auto *displayMode = new QComboBox;
    displayMode->setObjectName("materialDisplayMode");
    for (const auto &mode : {"material", "unlit", "checker", "missing", "flat"})
        displayMode->addItem(mode);
    displayMode->setToolTip(
        "checker: 8 squares per raw UV unit. Magenta: missing UVs. missing: green decoded texture / magenta "
        "fallback. These modes are diagnostic, not the game shader.");
    auto *overlays = new QCheckBox("World grid and editor overlays");
    overlays->setObjectName("sceneOverlays");
    overlays->setChecked(true);
    overlays->setToolTip(
        "Fixed Y=0 world reference grid, actor proxies and selection. The grid is not game geometry.");
    auto *isolate = new QCheckBox("Isolate selection");
    isolate->setObjectName("isolateSelection");
    auto *materials = new QPushButton("Material inspector…");
    materials->setObjectName("materialInspectorButton");
    viewControls->addWidget(new QLabel("Shading"));
    viewControls->addWidget(displayMode);
    auto *collisionControls = new QVBoxLayout;
    collisionToggle_ = new QCheckBox("Collision boxes · x-ray preview (read-only)");
    collisionToggle_->setObjectName("collisionOverlay");
    collisionToggle_->setToolTip(
        "Only structurally eligible actor BOX collisions; not static Havok terrain or complete collision "
        "coverage. Nominal bounds, not bevel geometry or runtime state.");
    collisionSummary_ = new QLabel("Not inspected");
    collisionSummary_->setObjectName("collisionSummary");
    collisionSummary_->setTextFormat(Qt::PlainText);
    collisionSummary_->setWordWrap(true);
    collisionControls->addWidget(collisionToggle_);
    collisionControls->addWidget(collisionSummary_, 1);
    table_ = new QTableWidget(0, 7);
    table_->setObjectName("objectsTable");
    table_->setHorizontalHeaderLabels({"Object ID", "Type", "Name", "X", "Y", "Z", "Offset"});
    table_->setSelectionBehavior(QAbstractItemView::SelectRows);
    table_->setSelectionMode(QAbstractItemView::SingleSelection);
    table_->setEditTriggers(QAbstractItemView::NoEditTriggers);
    table_->setAlternatingRowColors(true);
    table_->verticalHeader()->setVisible(false);
    table_->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeToContents);
    table_->horizontalHeader()->setSectionResizeMode(2, QHeaderView::Stretch);
    table_->setShowGrid(false);
    table_->verticalHeader()->setDefaultSectionSize(28);
    table_->horizontalHeader()->setSectionResizeMode(1, QHeaderView::Interactive);
    table_->setColumnWidth(1, 105);
    for (int column = 3; column < 7; ++column)
        table_->hideColumn(column);
    preview_ = new SceneView;
    preview_->setObjectName("sceneViewport");
    layout->addWidget(preview_, 1);
    auto *properties = new QWidget;
    auto *propertyLayout = new QVBoxLayout(properties);
    selection_ = new QLabel("Select an object to view its position.");
    selection_->setTextFormat(Qt::PlainText);
    selection_->setWordWrap(true);
    selection_->setAlignment(Qt::AlignTop | Qt::AlignLeft);
    selection_->setMinimumHeight(70);
    propertyLayout->addWidget(selection_);
    auto *form = new QFormLayout;
    for (int axis = 0; axis < 3; ++axis) {
        coordinates_[axis] = new QDoubleSpinBox;
        coordinates_[axis]->setObjectName(QString("position%1").arg(axis));
        coordinates_[axis]->setRange(-1e6, 1e6);
        coordinates_[axis]->setDecimals(9);
        coordinates_[axis]->setSingleStep(1.0);
        connect(coordinates_[axis], qOverload<double>(&QDoubleSpinBox::valueChanged), this,
                [this, axis](double) { coordinateChanged_[axis] = true; });
        form->addRow(QString("XYZ").mid(axis, 1), coordinates_[axis]);
    }
    propertyLayout->addLayout(form);
    apply_ = new QPushButton("Stage position change");
    apply_->setObjectName("stagePosition");
    undo_ = new QPushButton("Undo selected change");
    undo_->setObjectName("undoSelected");
    clear_ = new QPushButton("Clear all pending changes");
    pending_ = new QLabel;
    pending_->setObjectName("pendingCount");
    propertyLayout->addWidget(apply_);
    propertyLayout->addWidget(undo_);
    propertyLayout->addSpacing(15);
    propertyLayout->addWidget(pending_);
    propertyLayout->addWidget(clear_);
    auto *collisionGroup = new QGroupBox("Actor collision · read-only");
    auto *collisionLayout = new QVBoxLayout(collisionGroup);
    collisionInspector_ = new QLabel("Select an actor to inspect its collision.");
    collisionInspector_->setObjectName("collisionInspector");
    collisionInspector_->setTextFormat(Qt::PlainText);
    collisionInspector_->setWordWrap(true);
    collisionInspector_->setAlignment(Qt::AlignTop | Qt::AlignLeft);
    collisionInspector_->setTextInteractionFlags(Qt::TextSelectableByMouse);
    collisionLayout->addWidget(collisionInspector_);
    propertyLayout->addWidget(collisionGroup);
    propertyLayout->addWidget(notice);
    propertyLayout->addStretch();
    propertyLayout->setSizeConstraint(QLayout::SetMinimumSize);
    auto *propertyScroll = new QScrollArea;
    propertyScroll->setWidgetResizable(true);
    propertyScroll->setFrameShape(QFrame::NoFrame);
    propertyScroll->setMinimumWidth(270);
    propertyScroll->setWidget(properties);
    auto *pagination = new QHBoxLayout;
    previous_ = new QPushButton("Previous");
    next_ = new QPushButton("Next");
    page_ = new QLabel;
    pagination->addWidget(previous_);
    pagination->addWidget(next_);
    pagination->addWidget(page_);
    pagination->addStretch();
    log_ = new QPlainTextEdit;
    log_->setReadOnly(true);
    log_->setMaximumBlockCount(300);
    setCentralWidget(central);
    auto *objectPanel = new QWidget;
    auto *objectLayout = new QVBoxLayout(objectPanel);
    objectLayout->setContentsMargins(9, 9, 9, 9);
    objectLayout->addLayout(filters);
    objectLayout->addWidget(table_, 1);
    objectLayout->addLayout(pagination);
    auto *objectsDock = new QDockWidget("SCENE OBJECTS", this);
    objectsDock->setObjectName("objectsDock");
    objectsDock->setWidget(objectPanel);
    addDockWidget(Qt::LeftDockWidgetArea, objectsDock);
    auto *displayPanel = new QWidget;
    auto *displayLayout = new QVBoxLayout(displayPanel);
    auto *snapRow = new QHBoxLayout;
    snapRow->addWidget(snap);
    snapRow->addWidget(grid);
    displayLayout->addLayout(snapRow);
    for (auto *checkbox : {textures, wireframe, sky, overlays, isolate})
        displayLayout->addWidget(checkbox);
    displayLayout->addWidget(materials);
    displayLayout->addSpacing(12);
    displayLayout->addLayout(collisionControls);
    displayLayout->addStretch();
    auto *tabs = new QTabWidget;
    tabs->setObjectName("inspectorTabs");
    tabs->addTab(propertyScroll, "Object");
    tabs->addTab(displayPanel, "Display");
    tabs->addTab(createLightingPanel(), "Lighting");
    auto *inspectorDock = new QDockWidget("INSPECTOR", this);
    inspectorDock->setObjectName("inspectorDock");
    inspectorDock->setWidget(tabs);
    addDockWidget(Qt::RightDockWidgetArea, inspectorDock);
    auto *consolePanel = new QWidget;
    auto *consoleLayout = new QVBoxLayout(consolePanel);
    consoleLayout->addWidget(summary_);
    consoleLayout->addWidget(log_);
    auto *consoleDock = new QDockWidget("OUTPUT / SOURCE DETAILS", this);
    consoleDock->setObjectName("consoleDock");
    consoleDock->setWidget(consolePanel);
    addDockWidget(Qt::BottomDockWidgetArea, consoleDock);
    consoleDock->hide();
    resizeDocks({objectsDock, inspectorDock}, {300, 330}, Qt::Horizontal);
    auto *fileMenu = menuBar()->addMenu("File");
    connect(fileMenu->addAction("Open level…"), &QAction::triggered, open_, &QPushButton::click);
    connect(fileMenu->addAction("Load geometry…"), &QAction::triggered, geometry_, &QPushButton::click);
    connect(fileMenu->addAction("Build edited copy…"), &QAction::triggered, build_, &QPushButton::click);
    fileMenu->addSeparator();
    connect(fileMenu->addAction("Close editor"), &QAction::triggered, this, &QWidget::close);
    auto *viewMenu = menuBar()->addMenu("View");
    for (auto *dock : {objectsDock, inspectorDock, consoleDock})
        viewMenu->addAction(dock->toggleViewAction());
    viewMenu->addSeparator();
    connect(viewMenu->addAction("Reset panel layout"), &QAction::triggered, this,
            [this, objectsDock, inspectorDock, consoleDock] {
                objectsDock->setFloating(false);
                inspectorDock->setFloating(false);
                consoleDock->setFloating(false);
                addDockWidget(Qt::LeftDockWidgetArea, objectsDock);
                addDockWidget(Qt::RightDockWidgetArea, inspectorDock);
                addDockWidget(Qt::BottomDockWidgetArea, consoleDock);
                objectsDock->show();
                inspectorDock->show();
                consoleDock->hide();
                resizeDocks({objectsDock, inspectorDock}, {300, 330}, Qt::Horizontal);
            });
    statusBar()->showMessage("Ready · original game files are never overwritten");

    connect(open_, &QPushButton::clicked, this, [this] {
        const QString path = QFileDialog::getOpenFileName(
            this, "Open level or authored scene", {},
            "Levels and scenes (*.bld *.igz *.scene.json);;Authored preview (*.scene.json);;All files (*)");
        if (!path.isEmpty())
            openPath(path);
    });
    connect(geometry_, &QPushButton::clicked, this, [this] {
        const QString path = QFileDialog::getOpenFileName(this, "Load companion inner geometry IGZ", {},
                                                          "Geometry payload (*.bld *.igz);;All files (*)");
        if (!path.isEmpty()) {
            geometryPath_ = QFileInfo(path).absoluteFilePath();
            loadScene(false);
        }
    });
    connect(portal, &QPushButton::clicked, this, [this] {
        if (!portal_) {
            portal_ = new PortalDialog(config_, this);
            portal_->setAttribute(Qt::WA_DeleteOnClose);
        }
        portal_->show();
        portal_->raise();
        portal_->activateWindow();
    });
    connect(frameAll, &QPushButton::clicked, this, [this] { preview_->frameAll(); });
    connect(frameSelected, &QPushButton::clicked, this, [this] { preview_->frameSelection(); });
    connect(snap, &QCheckBox::toggled, this, [this](bool checked) { preview_->setSnap(checked); });
    connect(grid, qOverload<double>(&QDoubleSpinBox::valueChanged), this,
            [this](double value) { preview_->setGridSpacing(value); });
    connect(wireframe, &QCheckBox::toggled, this, [this](bool checked) { preview_->setWireframe(checked); });
    connect(sky, &QCheckBox::toggled, this, [this](bool checked) { preview_->setShowSky(checked); });
    connect(textures, &QCheckBox::toggled, this,
            [this](bool checked) { preview_->setShowTextures(checked); });
    connect(displayMode, &QComboBox::currentTextChanged, this,
            [this](const QString &mode) { preview_->setDisplayMode(mode); });
    connect(overlays, &QCheckBox::toggled, this,
            [this](bool checked) { preview_->setShowOverlays(checked); });
    connect(isolate, &QCheckBox::toggled, this,
            [this](bool checked) { preview_->setIsolateSelection(checked); });
    connect(materials, &QPushButton::clicked, this, [this] {
        if (busy_ || path_.isEmpty())
            return;
        QJsonObject source{{"path", path_}, {"expectedSha256", sourceSha256_}};
        if (!geometryPath_.isEmpty())
            source.insert("geometryPath", geometryPath_);
        auto *dialog = new QDialog(this);
        dialog->setAttribute(Qt::WA_DeleteOnClose);
        dialog->setWindowTitle("Material / UV diagnostics · read-only");
        dialog->resize(1000, 700);
        auto *layout = new QVBoxLayout(dialog);
        auto *filter = new QLineEdit;
        filter->setObjectName("materialDiagnosticsFilter");
        filter->setPlaceholderText("Filter material, mesh key or fallback reason…");
        layout->addWidget(filter);
        auto *table = new QTableWidget(0, 4);
        table->setObjectName("materialDiagnosticsTable");
        table->setHorizontalHeaderLabels({"Mesh key", "Material", "Texture", "Fallback / limitation"});
        table->setSelectionBehavior(QAbstractItemView::SelectRows);
        table->setSelectionMode(QAbstractItemView::SingleSelection);
        table->setEditTriggers(QAbstractItemView::NoEditTriggers);
        table->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeToContents);
        table->horizontalHeader()->setStretchLastSection(true);
        layout->addWidget(table, 1);
        auto *details = new QPlainTextEdit;
        details->setObjectName("materialDiagnosticsDetails");
        details->setReadOnly(true);
        layout->addWidget(details, 1);
        auto *frame = new QPushButton("Frame selected mesh in viewport");
        frame->setObjectName("materialDiagnosticsFrame");
        layout->addWidget(frame);
        auto *preview = new QPushButton("Inspect bound images / UV channels…");
        preview->setObjectName("materialDiagnosticsPreview");
        layout->addWidget(preview);
        const auto records = preview_->materialReport();
        for (const auto &entry : records) {
            const auto record = entry.toObject();
            const int row = table->rowCount();
            table->insertRow(row);
            const QStringList cells{
                record.value("selectionKey").toString(), record.value("materialName").toString(),
                record.value("viewportTextured").toBool() ? "RGB preview" : "MISSING",
                record.value("textureFallbackReason").toString("Shader/UV mapping not yet verified")};
            for (int column = 0; column < cells.size(); ++column)
                table->setItem(row, column, new QTableWidgetItem(cells[column]));
        }
        connect(table, &QTableWidget::itemSelectionChanged, dialog, [table, details, records] {
            if (table->currentRow() >= 0)
                details->setPlainText(QString::fromUtf8(
                    QJsonDocument(records[table->currentRow()].toObject()).toJson(QJsonDocument::Indented)));
        });
        connect(frame, &QPushButton::clicked, dialog, [this, table, records, source, details] {
            if (busy_ || table->currentRow() < 0)
                return;
            if (source.value("path").toString() != path_ ||
                source.value("expectedSha256").toString() != sourceSha256_ ||
                source.value("geometryPath").toString() != geometryPath_) {
                details->setPlainText(
                    "The main scene changed. Reopen the material inspector before framing.");
                return;
            }
            const auto record = records[table->currentRow()].toObject();
            if (preview_->frameMesh(record.value("selectionKey").toString()))
                preview_->onSelectGeometry(record.value("name").toString());
        });
        connect(preview, &QPushButton::clicked, dialog, [this, table, records, source] {
            if (table->currentRow() >= 0)
                openMaterialPreview(source, records[table->currentRow()].toObject());
        });
        connect(filter, &QLineEdit::textChanged, dialog, [table](const QString &query) {
            for (int row = 0; row < table->rowCount(); ++row) {
                QString text;
                for (int column = 0; column < table->columnCount(); ++column)
                    text += table->item(row, column)->text() + ' ';
                table->setRowHidden(row, !text.contains(query, Qt::CaseInsensitive));
            }
        });
        dialog->show();
    });
    connect(collisionToggle_, &QCheckBox::toggled, this,
            [this](bool checked) { preview_->setShowCollisions(checked); });
    connect(filter_, &QPushButton::clicked, this, [this] { loadPage(0); });
    connect(query_, &QLineEdit::returnPressed, this, [this] {
        if (!busy_)
            loadPage(0);
    });
    connect(types_, qOverload<int>(&QComboBox::activated), this, [this](int) { loadPage(0); });
    connect(previous_, &QPushButton::clicked, this, [this] { loadPage(qMax(0, offset_ - 200)); });
    connect(next_, &QPushButton::clicked, this, [this] { loadPage(nextOffset_); });
    connect(table_, &QTableWidget::itemSelectionChanged, this, [this] { selectionChanged(); });
    preview_->onSelect = [this](qint64 id) {
        if (busy_)
            return;
        selectObject(id);
    };
    preview_->onMove = [this](qint64 id, QVector3D position) {
        if (busy_ || !sceneObjects_.value(id).value("worldEditable").toBool())
            return;
        const QJsonArray moved{position.x(), position.y(), position.z()};
        if (moved == sceneObjects_.value(id).value("position").toArray())
            edits_.remove(id);
        else
            edits_.insert(id, moved);
        refreshEditedObjects();
        updatePending();
        updateSelection();
    };
    preview_->onSelectGeometry = [this](const QString &name) {
        selectedObject_ = {};
        const QSignalBlocker blocker(table_);
        table_->clearSelection();
        updateSelection();
        selection_->setText("Mesh inspection (read-only)\n" + name +
                            "\n\nSelect an actor to edit its position. Mesh rebuilding is not implemented.");
    };
    connect(apply_, &QPushButton::clicked, this, [this] { stagePosition(); });
    connect(undo_, &QPushButton::clicked, this, [this] {
        if (!selectedObject_.isEmpty()) {
            edits_.remove(selectedObject_.value("id").toInteger());
            updatePending();
            refreshEditedObjects();
            updateSelection();
        }
    });
    connect(clear_, &QPushButton::clicked, this, [this] {
        if (!canDiscard())
            return;
        edits_.clear();
        updatePending();
        refreshEditedObjects();
        updateSelection();
    });
    connect(build_, &QPushButton::clicked, this, [this] { buildCopy(); });
    updatePending();
    setBusy(false);
    log("Backend: " + config_.script);
}

QWidget *EditorWindow::createLightingPanel() {
    auto *panel = new QWidget;
    panel->setObjectName("lightingPanel");
    auto *layout = new QVBoxLayout(panel);
    auto *heading = new QLabel("Viewport lighting");
    heading->setStyleSheet("font-size: 15px; font-weight: 600;");
    layout->addWidget(heading);
    auto *notice = new QLabel("Live editor light rig. These controls change the preview only, never game "
                              "data. Native active lights, shadows and fog are not reconstructed yet.");
    notice->setObjectName("mutedNotice");
    notice->setWordWrap(true);
    layout->addWidget(notice);
    auto *preset = new QComboBox;
    preset->setObjectName("lightingPreset");
    preset->addItems({"Studio neutral", "Warm afternoon", "Cool evening"});
    layout->addWidget(preset);
    auto *form = new QFormLayout;
    auto number = [&](const char *name, const QString &label, double low, double high, double value,
                      double step) {
        auto *spin = new QDoubleSpinBox;
        spin->setObjectName(name);
        spin->setRange(low, high);
        spin->setDecimals(2);
        spin->setSingleStep(step);
        spin->setValue(value);
        form->addRow(label, spin);
        return spin;
    };
    const auto initial = preview_->lightingState();
    const auto direction = initial.value("direction").toArray();
    constexpr double degrees = 180. / 3.141592653589793;
    auto *azimuth = number("lightAzimuth", "Sun azimuth", -180, 180,
                           std::atan2(direction[0].toDouble(), direction[2].toDouble()) * degrees, 5);
    auto *elevation =
        number("lightElevation", "Sun elevation", -90, 90, std::asin(direction[1].toDouble()) * degrees, 5);
    auto *intensity = number("lightIntensity", "Key strength", 0, 8, .65, .05);
    auto *ambient = number("lightAmbient", "Ambient fill", 0, 4, .35, .05);
    auto *exposure = number("lightExposure", "Exposure (EV)", -8, 8, 0, .25);
    layout->addLayout(form);
    auto *color = new QPushButton("Key light color");
    color->setObjectName("lightColor");
    color->setProperty("lightColor", QColor(Qt::white));
    layout->addWidget(color);
    auto *twoSided = new QCheckBox("Light both sides of faces");
    twoSided->setObjectName("lightTwoSided");
    twoSided->setChecked(true);
    twoSided->setToolTip("Useful while triangle winding/material culling is still being investigated. Turn "
                         "off for one-sided Lambert lighting.");
    layout->addWidget(twoSided);
    auto *reset = new QPushButton("Reset lighting");
    layout->addWidget(reset);
    auto *hint = new QLabel(
        "Use Shading: material or flat to see lighting. Unlit / checker / missing intentionally bypass it.");
    hint->setObjectName("mutedNotice");
    hint->setWordWrap(true);
    layout->addWidget(hint);
    layout->addStretch();
    const auto apply = [this, azimuth, elevation, intensity, ambient, exposure, color, twoSided] {
        const double yaw = azimuth->value() / degrees, pitch = elevation->value() / degrees;
        const auto c = color->property("lightColor").value<QColor>();
        preview_->setLightingState(
            {{"direction",
              QJsonArray{std::sin(yaw) * std::cos(pitch), std::sin(pitch), std::cos(yaw) * std::cos(pitch)}},
             {"ambient", QJsonArray{ambient->value(), ambient->value(), ambient->value()}},
             {"keyColor", QJsonArray{c.redF(), c.greenF(), c.blueF()}},
             {"intensity", intensity->value()},
             {"exposure", exposure->value()},
             {"twoSided", twoSided->isChecked()}});
        color->setText("Key light · " + c.name());
    };
    for (auto *spin : {azimuth, elevation, intensity, ambient, exposure})
        connect(spin, qOverload<double>(&QDoubleSpinBox::valueChanged), panel, [apply](double) { apply(); });
    connect(twoSided, &QCheckBox::toggled, panel, [apply](bool) { apply(); });
    connect(color, &QPushButton::clicked, panel, [panel, color, apply] {
        const auto c =
            QColorDialog::getColor(color->property("lightColor").value<QColor>(), panel, "Preview key light");
        if (c.isValid()) {
            color->setProperty("lightColor", c);
            apply();
        }
    });
    connect(preset, qOverload<int>(&QComboBox::activated), panel,
            [azimuth, elevation, intensity, ambient, exposure, color, twoSided, apply, initial](int index) {
                const QSignalBlocker a(azimuth), e(elevation), i(intensity), m(ambient), x(exposure),
                    t(twoSided);
                const auto d = initial.value("direction").toArray();
                azimuth->setValue(index == 0   ? std::atan2(d[0].toDouble(), d[2].toDouble()) * degrees
                                  : index == 1 ? -55
                                               : 65);
                elevation->setValue(index == 0 ? std::asin(d[1].toDouble()) * degrees : index == 1 ? 25 : 18);
                intensity->setValue(index == 0 ? .65 : index == 1 ? 1.1 : .85);
                ambient->setValue(index == 0 ? .35 : index == 1 ? .22 : .16);
                exposure->setValue(0);
                twoSided->setChecked(true);
                color->setProperty("lightColor", QColor(index == 0   ? "#ffffff"
                                                        : index == 1 ? "#ffd0a0"
                                                                     : "#a8c9ff"));
                apply();
            });
    connect(reset, &QPushButton::clicked, panel, [preset] {
        preset->setCurrentIndex(0);
        Q_EMIT preset->activated(0);
    });
    return panel;
}

void EditorWindow::openMaterialPreview(const QJsonObject &source, const QJsonObject &record) {
    const auto key = record.value("selectionKey").toString();
    if (key.isEmpty())
        return;
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setObjectName("materialLayerDialog");
    dialog->resize(1000, 780);
    dialog->setWindowTitle("Bound image / UV preview · diagnostic only");
    auto *layout = new QVBoxLayout(dialog);
    auto *notice = new QLabel("Saved source mesh only; pending edits are not included. Image/channel "
                              "overrides are diagnostic, not verified game materials.");
    notice->setWordWrap(true);
    layout->addWidget(notice);
    auto *controls = new QHBoxLayout;
    auto *image = new QComboBox;
    image->setObjectName("materialLayerImage");
    image->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
    image->setMinimumContentsLength(28);
    image->addItem("Automatic diffuse selection", -1);
    QSet<qint64> imageIds;
    for (const auto &entry : record.value("textureBindings").toArray()) {
        const auto binding = entry.toObject();
        const auto id = binding.value("imageId").toInteger(-1);
        if (id < 0 || imageIds.contains(id))
            continue;
        imageIds.insert(id);
        image->addItem(QString("#%1 · %2").arg(id).arg(binding.value("name").toString()), id);
    }
    auto *uv = new QComboBox;
    uv->setObjectName("materialLayerUv");
    QSet<int> channels;
    for (const auto &entry : record.value("uvInfo").toObject().value("channels").toArray()) {
        const int channel = entry.toObject().value("channel").toInt(-1);
        if (channel < 0 || channel > 7 || channels.contains(channel))
            continue;
        channels.insert(channel);
        uv->addItem(QString("TEXCOORD%1").arg(channel), channel);
    }
    if (uv->count() == 0)
        uv->addItem("TEXCOORD0", 0);
    auto *mode = new QComboBox;
    mode->setObjectName("materialLayerMode");
    mode->addItems({"unlit", "checker", "material", "missing", "flat"});
    auto *reload = new QPushButton("Load preview");
    reload->setObjectName("materialLayerLoad");
    controls->addWidget(image, 1);
    controls->addWidget(uv);
    controls->addWidget(mode);
    controls->addWidget(reload);
    layout->addLayout(controls);
    auto *view = new SceneView;
    view->setObjectName("materialLayerViewport");
    view->setDisplayMode("unlit");
    view->setShowOverlays(false);
    view->setShowSky(true);
    layout->addWidget(view, 1);
    auto *status =
        new QLabel("Choose a bound image and UV channel, then load. Camera is retained when reloading.");
    status->setObjectName("materialLayerStatus");
    status->setWordWrap(true);
    status->setTextFormat(Qt::PlainText);
    layout->addWidget(status);
    connect(mode, &QComboBox::currentTextChanged, dialog,
            [view](const QString &value) { view->setDisplayMode(value); });
    connect(reload, &QPushButton::clicked, dialog,
            [this, dialog, source, key, image, uv, reload, view, status] {
                QJsonObject request = source;
                request.insert("operation", "scene");
                request.insert("includeGeometry", true);
                request.insert("includeTextures", true);
                request.insert("previewMeshKey", key);
                request.insert("texturePreviewSize", 1024);
                request.insert("uvChannel", uv->currentData().toInt());
                if (image->currentData().toLongLong() >= 0)
                    request.insert("textureImageId", image->currentData().toLongLong());
                const auto camera = view->meshCount() > 0 ? view->cameraState() : QJsonObject{};
                image->setEnabled(false);
                uv->setEnabled(false);
                reload->setEnabled(false);
                status->setText("Loading source-bound preview…");
                // The dialog owns the child process. Closing it cancels only this read-
                // only preview; guarded widgets also prevent callbacks into deleted UI.
                QPointer<SceneView> guard(view);
                callBackendAsync(
                    dialog, config_, request,
                    [guard, image, uv, reload, status, camera, key](BackendResult result) {
                        if (!guard)
                            return;
                        image->setEnabled(true);
                        uv->setEnabled(true);
                        reload->setEnabled(true);
                        if (!result.ok()) {
                            status->setText("Preview error: " + result.error);
                            return;
                        }
                        auto scene = result.value;
                        scene.insert("objects", QJsonArray{}); // no editable actors in this inspection window
                        guard->setScene(scene);
                        if (!guard->frameMesh(key)) {
                            status->setText("The requested mesh was not returned.");
                            return;
                        }
                        if (!camera.isEmpty())
                            guard->setCameraState(camera);
                        const auto record = guard->selectedMeshReport();
                        status->setText(QString("%1 · UV%2 · %3\n%4")
                                            .arg(key)
                                            .arg(record.value("uvInfo").toObject().value("channel").toInt())
                                            .arg(record.value("textureStatus").toString("No decoded texture"),
                                                 record.value("textureFallbackReason").toString()));
                    });
            });
    dialog->show();
}

void EditorWindow::log(const QString &text) {
    log_->appendPlainText(QDateTime::currentDateTime().toString("HH:mm:ss ") + text);
}

bool EditorWindow::canDiscard() {
    return edits_.isEmpty() || QMessageBox::question(this, "Pending edits", "Discard the pending edits?",
                                                     QMessageBox::Discard | QMessageBox::Cancel,
                                                     QMessageBox::Cancel) == QMessageBox::Discard;
}

void EditorWindow::closeEvent(QCloseEvent *event) {
    if (busy_) {
        QMessageBox::information(this, "Operation running",
                                 "Wait for the current operation to finish before closing.");
        event->ignore();
        return;
    }
    if (!closingEditor_ && !canDiscard()) {
        event->ignore();
        return;
    }
    if (portal_ && portal_->controllerRunning()) {
        event->ignore();
        if (!closingEditor_) {
            closingEditor_ = true;
            setEnabled(false);
            portal_->requestShutdown([this] { QTimer::singleShot(0, this, [this] { close(); }); });
        }
        return;
    }
    event->accept();
}

void EditorWindow::setBusy(bool busy) {
    busy_ = busy;
    open_->setEnabled(!busy);
    const bool loaded = !busy && !path_.isEmpty();
    geometry_->setEnabled(loaded && !authoredScene_);
    collisionToggle_->setEnabled(loaded && preview_->collisionBoxCount() > 0);
    types_->setEnabled(loaded);
    query_->setEnabled(loaded);
    filter_->setEnabled(loaded);
    previous_->setEnabled(loaded && offset_ > 0);
    next_->setEnabled(loaded && nextOffset_ >= 0);
    build_->setEnabled(loaded && !edits_.isEmpty());
    clear_->setEnabled(loaded && !edits_.isEmpty());
    table_->setEnabled(!busy);
    preview_->setEnabled(!busy);
    updateSelection();
    statusBar()->showMessage(busy ? "Working…" : "Ready");
}

void EditorWindow::openPath(const QString &path, const QString &geometryPath) {
    if (busy_ || !canDiscard())
        return;
    setBusy(true);
    const QString absolute = QFileInfo(path).absoluteFilePath();
    log("Inspecting " + absolute);
    callBackendAsync(
        this, config_, {{"operation", "inspect"}, {"path", absolute}},
        [this, absolute, geometryPath](BackendResult result) {
            if (!result.diagnostics.isEmpty())
                log(result.diagnostics);
            if (!result.ok()) {
                setBusy(false);
                log("Error: " + result.error);
                return;
            }
            path_ = absolute;
            authoredScene_ = result.value.value("authoredPreview").toBool();
            geometryPath_ = geometryPath.isEmpty() ? QString{} : QFileInfo(geometryPath).absoluteFilePath();
            selectedObject_ = {};
            sceneObjects_.clear();
            collisions_.clear();
            collisionState_ = "Collision inspection pending.";
            collisionSummary_->setText(collisionState_);
            preview_->setScene({});
            sourceSha256_ = result.value.value("sha256").toString();
            for (const auto &limitation : result.value.value("limitations").toArray())
                if (limitation.isString())
                    log(limitation.toString());
            edits_.clear();
            updatePending();
            types_->clear();
            types_->addItem("All types", "");
            for (const auto &entry : result.value.value("types").toArray()) {
                const auto type = entry.toObject();
                const auto name = type.value("name").toString();
                types_->addItem(QString("%1 (%2)").arg(name).arg(type.value("count").toInteger()), name);
            }
            query_->clear();
            const auto platform = result.value.value("platform");
            const QString platformName =
                platform.isString() ? platform.toString() : QString::number(platform.toInteger());
            summary_->setText(QString("%1\nIGZ %2 · platform %3 · %4 objects · %5 editable\nSHA-256: %6")
                                  .arg(path_)
                                  .arg(result.value.value("version").toInteger())
                                  .arg(platformName)
                                  .arg(result.value.value("objectCount").toInteger())
                                  .arg(result.value.value("editableObjectCount").toInteger())
                                  .arg(result.value.value("sha256").toString()));
            if (authoredScene_)
                summary_->setText(QString("%1\nAuthored scene · editor preview, not a playable game "
                                          "chapter\n%2 objects · %3 editable\nSHA-256: %4")
                                      .arg(path_)
                                      .arg(result.value.value("objectCount").toInteger())
                                      .arg(result.value.value("editableObjectCount").toInteger())
                                      .arg(sourceSha256_));
            setWindowTitle("Skylanders Level Editor · " + QFileInfo(path_).fileName());
            setBusy(false);
            loadScene(true);
        });
}

void EditorWindow::loadScene(bool reloadObjects) {
    if (busy_ || path_.isEmpty())
        return;
    setBusy(true);
    QJsonObject request{
        {"operation", "scene"},    {"path", path_},           {"expectedSha256", sourceSha256_},
        {"includeGeometry", true}, {"includeTextures", true}, {"texturePreviewSize", 256}};
    if (!geometryPath_.isEmpty())
        request.insert("geometryPath", geometryPath_);
    log("Loading 3D actors and decoded map triangles…");
    callBackendAsync(this, config_, request, [this, reloadObjects](BackendResult result) {
        if (!result.ok()) {
            log("Scene error: " + result.error);
            setBusy(false);
            loadCollisions(reloadObjects);
            return;
        }
        if (!result.diagnostics.isEmpty())
            log(result.diagnostics);
        sceneObjects_.clear();
        if (result.value.value("geometryPath").isString())
            log("Geometry: " + result.value.value("geometryPath").toString());
        for (const auto &value : result.value.value("objects").toArray()) {
            const auto object = value.toObject();
            sceneObjects_.insert(object.value("id").toInteger(), object);
        }
        preview_->setScene(result.value);
        skyToggle_->setChecked(preview_->cameraState().value("skyVisible").toBool());
        preview_->setEdits(edits_);
        for (const auto &warning : result.value.value("warnings").toArray())
            if (warning.isString())
                log(warning.toString());
        log(QString("3D scene: %1 world-positioned actors, %2 render meshes; viewport independent of table "
                    "pages.")
                .arg(preview_->objectCount())
                .arg(preview_->meshCount()));
        const int unresolved = sceneObjects_.size() - preview_->objectCount();
        if (unresolved)
            log(QString("%1 actors have unresolved parent/world transforms; available in the object list, "
                        "not placed speculatively in world space.")
                    .arg(unresolved));
        setBusy(false);
        loadCollisions(reloadObjects);
    });
}

void EditorWindow::loadCollisions(bool reloadObjects) {
    if (busy_ || path_.isEmpty())
        return;
    if (authoredScene_) {
        collisions_.clear();
        preview_->setCollisions({});
        collisionState_ = "Authored preview: native game collision has not been built.";
        collisionSummary_->setText(collisionState_);
        collisionSummary_->setToolTip(collisionState_);
        if (reloadObjects)
            loadPage(0);
        return;
    }
    setBusy(true);
    collisions_.clear();
    collisionState_ = "Inspecting verified actor collision fields…";
    collisionSummary_->setText(collisionState_);
    callBackendAsync(
        this, collisionBackend(config_),
        {{"operation", "inspect"}, {"path", path_}, {"expectedSourceHash", sourceSha256_}},
        [this, reloadObjects](BackendResult result) {
            if (!result.diagnostics.isEmpty())
                log(result.diagnostics);
            if (result.ok() && result.value.value("sha256").toString() != sourceSha256_)
                result.error = "Collision response SHA-256 does not match the opened level.";
            if (!result.ok()) {
                preview_->setCollisions({});
                collisionState_ = "Collision inspection unavailable: " + result.error;
                collisionSummary_->setText("Collision unavailable; see log.");
                collisionSummary_->setToolTip(collisionState_);
                log(collisionState_);
            } else {
                const auto actors = result.value.value("actors").toArray();
                for (const auto &entry : actors) {
                    const auto actor = entry.toObject();
                    if (actor.value("actorId").isDouble())
                        collisions_.insert(actor.value("actorId").toInteger(), actor);
                }
                preview_->setCollisions(actors);
                collisionState_.clear();
                collisionSummary_->setText(QString("%1 eligible boxes / %2 inspected actors · no static "
                                                   "Havok · initial nominal bounds, not runtime state")
                                               .arg(preview_->collisionBoxCount())
                                               .arg(collisions_.size()));
                collisionSummary_->setToolTip(
                    "This overlay does not establish player grounding or gameplay safety. Factory bevel "
                    "radius is not drawn; scripts may move, change or disable collisions.");
                log(QString("Read-only collision inspection: %1 eligible actor boxes. No complete "
                            "collision-world coverage or runtime validation implied.")
                        .arg(preview_->collisionBoxCount()));
            }
            setBusy(false);
            if (reloadObjects)
                loadPage(0);
        });
}

void EditorWindow::selectObject(qint64 id) {
    auto object = sceneObjects_.value(id);
    for (const auto &value : rows_)
        if (value.toObject().value("id").toInteger() == id && object.isEmpty())
            object = value.toObject();
    if (object.isEmpty())
        return;
    selectedObject_ = object;
    const QSignalBlocker blocker(table_);
    table_->clearSelection();
    for (int row = 0; row < rows_.size(); ++row)
        if (rows_[row].toObject().value("id").toInteger() == id) {
            table_->selectRow(row);
            table_->scrollToItem(table_->item(row, 0));
            break;
        }
    updateSelection();
}

void EditorWindow::loadPage(int offset) {
    if (busy_ || path_.isEmpty() || offset < 0)
        return;
    setBusy(true);
    QJsonObject request{{"operation", "objects"},
                        {"path", path_},
                        {"expectedSha256", sourceSha256_},
                        {"offset", offset},
                        {"limit", 200}};
    if (!types_->currentData().toString().isEmpty())
        request.insert("type", types_->currentData().toString());
    if (!query_->text().isEmpty())
        request.insert("query", query_->text());
    callBackendAsync(this, config_, request, [this, offset](BackendResult result) {
        if (!result.diagnostics.isEmpty())
            log(result.diagnostics);
        if (!result.ok()) {
            setBusy(false);
            log("Error: " + result.error);
            return;
        }
        offset_ = offset;
        rows_ = result.value.value("objects").toArray();
        const auto next = result.value.value("nextOffset");
        nextOffset_ = next.isDouble() ? next.toInt(-1) : -1;
        const QSignalBlocker blocker(table_);
        table_->clearSelection();
        table_->setRowCount(rows_.size());
        for (int row = 0; row < rows_.size(); ++row) {
            const auto object = rows_.at(row).toObject();
            const auto id = object.value("id").toInteger();
            const auto position = edits_.contains(id) ? edits_.value(id) : object.value("position").toArray();
            QStringList values{QString::number(id), object.value("type").toString(),
                               object.value("name").toString()};
            for (int axis = 0; axis < 3; ++axis)
                values << (position.size() == 3 ? QString::number(position.at(axis).toDouble(), 'g', 10)
                                                : QStringLiteral("—"));
            values << QString("0x%1").arg(object.value("offset").toInteger(), 0, 16);
            for (int col = 0; col < values.size(); ++col) {
                auto *item = new QTableWidgetItem(values.at(col));
                if (edits_.contains(id)) {
                    auto font = item->font();
                    font.setBold(true);
                    item->setFont(font);
                    item->setToolTip("Pending position edit");
                }
                table_->setItem(row, col, item);
            }
        }
        page_->setText(QString("%1–%2 of %3 matches")
                           .arg(rows_.isEmpty() ? 0 : offset_ + 1)
                           .arg(offset_ + rows_.size())
                           .arg(result.value.value("total").toInteger()));
        setBusy(false);
    });
}

void EditorWindow::selectionChanged() {
    const int row = table_->currentRow();
    const bool selected = row >= 0 && row < rows_.size() && table_->selectedItems().size() > 0;
    if (selected)
        selectedObject_ = rows_.at(row).toObject();
    updateSelection();
}

void EditorWindow::updateSelection() {
    const auto object = selectedObject_;
    const bool selected = !object.isEmpty();
    const auto id = object.value("id").toInteger();
    const auto position = edits_.contains(id) ? edits_.value(id) : object.value("position").toArray();
    const bool editable = selected && object.value("editable").toBool() && position.size() == 3;
    for (int axis = 0; axis < 3; ++axis) {
        coordinates_[axis]->setEnabled(!busy_ && editable);
        const QSignalBlocker blocker(coordinates_[axis]);
        if (editable)
            coordinates_[axis]->setValue(position.at(axis).toDouble());
        coordinateChanged_[axis] = false;
    }
    apply_->setEnabled(!busy_ && editable);
    undo_->setEnabled(!busy_ && selected && edits_.contains(id));
    preview_->setSelected(selected ? id : -1);
    selection_->setText(
        !selected
            ? "Select an object to view its position."
            : QString("Object %1 · %2\n%3\n%4")
                  .arg(id)
                  .arg(object.value("type").toString(), object.value("name").toString(),
                       editable
                           ? (sceneObjects_.value(id).value("worldEditable").toBool()
                                  ? "Verified root position. Drag the XYZ arrows or edit coordinates below."
                                  : "Local initial position; world/parent transform unresolved. No 3D move "
                                    "gizmo.")
                           : "No verified position fields; read-only."));
    const auto spatial = sceneObjects_.value(id);
    if (selected && spatial.value("representation").isString())
        selection_->setText(selection_->text() + "\n" + spatial.value("representation").toString());
    if (selected) {
        const auto representation = preview_->actorRepresentation(id);
        if (representation.value("placeholder").toBool())
            selection_->setText(selection_->text() + "\nEditor " + representation.value("kind").toString() +
                                " placeholder · fixed world size\n" +
                                spatial.value("proxyReason").toString());
    }
    selection_->setToolTip(spatial.value("proxyReason").toString());
    const auto collision = collisions_.value(id);
    if (!collisionState_.isEmpty())
        collisionInspector_->setText(collisionState_);
    else if (!selected)
        collisionInspector_->setText("Select an actor to inspect its collision.");
    else if (collision.isEmpty())
        collisionInspector_->setText(
            "No collision inspection record for this object. No collision is inferred from render geometry.");
    else if (!collision.value("editable").toBool()) {
        QStringList reasons;
        for (const auto &reason : collision.value("reasons").toArray())
            if (reason.isString())
                reasons.append(reason.toString());
        collisionInspector_->setText(
            "Not included in the verified box overlay.\n" + reasons.mid(0, 2).join("\n") +
            (reasons.size() > 2 ? QString("\n+ %1 further reason(s); hover for all.").arg(reasons.size() - 2)
                                : QString{}));
        collisionInspector_->setToolTip(reasons.join("\n"));
    } else {
        const auto format = [](const QJsonArray &values) {
            QStringList parts;
            for (const auto &value : values)
                parts.append(QString::number(value.toDouble(), 'g', 7));
            return parts.join(", ");
        };
        const auto initial = edits_.contains(id) ? edits_.value(id) : collision.value("position").toArray();
        collisionInspector_->setText(
            QString("Eligible nominal BOX #%1\nW / H / L (m): %2\nLocal offset (m): %3\nActor base (m): "
                    "%4\nActor yaw: %5°\n%6\nRead-only; scripts and bevels are not shown.")
                .arg(collision.value("collisionId").toInteger())
                .arg(format(collision.value("dimensionsWorld").toArray()),
                     format(collision.value("offsetWorld").toArray()), format(initial))
                .arg(collision.value("rotationDegrees").toArray().at(1).toDouble())
                .arg(edits_.contains(id) ? "Preview follows pending position."
                                         : "Y extends upward from the local base."));
        collisionInspector_->setToolTip(
            "Dimensions already converted from stored feet to world meters. Offset is rotated by the "
            "verified actor yaw, then translated. Structural eligibility is not gameplay safety. "
            "Dimensions/offset edits are not available in this GUI.");
    }
}

void EditorWindow::refreshEditedObjects() {
    for (int row = 0; row < rows_.size(); ++row) {
        const auto object = rows_[row].toObject();
        const auto id = object.value("id").toInteger();
        const auto position = edits_.contains(id) ? edits_[id] : object.value("position").toArray();
        for (int axis = 0; axis < 3; ++axis)
            if (table_->item(row, axis + 3))
                table_->item(row, axis + 3)
                    ->setText(position.size() == 3 ? QString::number(position[axis].toDouble(), 'g', 10)
                                                   : QStringLiteral("—"));
        for (int column = 0; column < table_->columnCount(); ++column)
            if (auto *item = table_->item(row, column)) {
                auto font = item->font();
                font.setBold(edits_.contains(id));
                item->setFont(font);
            }
    }
    preview_->setEdits(edits_);
}

void EditorWindow::updatePending() {
    pending_->setText(QString("%1 pending object edit(s)").arg(edits_.size()));
    build_->setEnabled(!busy_ && !path_.isEmpty() && !edits_.isEmpty());
    clear_->setEnabled(!busy_ && !edits_.isEmpty());
}

void EditorWindow::stagePosition() {
    if (busy_ || selectedObject_.isEmpty())
        return;
    const auto object = selectedObject_;
    if (!object.value("editable").toBool() || object.value("position").toArray().size() != 3)
        return;
    const auto id = object.value("id").toInteger();
    QJsonArray position = edits_.contains(id) ? edits_.value(id) : object.value("position").toArray();
    // Preserve untouched floats exactly: the spinbox's displayed precision must
    // not round the other axes when a user changes just one coordinate.
    for (int axis = 0; axis < 3; ++axis)
        if (coordinateChanged_[axis])
            position[axis] = coordinates_[axis]->value();
    if (position == object.value("position").toArray())
        edits_.remove(id);
    else
        edits_.insert(id, position);
    log(QString("Staged position for object %1: %2, %3, %4")
            .arg(id)
            .arg(position[0].toDouble())
            .arg(position[1].toDouble())
            .arg(position[2].toDouble()));
    updatePending();
    refreshEditedObjects();
    updateSelection();
}

void EditorWindow::buildCopy() {
    if (busy_ || edits_.isEmpty())
        return;
    const auto source = QFileInfo(path_);
    const auto output = QFileDialog::getSaveFileName(
        this, authoredScene_ ? "Save a new authored preview" : "Build a new level file",
        source.absolutePath() + (authoredScene_ ? "/demo.edited.scene.json" : "/level.edited.bld"),
        authoredScene_ ? "Authored preview (*.scene.json)" : "Level payload (*.bld);;All files (*)", nullptr,
        QFileDialog::DontConfirmOverwrite);
    if (output.isEmpty())
        return;
    if (QFileInfo::exists(output)) {
        QMessageBox::warning(this, "Choose a new file", "The output already exists. Choose a new filename.");
        return;
    }
    QJsonArray edits;
    for (auto it = edits_.begin(); it != edits_.end(); ++it)
        edits.append(QJsonObject{{"objectId", it.key()}, {"position", it.value()}});
    setBusy(true);
    log("Building " + output);
    callBackendAsync(
        this, config_,
        {{"operation", "build"},
         {"path", path_},
         {"expectedSha256", sourceSha256_},
         {"output", output},
         {"edits", edits}},
        [this](BackendResult result) {
            setBusy(false);
            if (!result.diagnostics.isEmpty())
                log(result.diagnostics);
            if (!result.ok()) {
                log("Error: " + result.error);
                return;
            }
            log("Built: " + result.value.value("output").toString());
            const auto manifest = result.value.value("manifest");
            log("Manifest: " +
                (manifest.isString() ? manifest.toString() : QStringLiteral("returned by backend")));
            log(authoredScene_ ? "Authored scene copy saved. This JSON is an editor preview, not an "
                                 "installable game level."
                               : "Build complete. Repack the payload using the documented workflow and test "
                                 "in a separate game copy.");
            statusBar()->showMessage("Build complete; pending edits retained for additional exports.");
        });
}
