#pragma once

#include "backend.h"
#include <QJsonArray>
#include <QMainWindow>
#include <QMap>
#include <QPointer>

class QComboBox;
class QCheckBox;
class QDoubleSpinBox;
class QLabel;
class QLineEdit;
class QPlainTextEdit;
class QPushButton;
class QTableWidget;
class QCloseEvent;
class SceneView;
class PortalDialog;

class EditorWindow : public QMainWindow {
  public:
    explicit EditorWindow(BackendConfig config);
    void openPath(const QString &path, const QString &geometryPath = {});

  protected:
    void closeEvent(QCloseEvent *event) override;

  private:
    BackendConfig config_;
    QString path_;
    QString sourceSha256_;
    QString geometryPath_;
    QJsonArray rows_;
    QMap<qint64, QJsonObject> sceneObjects_;
    QMap<qint64, QJsonObject> collisions_;
    QString collisionState_ = "Collision data has not been inspected.";
    QJsonObject selectedObject_;
    QMap<qint64, QJsonArray> edits_;
    int offset_ = 0;
    int nextOffset_ = -1;
    bool busy_ = false;
    bool authoredScene_ = false;
    bool closingEditor_ = false;
    QPointer<PortalDialog> portal_;
    QLineEdit *query_;
    QComboBox *types_;
    QTableWidget *table_;
    SceneView *preview_;
    QDoubleSpinBox *coordinates_[3];
    bool coordinateChanged_[3] = {false, false, false};
    QLabel *summary_;
    QLabel *page_;
    QLabel *pending_;
    QLabel *selection_;
    QLabel *collisionInspector_;
    QLabel *collisionSummary_;
    QCheckBox *collisionToggle_;
    QCheckBox *skyToggle_;
    QPlainTextEdit *log_;
    QPushButton *open_;
    QPushButton *geometry_;
    QPushButton *filter_;
    QPushButton *previous_;
    QPushButton *next_;
    QPushButton *apply_;
    QPushButton *undo_;
    QPushButton *clear_;
    QPushButton *build_;

    void setBusy(bool busy);
    void log(const QString &text);
    void loadPage(int offset);
    void loadScene(bool reloadObjects);
    void loadCollisions(bool reloadObjects);
    void selectObject(qint64 id);
    void selectionChanged();
    void updateSelection();
    void refreshEditedObjects();
    void updatePending();
    void stagePosition();
    void openMaterialPreview(const QJsonObject &source, const QJsonObject &record);
    QWidget *createLightingPanel();
    void buildCopy();
    bool canDiscard();
};
