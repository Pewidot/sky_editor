#include "previewlaunch.h"

#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QRegularExpression>
#include <QSet>
#include <QSettings>
#include <QStandardPaths>
#include <QTimer>
#include <QToolButton>
#include <QVBoxLayout>
#include <cmath>

namespace {
constexpr auto settingsOrganization = "SkylandersReverseEngineering";
constexpr auto settingsApplication = "LevelWorkshop";
constexpr auto settingsKey = "preview/profilePath";
bool digest(const QString &value) {
    static const QRegularExpression pattern("^[a-f0-9]{64}$");
    return pattern.match(value).hasMatch();
}
bool absolutePath(const QJsonValue &value) {
    return value.isString() && !value.toString().isEmpty() && QDir::isAbsolutePath(value.toString()) &&
           !value.toString().contains(QChar::Null);
}
QJsonObject matchingMap(const PreviewProfile &profile, const QString &sourceSha256) {
    for (const auto &entry : profile.document.value("maps").toArray())
        if (entry.toObject().value("sourceSha256").toString() == sourceSha256)
            return entry.toObject();
    return {};
}
QString displayProfile(const PreviewProfile &profile) {
    if (!profile.ok())
        return profile.error;
    const auto &doc = profile.document;
    QStringList maps;
    for (const auto &entry : doc.value("maps").toArray()) {
        const auto map = entry.toObject();
        maps << QString("%1 · %2").arg(map.value("label").toString(map.value("loadString").toString()),
                                       map.value("loadString").toString());
    }
    return QString("shadPS4: %1\nGame: %2\nCheckpoint: %3\nOutput: %4\n\nMaps:\n%5")
        .arg(doc.value("emulator").toString(), doc.value("gameRoot").toString(),
             doc.value("checkpoint").toString(), doc.value("outputRoot").toString(), maps.join('\n'));
}
} // namespace

QString previewProfilePath() {
    QSettings settings(QSettings::IniFormat, QSettings::UserScope, settingsOrganization, settingsApplication);
    const auto saved = settings.value(settingsKey).toString();
    // Never silently substitute another profile if the selected one disappears.
    if (!saved.isEmpty())
        return saved;
    const auto candidate = QDir(QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation))
                               .filePath("skylanders-level-editor/preview-profile.json");
    return QFileInfo::exists(candidate) ? candidate : QString{};
}

PreviewProfile readPreviewProfile(const QString &path) {
    PreviewProfile result;
    const QFileInfo info(path);
    if (path.isEmpty() || !info.isFile() || info.isSymLink() || !info.isReadable() || info.size() <= 0 ||
        info.size() > 1024 * 1024) {
        result.error = "Choose a readable prepared preview profile (.json, at most 1 MiB; no symlink).";
        return result;
    }
    result.path = info.canonicalFilePath();
    QFile file(result.path);
    if (!file.open(QIODevice::ReadOnly)) {
        result.error = "Cannot read preview profile: " + file.errorString();
        return result;
    }
    const auto bytes = file.read(1024 * 1024 + 1);
    if (bytes.size() > 1024 * 1024 || !file.atEnd()) {
        result.error = "Preview profile grew beyond its size limit.";
        return result;
    }
    QJsonParseError error;
    const auto json = QJsonDocument::fromJson(bytes, &error);
    if (error.error != QJsonParseError::NoError || !json.isObject()) {
        result.error = "Invalid preview profile JSON: " + error.errorString();
        return result;
    }
    result.document = json.object();
    const auto &doc = result.document;
    if (doc.value("schema").toString() != "skylanders-game-preview-v1") {
        result.error =
            "Unsupported preview profile schema. Select a prepared skylanders-game-preview-v1 profile.";
        return result;
    }
    for (const auto *field : {"emulator", "gameRoot", "checkpoint", "outputRoot"})
        if (!absolutePath(doc.value(field))) {
            result.error = QString("Preview profile requires an absolute %1 path.").arg(field);
            return result;
        }
    for (const auto *field : {"emulatorSha256", "gameExecutableSha256"})
        if (!digest(doc.value(field).toString())) {
            result.error = QString("Preview profile has no valid %1 pin.").arg(field);
            return result;
        }
    if (!doc.value("gamePins").isObject()) {
        result.error = "Preview profile is missing prepared game pins.";
        return result;
    }
    if (!doc.value("assetRoots").isArray() || doc.value("assetRoots").toArray().size() > 16) {
        result.error = "Preview profile requires explicit linked asset roots.";
        return result;
    }
    for (const auto &root : doc.value("assetRoots").toArray())
        if (!absolutePath(root)) {
            result.error = "Preview asset roots must be absolute paths.";
            return result;
        }
    const auto maps = doc.value("maps").toArray();
    if ((maps.isEmpty() && !doc.value("onDemand").isObject()) || maps.size() > 64) {
        result.error = "Preview profile needs configured maps or on-demand recipes.";
        return result;
    }
    QSet<QString> seen;
    for (const auto &entry : maps) {
        const auto map = entry.toObject();
        const auto source = map.value("sourceSha256").toString();
        if (!digest(source) || seen.contains(source) ||
            map.value("loadString").toString().trimmed().isEmpty()) {
            result.error =
                "Preview map identities must have unique SHA-256 pins and an explicit load string.";
            return result;
        }
        seen.insert(source);
    }
    return result;
}

