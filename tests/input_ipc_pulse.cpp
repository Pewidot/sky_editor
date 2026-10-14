// Standalone SDL event/timer test: no emulator or game is started.
#include "input/ipc_input.h"
#include <cassert>
#include <iostream>
#include <vector>

int main() {
    using namespace InputIPC;
    std::string error;
    const auto early = Parse("1", "button", "cross", "20", error);
    assert(early && !Queue(*early));
    assert(SDL_Init(SDL_INIT_EVENTS));
    assert(EventType() > SDL_EVENT_USER + 15);
    assert(!Parse("0", "button", "cross", "100", error));
    assert(!Parse("2147483648", "button", "cross", "100", error));
    assert(!Parse("1", "button", "cross", "2001", error));
    assert(!Parse("1", "button", "cross", "0", error));
    assert(!Parse("1", "button", "cross", "25junk", error));
    assert(!Parse("1", "button", "not_a_button", "100", error));
    assert(!Parse("1", "key", "not_a_key", "100", error));
    assert(!Parse("1", "unknown", "cross", "100", error));
    for (const auto name : {"enter", "space", "escape", "w", "a", "s", "d", "f12"})
        assert(Parse("1", "key", name, "100", error));
    const auto key = Parse("3", "key", "enter", "30", error);
    const auto screenshot = Parse("5", "key", "f12", "30", error);
    assert(screenshot && screenshot->code == SDLK_F12);
    const auto axis = Parse("4", "axis", "left_y_minus", "30", error);
    assert(key && key->code == SDLK_RETURN);
    assert(axis && axis->code == SDL_GAMEPAD_AXIS_LEFTY && axis->value == -127);
    Manager manager;
    struct Action {
        Pulse pulse;
        bool down;
        Uint64 at;
    };
    std::vector<Action> actions;
    std::vector<std::pair<int, std::string>> acknowledgments;
    auto apply = [&](const Pulse &pulse, bool down) { actions.push_back({pulse, down, SDL_GetTicks()}); };
    auto ack = [&](int id, std::string_view state) { acknowledgments.emplace_back(id, state); };
    auto process = [&] {
        SDL_Event event{};
        assert(SDL_WaitEventTimeout(&event, 1000));
        assert(manager.Process(event, apply, ack));
    };
    assert(Queue(*early));
    process();
    process();
    assert(actions.size() == 2 && actions[0].down && !actions[1].down);
    assert(actions[1].at - actions[0].at >= 15);
    assert(acknowledgments[0].second == "pressed" && acknowledgments[1].second == "released");
    assert(Queue(*early));
    process(); // IDs cannot be replayed after release.
    assert(actions.size() == 2 && acknowledgments.back().second == "error_duplicate_id_or_busy");
    auto held = *Parse("2", "button", "cross", "1000", error);
    auto duplicate = *Parse("3", "button", "cross", "1000", error);
    assert(Queue(held));
    process();
    assert(Queue(duplicate));
    process();
    assert(acknowledgments.back().second == "error_input_already_held");
    manager.ReleaseAll(apply, ack);
    assert(!actions.back().down && acknowledgments.back().second == "cancelled_released");
    assert(Queue(*key));
    process();
    assert(Queue(*axis));
    process();
    SDL_Event stale{};
    stale.type = EventType() + 1;
    stale.user.code = 2;
    const auto count = actions.size();
    assert(manager.Process(stale, apply, ack));
    assert(actions.size() == count);
    process();
    process();
    bool keyReleased = false, axisReleased = false;
    for (const auto &action : actions) {
        if (!action.down && action.pulse.id == key->id)
            keyReleased = true;
        if (!action.down && action.pulse.id == axis->id)
            axisReleased = true;
    }
    assert(keyReleased && axisReleased);
    const auto first = actions.size();
    for (unsigned i = 0; i < 16; ++i) {
        const auto pulse = Parse(std::to_string(10 + i), "key", std::string(1, char('a' + i)), "2000", error);
        assert(pulse && Queue(*pulse));
        process();
    }
    const auto overflow = Parse("26", "key", "z", "2000", error);
    assert(overflow && Queue(*overflow));
    process();
    assert(actions.size() == first + 16);
    assert(acknowledgments.back().second == "error_duplicate_id_or_busy");
    manager.ReleaseAll(apply, ack);
    assert(actions.size() == first + 32);
    SDL_Quit();
    std::cout << "Input IPC parser, timed main-thread releases, duplicate rejection, "
                 "cancellation, stale timers and 16-pulse bound passed.\n";
}
