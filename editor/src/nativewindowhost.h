#pragma once

#include <QWidget>
#include <memory>

// Hosts the existing SDL X11 surface; does not capture, copy or render frames.
// Only a unique window of the verified controller's direct child is accepted.
class NativeWindowHost : public QWidget {
  public:
    explicit NativeWindowHost(QWidget *parent = nullptr);
    ~NativeWindowHost() override;
    bool attachOwned(qint64 controllerPid, qint64 emulatorPid, const QString &emulator, QString &error);
    void detach();
    bool attached() const;
    quint32 hostedWindow() const;
    bool verifyOwned() const;
    static bool supported();

  protected:
    void resizeEvent(QResizeEvent *event) override;

  private:
    struct State;
    std::unique_ptr<State> state_;
    void fitWindow();
};
