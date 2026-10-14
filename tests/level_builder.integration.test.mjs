import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { buildRecipe } from '../tools/build_recipe.mjs';
import { replaceMember } from '../tools/iga_replace.mjs';
import { runRequest } from '../tools/level_builder.mjs';

const source = process.env.SKYLANDERS_TEST_LEVEL;
const archive = process.env.SKYLANDERS_TEST_ARCHIVE;
const extractor = process.env.SKYLANDERS_TEST_EXTRACTOR;
test(
  'real recipe -> IGZ -> IGA -> independent extraction roundtrip',
  { skip: !source || !archive || !extractor },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skylanders-layout-integration-'));
    const output = path.join(directory, 'edited.bld'),
      packed = path.join(directory, 'packed.bld');
    const before = runRequest({ operation: 'inspect', path: source });
    const result = buildRecipe('recipes/crossfire_layout.json', source, output);
    assert.equal(result.changedObjects, 4);
    assert.equal(result.changedByteCount, 24);
    await replaceMember({ source: archive, selector: 'level.bld', replacement: output, output: packed });
    const decoded = path.join(directory, 'decoded.bld');
    execFileSync(extractor, [packed, 'level.bld', decoded]);
    assert.deepEqual(fs.readFileSync(decoded), fs.readFileSync(output));
    const spawns = runRequest({
      operation: 'objects',
      path: decoded,
      type: 'tfbActorInfo',
      query: 'LeftSpawn',
    });
    assert.equal(spawns.total, 4);
    assert.deepEqual(
      spawns.objects.map((o) => o.position),
      [
        [-420, 1.7504663467407227, -33],
        [-416, 1.7504663467407227, -33],
        [-420, 1.7504663467407227, -29],
        [-416, 1.7504663467407227, -29],
      ],
    );
    assert.equal(runRequest({ operation: 'inspect', path: source }).sha256, before.sha256);
    console.log('Local integration output retained for review: ' + directory);
  },
);