bool storePreviewProfilePath(const QString &path, QString *error) {
    const auto profile = readPreviewProfile(path);
    if (!profile.ok()) {
        if (error)
            *error = profile.error;
        return false;
    }
    QSettings settings(QSettings::IniFormat, QSettings::UserScope, settingsOrganization, settingsApplication);
    settings.setValue(settingsKey, profile.path);
    settings.sync();
    if (settings.status() != QSettings::NoError) {
        if (error)
            *error = "Could not save preview settings.";
        return false;
    }
    if (error)
        error->clear();
    return true;
}

BackendResult previewLaunchRequest(const PreviewProfile &profile, const QString &levelPath,
                                   const QString &sourceSha256, const QMap<qint64, QJsonArray> &edits,
                                   const QMap<qint64, QJsonObject> &transforms) {
    if (!profile.ok() || profile.path.isEmpty())
        return {{}, profile.error.isEmpty() ? "No preview profile selected." : profile.error, {}};
    const QFileInfo level(levelPath);
    if (!level.isFile() || !level.isReadable() || !digest(sourceSha256))
        return {{}, "The current level must be a readable file with its inspected SHA-256.", {}};
    if (matchingMap(profile, sourceSha256).isEmpty() && !profile.document.value("onDemand").isObject())
        return {{},
                "This preview profile has no route for the current level SHA-256. No map was prepared or "
                "launched. Choose a matching prepared profile.",
                {}};
    if (edits.size() > 10000)
        return {{}, "Too many pending preview edits.", {}};
    QJsonArray serialized;
    for (auto it = edits.cbegin(); it != edits.cend(); ++it) {
        bool valid = it.key() >= 0 && it.key() <= 9007199254740991LL && it.value().size() == 3;
        for (const auto &coordinate : it.value())
            valid = valid && coordinate.isDouble() && std::isfinite(coordinate.toDouble()) &&
                    std::abs(coordinate.toDouble()) <= 1e6;
        if (!valid)
            return {{}, "Pending preview edits require valid object IDs and three finite coordinates.", {}};
        auto e = transforms.value(it.key());
        e["id"] = it.key();
        e["position"] = it.value();
        serialized.append(e);
    }
    return {{{"profilePath", profile.path},
             {"levelPath", level.canonicalFilePath()},
             {"expectedSha256", sourceSha256},
             {"edits", serialized}},
            {},
            {}};
}

BackendResult validatePreviewLaunchReply(BackendResult result, const PreviewProfile &profile,
                                         const QJsonObject &request) {
    if (!result.ok())
        return result;
    const auto &reply = result.value;
    const auto map = matchingMap(profile, request.value("expectedSha256").toString());
    const auto preparedMap = reply.value("map").toObject();
    const bool dynamic = map.isEmpty() && profile.document.value("onDemand").isObject() &&
                         preparedMap.value("onDemand").toBool() &&
                         QRegularExpression("^Level_[A-Za-z0-9_]{1,80}$")
                             .match(preparedMap.value("loadString").toString())
                             .hasMatch() &&
                         preparedMap.value("archivePath").toString() ==
                             "level/" + preparedMap.value("loadString").toString().toLower() + ".bld" &&
                         preparedMap.value("resident").isObject();
    if (reply.value("schema").toString() != "skylanders-prepared-preview-v1" || (map.isEmpty() && !dynamic) ||
        reply.value("profilePath").toString() != profile.path ||
        reply.value("emulatorStarted") != QJsonValue(false) ||
        reply.value("sourceGameUnchanged") != QJsonValue(true) ||
        reply.value("sourceSha256") != request.value("expectedSha256") ||
        reply.value("levelPath") != request.value("levelPath") || !reply.value("editCount").isDouble() ||
        reply.value("editCount").toDouble() != request.value("edits").toArray().size() ||
        reply.value("map").toObject().value("sourceSha256") != request.value("expectedSha256") ||
        (!dynamic && preparedMap.value("loadString") != map.value("loadString"))) {
        result.error =
            "Prepared preview does not match the current level, edits, or map route. Nothing was launched.";
        return result;
    }
    for (const auto *field : {"emulator", "game", "session", "resumeFrom"})
        if (!absolutePath(reply.value(field))) {
            result.error = QString("Prepared preview has no valid %1 path. Nothing was launched.").arg(field);
            return result;
        }
    if (reply.value("emulator") != profile.document.value("emulator") ||
        reply.value("x11") != QJsonValue(true)) {
        result.error =
            "Prepared preview changed the configured emulator or display policy. Nothing was launched.";
    }
    return result;
}

