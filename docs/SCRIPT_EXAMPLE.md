# Scripts, relays and enemies

The game stores scripts as objects in an IGZ: a placement points to a
`tfbScriptInfo`, which owns an ordered `OpCodeList`. Operands can reference
actors, sets, variables or another archive. The `.ai` names survived; original
script source did not. The JSON exporter reads this structure without running it.

## A custom script that runs: Sunbreak's relays

[native_sunbreak_mission.mjs](../tools/native_sunbreak_mission.mjs) builds two
relay controllers and a finish controller. Each relay starts inactive. Walking
within eight feet sets its state and completes its native objective. The finish
controller requires both states and the same proximity check before calling the
game's `LevelEnd` macro.

Readable pseudocode, **not an API you can paste into the editor**:

```python
west_active = False
east_active = False

# Each controller checks its condition while active.
if not west_active and distance_feet(player, west_relay) < 8:
    west_active = True
    complete_objective("west relay")
    remove_controller(west_relay)

if not east_active and distance_feet(player, east_relay) < 8:
    east_active = True
    complete_objective("east relay")
    remove_controller(east_relay)

if west_active and east_active and distance_feet(player, beacon) < 8:
    complete_objective("beacon")
    native_level_end(destination="Village")
    remove_controller(beacon)
```

The actual builder clones and binds `OpCheckValue`, `OpSetValue` and macro-call
objects, writes their branch distances, and registers both actors and scripts
in ROOT. Missing script registration caused an earlier build to hang at load.
The native results/save path was tested; this recipe has **no combat**.
[Build instructions and runtime notes](SUNBREAK.md#current-runnable-build).

## An original enemy controller

Soda Springs has `313_EnemySetupOP_01.ai`, script object **66176**, attached to
`Setup_001_OptionalController`. Its 49 rows include three behaviors: `wait`,
`trigger enemies` and `end`.

| Rows | What the stored graph shows |
| --- | --- |
| 19–20 | `trigger enemies` starts with a greater-than comparison. Success enters row 21; false or unresolved operands skip to 38. |
| 22–36 | A loop contains a call to `Enemy System - Setups - Set Queue`, with seven parameter rows. |
| 37 | `OpSetBehavior` references the controller's `end` behavior. |
| 40–44 | Call to `Combat - Check For Living Enemies`; `check set` points to `Setup_001_OptionalEnemies`. |
| 45–46 | Compare a returned set's count with zero using `LE_OP`. Success reaches `OpRemove`, targeting `Setup_001_Optional`. |

That is a static reading, not a recorded execution or a recovered, compilable
enemy script. The queue's external references and the living-enemy macro still
need their complete dependencies. `OpSpawn` can clone and activate a placement,
but a mesh alone is not an enemy: behavior, resources and collision must exist.

### Inspect it with your own files

Use the supported PS4 build from [setup](SETUP.md). `soda-inner.bld` below is
the extracted **inner** `level.bld` from `level/level_313_tutorial.bld`.
The output filename must be new.

```sh
node tools/script_graph.mjs \
  --source /path/to/soda-inner.bld \
  --expect-sha256 ffb0550f8f11d53e0db9aaa32bc977c887a5f5c0b8f1a139555859a4034b6cd3 \
  --elf /path/to/eboot.elf \
  --script-id 66176 --script-id 26794 \
  --output enemy-graph.json
```

Save this as `inspect-enemies.mjs`, then run `node inspect-enemies.mjs`:

```js
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const graph = JSON.parse(readFileSync("enemy-graph.json", "utf8"));
assert.equal(graph.schema, "skylanders-script-graph-v1");
assert.equal(graph.source.sha256,
  "ffb0550f8f11d53e0db9aaa32bc977c887a5f5c0b8f1a139555859a4034b6cd3");
const controller = graph.scripts.find(s => s.objectIndex === 66176);
assert.ok(controller, "Export script 66176 from the supported Soda Springs file");

console.table(controller.rows.filter(r => r.row >= 19).map(r => ({
  row: r.row,
  opcode: r.type,
  macro: r.references.find(ref => ref.target.type === "OpDefineMacro")?.target.name ?? "",
  branches: r.controlFlow.edges.map(e => `${e.condition} -> ${e.targetRow}`).join("; "),
})));
```

This prints the opcode order, macro bindings and only the branches the exporter
can justify. Empty branches mean unknown or unmodeled flow, not "nothing happens."
Keep the generated graph private; the repository ships tools, not extracted scripts.

## What about opening a gate?

Don't copy `Gate_remover_Post_Fight.ai` just because of its name. Script **26794**
tests the removed-set membership of `Setup_Mushroom_Controller`, then changes
camera/trigger activation and boss-related state. Its immediate effects don't
reference a physical door model. It is also a **different** controller from the
optional enemy example above; they are not a ready-made encounter/gate pair.

A new encounter needs its own bound enemy set, barrier and completion condition.
Those bindings, reset behavior and collision changes still need in-game tests.
Don't edit shared opcodes in place: clone them and remap their references.
[Detailed opcode evidence](SCRIPT_GRAPH.md#a-concrete-post-encounter-script-not-a-generic-door-recipe).