void preparePreviewLaunchAsync(QObject *owner, const BackendConfig &config, const PreviewProfile &profile,
                               const QString &levelPath, const QString &sourceSha256,
                               const QMap<qint64, QJsonArray> &edits,
                               std::function<void(BackendResult)> finished,
                               const QMap<qint64, QJsonObject> &transforms,
                               std::function<void(QString)> progress) {
    const auto request = previewLaunchRequest(profile, levelPath, sourceSha256, edits, transforms);
    if (!request.ok()) {
        QTimer::singleShot(0, owner, [finished, request] { finished(request); });
        return;
    }
    const BackendConfig backend{config.node,
                                QFileInfo(config.script).absoluteDir().filePath("prepare_game_preview.mjs")};
    callBackendAsync(
        owner, backend, request.value,
        [profile, request, finished](BackendResult result) {
            finished(validatePreviewLaunchReply(std::move(result), profile, request.value));
        },
        progress);
}

PreviewSettingsPanel::PreviewSettingsPanel(const QString &initialPath, QWidget *parent) : QWidget(parent) {
    setObjectName("previewSettingsPanel");
    auto *layout = new QVBoxLayout(this);
    layout->addWidget(new QLabel("Preview profile"));
    auto *row = new QHBoxLayout;
    path_ = new QLineEdit(initialPath);
    path_->setObjectName("previewProfilePath");
    path_->setPlaceholderText("preview-profile.json");
    path_->setToolTip("Prepared shadPS4, game and checkpoint configuration. The selection is remembered.");
    auto *browse = new QPushButton("Browse…");
    browse->setObjectName("previewProfileBrowse");
    row->addWidget(path_, 1);
    row->addWidget(browse);
    layout->addLayout(row);
    summary_ = new QLabel;
    summary_->setObjectName("previewProfileSummary");
    summary_->setTextFormat(Qt::PlainText);
    summary_->setWordWrap(true);
    layout->addWidget(summary_);
    auto *detailsToggle = new QToolButton;
    detailsToggle->setObjectName("previewProfileDetailsToggle");
    detailsToggle->setText("Details");
    detailsToggle->setCheckable(true);
    detailsToggle->setArrowType(Qt::RightArrow);
    detailsToggle->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);
    layout->addWidget(detailsToggle);
    details_ = new QLabel;
    details_->setObjectName("previewProfileDetails");
    details_->setWordWrap(true);
    details_->setTextFormat(Qt::PlainText);
    details_->setTextInteractionFlags(Qt::TextSelectableByMouse);
    layout->addWidget(details_);
    details_->hide();
    connect(detailsToggle, &QToolButton::toggled, this, [this, detailsToggle](bool checked) {
        details_->setVisible(checked);
        detailsToggle->setArrowType(checked ? Qt::DownArrow : Qt::RightArrow);
    });
    auto *buttons = new QHBoxLayout;
    save_ = new QPushButton("Use profile");
    save_->setObjectName("previewProfileSave");
    auto *close = new QPushButton("Close");
    close->setObjectName("previewSettingsClose");
    buttons->addWidget(save_);
    buttons->addWidget(close);
    buttons->addStretch();
    layout->addLayout(buttons);
    layout->addStretch();
    connect(path_, &QLineEdit::textChanged, this, [this] { inspect(); });
    connect(browse, &QPushButton::clicked, this, [this] {
        const auto selected = QFileDialog::getOpenFileName(this, "Choose prepared preview profile",
                                                           path_->text(), "Preview profile (*.json)");
        if (!selected.isEmpty())
            path_->setText(selected);
    });
    connect(close, &QPushButton::clicked, this, [this] {
        if (onClose)
            onClose();
    });
    connect(save_, &QPushButton::clicked, this, [this] {
        QString error;
        if (!storePreviewProfilePath(path_->text(), &error)) {
            summary_->setText("Cannot save profile");
            summary_->setToolTip(error);
            return;
        }
        inspect();
        if (profile_.ok() && onSaved)
            onSaved(profile_.path);
    });
    inspect();
}

QString PreviewSettingsPanel::profilePath() const { return profile_.ok() ? profile_.path : QString{}; }
void PreviewSettingsPanel::setProfilePath(const QString &path) {
    path_->setText(path);
    inspect();
}
void PreviewSettingsPanel::inspect() {
    profile_ = readPreviewProfile(path_->text());
    path_->setToolTip(path_->text());
    details_->setText(displayProfile(profile_));
    save_->setEnabled(profile_.ok());
    if (!profile_.ok()) {
        summary_->setText(path_->text().isEmpty() ? "Choose a profile" : "Profile unavailable");
        summary_->setToolTip(profile_.error);
        return;
    }
    const auto maps = profile_.document.value("maps").toArray();
    const auto first = maps.isEmpty() ? QJsonObject{} : maps.first().toObject();
    summary_->setText(profile_.document.value("onDemand").isObject() ? "Build current map on demand"
                      : maps.size() == 1 ? first.value("label").toString(first.value("loadString").toString())
                                         : QString("%1 configured maps").arg(maps.size()));
    summary_->setToolTip({});
}
