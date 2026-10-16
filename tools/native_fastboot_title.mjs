// Exact-build title-flow patch recovered from the game's serialized scripts.
// Builds new archives from caller-supplied originals; never installs them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';
import { appendIgz } from './igz_append.mjs';
import { NativeScriptWriter, bufferSha256, reconcileReferences } from './native_script_writer.mjs';
import { replaceMember } from './iga_replace.mjs';
import { decodeUtf16Dictionary } from './chapter_entrypoints.mjs';

// Resolve the native handle from the installed game's own registration and
// matching dictionary, rather than guessing an ID from a chapter filename.
export function resolveResidentLoadString({ bootstrap, global, language }, map) {
  assert.match(map ?? '', /^Level_[A-Za-z0-9_]{1,80}$/, 'Invalid map load string');
  const b = parseIgz(bootstrap),
    g = parseIgz(global),
    l = parseIgz(language);
  const rootSlots = (z) => {
    const fix = z.fixupMap.get('ROOT');
    assert.equal(fix?.count, 1, 'Expected one root list');
    const root = z.objectsByOffset.get(z.resolvePointer(z.u32(fix.dataOffset)).offset);
    assert.equal(root?.type, 'igObjectList');
    const count = z.u32(root.offset + 12);
    assert.ok(count > 0 && count < 100000, 'Invalid root count');
    const data = z.pointerReferencesByOffset.get(root.offset + 32);
    assert.ok(data);
    z.resolvePointer(data.encoded, count * 8);
    return Array.from(
      { length: count },
      (_, i) => z.pointerReferencesByOffset.get(data.targetOffset + i * 8)?.targetObjectIndex,
    );
  };
  const base = rootSlots(b).length + 1,
    roots = rootSlots(g);
  const packs = l.objects.filter((o) => o.type === 'LanguagePackInfo');
  assert.equal(packs.length, 1);
  const pack = packs[0],
    data = l.pointerReferencesByOffset.get(pack.offset + 48),
    length = l.u32(pack.offset + 40);
  assert.ok(data && length < 64 * 1024 * 1024);
  l.resolvePointer(data.encoded, length);
  const dictionary = decodeUtf16Dictionary(language.subarray(data.targetOffset, data.targetOffset + length));
  const strings = g.objects.filter(
    (o) => o.type === 'StringInfo' && !g.stringReferencesByOffset.get(o.offset + 16)?.value.startsWith('^'),
  );
  assert.equal(strings.length, dictionary.length, 'Global and language dictionary do not match');
  const candidates = strings.flatMap((o, i) => (dictionary[i].text === map ? [{ o, i }] : []));
  assert.equal(candidates.length, 1, 'Map has no unique resident load string: ' + map);
  const { o, i } = candidates[0],
    slots = roots.flatMap((id, index) => (id === o.index ? [index] : []));
  assert.equal(slots.length, 1, 'Load string is not uniquely registered in the global root');
  return {
    nameId: base + slots[0],
    namespaceHash: 647282318,
    sourceObjectId: o.index,
    sourceName: g.stringReferencesByOffset.get(o.offset + 16)?.value,
    dictionaryOrdinal: i,
    sourceSha256: bufferSha256(global),
    languageSha256: bufferSha256(language),
    bootstrapSha256: bufferSha256(bootstrap),
  };
}

export const PROFILE = Object.freeze({
  sourceSha256: 'ac9de5aec39382d11e3caa8a62afb98240ee3ed273c804a58978ed9bd358710e',
  archiveSha256: '6185686228683d98679f4effa3c6222142fbce5d8bb08c4003887c2705cac57d',
  allowedMaps: ['Level_901_Sunbreak', 'Level_314_Tutorial_2'],
  graph: 'research/directboot-01-title.json',
  graphSha256: 'df61b38099e31dc31d23bfafa85603f22ff0d0f6f76d40e536c9d57e4d67173e',
  loadStrings: {
    Level_314_Tutorial_2: {
      nameId: 1983,
      namespaceHash: 647282318,
      sourceObjectId: 25087,
      sourceName: 'Level_314_Tutorial2',
      dictionaryOrdinal: 140,
      sourceSha256: 'c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c',
      languageSha256: '826712f658a803b1f03419ef571cd3b48c157e440d4eef43ac5f2613a6265e22',
    },
    Level_901_Sunbreak: {
      nameId: 3051,
      namespaceHash: 647282318,
      sourceName: 'AI_Sunbreak_Load',
      requires: 'Existing private Sunbreak registration and matching language packs',
    },
  },
});

/**
 * Patch an original Title level.bld payload, not the outer archive.
 * `auto-slot` preserves engine/controller/profile initialization, loads existing
 * slot zero, and bypasses title/menu presentation. It does not create saves.
 * Resident map load strings must already be registered in the matching global
 * archive/language packs. No game data or binaries are bundled with this tool.
 *
 * Chapter314 + separate legal-duration/map-intro patches were observed loading
 * without menu inputs and responding to movement at the 12-second sample.
 * Each newly generated archive still requires native acceptance; that result is
 * not a promise about a different map, save, emulator, computer or cache state.
 */
export function patchFastbootTitle(source, { map, stage = 'post-slot', registration } = {}) {
  assert.ok(
    registration || PROFILE.allowedMaps.includes(map),
    'Map is not in the supported test allowlist; installed registration is required',
  );
  assert.ok(['post-slot', 'auto-slot'].includes(stage), 'Unsupported fastboot stage');
  assert.equal(bufferSha256(source), PROFILE.sourceSha256, 'Original Title payload required');
  const w = new NativeScriptWriter(source, PROFILE.sourceSha256, 65536),
    z = w.parsed;
  const object = (id, type) => {
    const o = z.objects[id];
    assert.equal(o?.type, type);
    return o;
  };
  function rows(id) {
    const script = object(id, 'tfbScriptInfo'),
      list = z.objects[z.pointerReferencesByOffset.get(script.offset + 40).targetObjectIndex];
    assert.equal(list.type, 'OpCodeList');
    const data = z.pointerReferencesByOffset.get(list.offset + 32).targetOffset;
    return {
      list,
      data,
      entries: Array.from(
        { length: z.u32(list.offset + 12) },
        (_, i) => z.pointerReferencesByOffset.get(data + i * 8).targetObjectIndex,
      ),
    };
  }
  const title = rows(2496),
    ui = rows(4749);
  assert.equal(title.entries[1902], 2974);
  assert.equal(title.entries[1903], 1423);
  assert.equal(title.entries[1908], 1126);
  assert.equal(ui.entries[25], 4840);
  assert.deepEqual(title.entries.slice(1897, 1902), [4085, 3496, 1529, 1254, 1285]);
  // StringInfo._name is not its text. Native post-load assigns UTF-16 text from
  // the matching language pack in RVTB order. Reuse the registered global load
  // value; do not append a StringInfo with an absent dictionary assignment.
  const loadString = registration ? resolveResidentLoadString(registration, map) : PROFILE.loadStrings[map];
  const rhs = w.clone(2874);
  w.list(rhs, [{ external: w.externalId(loadString.nameId, loadString.namespaceHash) }]);
  // Callback macros execute in the menu context. The original Play button uses
  // FindVariable owned by Title_Main; a direct OpCreateVariable reference here
  // indexes the wrong frame and crashed at ELF0x482b1c in the first experiment.
  const find = w.clone(3196);
  w.bytes.writeBigUInt64LE(BigInt(w.string('title force load to level')), find + 72);
  w.bytes.writeBigUInt64LE(z.u64(object(4733, 'OpCreateVariable').offset + 72), find + 64);
  const lhs = w.clone(3198);
  w.list(lhs, [{ local: find }]);
  const assign = w.clone(3197);
  w.pointer(assign, 56, lhs);
  w.pointer(assign, 64, rhs);
  const skip = w.clone(2555);
  w.branch(skip, 2);
  let expandedList = null,
    openingMenuParameter = null,
    enterNativePress = null,
    finishNativePress = null;
  const branchAdjustments = [];
  if (stage === 'auto-slot') {
    // The source save-slot button supplies these exact three parameters to4152.
    // Existing slot0, never new-game/create-if-missing/overwrite-corrupt.
    const slot = w.clone(21088),
      existing = w.clone(21089),
      controller = w.clone(21092);
    w.existingPointer(slot, 88, object(1237, 'ValueRHSVariant').encoded);
    w.existingPointer(existing, 88, z.objects[1237].encoded);
    w.existingPointer(controller, 88, z.pointerReferencesByOffset.get(z.objects[6429].offset + 64).encoded);
    const call = [
      { encoded: object(21086, 'OpUseMacro').encoded },
      { encoded: object(1338, 'OpMacroInterface').encoded },
      { local: slot },
      { local: existing },
      { local: controller },
      { encoded: object(1254, 'OpFlowMacro').encoded },
      { encoded: object(1285, 'OpFlowBuiltInBehavior').encoded },
    ];
    assert.deepEqual(title.entries.slice(1729, 1734), [2970, 1387, 3977, 1254, 1285]);
    const entries = title.entries.map((id) => ({ encoded: z.objects[id].encoded }));
    entries.splice(1729, 5, ...call);
    for (let row = 0; row < title.entries.length; row++) {
      if (row >= 1729 && row < 1734) continue;
      const o = z.objects[title.entries[row]],
        count = source.readUInt16LE(o.offset + 50);
      if (count === 0 || count === 65535) continue;
      const destination = row + 1 + count;
      assert.ok(
        destination <= 1729 || destination >= 1734,
        'Existing branch enters the middle of replaced save-slot call',
      );
      const moved = (r) => (r >= 1734 ? r + 2 : r);
      const replacement = moved(destination) - moved(row) - 1;
      if (replacement !== count)
        branchAdjustments.push({
          objectId: o.index,
          encoded: o.encoded,
          row,
          before: count,
          after: replacement,
        });
    }
    assert.deepEqual(
      branchAdjustments.map((a) => a.objectId),
      [2498, 3071, 3647, 3973],
    );
    for (const change of branchAdjustments)
      assert.equal(title.entries.filter((id) => id === change.objectId).length, 1);
    expandedList = w.clone(2497);
    w.list(expandedList, entries);
    // Enter the already-defined header-loading page directly, not the autosave explanation.
    openingMenuParameter = w.clone(6412);
    const menuRhs = w.clone(6574);
    w.list(menuRhs, [{ encoded: object(1157, 'StringInfo').encoded }]);
    w.pointer(openingMenuParameter, 88, menuRhs);
    // The visible title's Press-X branch performs real controller binding.
    // Retain actor startup, the native branch, portal readiness and shutdown;
    // skip only logo/sprite construction and animation state transitions.
    assert.deepEqual(ui.entries.slice(536, 543), [4263, 1423, 4266, 6216, 1254, 1285, 1126]);
    enterNativePress = w.clone(2555);
    w.branch(enterNativePress, 536 - 227 - 1);
    finishNativePress = w.clone(2555);
    w.branch(finishNativePress, 655 - 542 - 1);
  }
  const appended = appendIgz(source, {
    expectedSha256: PROFILE.sourceSha256,
    appendedDefaultPool: w.bytes.subarray(0, w.cursor),
    appendedObjects: w.objects,
    newStrings: w.strings,
    newExternalIds: w.externals,
    fixupSlots: Object.fromEntries(
      [...w.fixups].map(([kind, slots]) => [kind, [...slots].sort((a, b) => a - b)]),
    ),
  });
  let buffer = Buffer.from(appended.buffer),
    parsed = parseIgz(buffer),
    changes = [];
  if (expandedList !== null) {
    const script = parsed.objects.find((o) => o.encoded === z.objects[2496].encoded);
    buffer.writeBigUInt64LE(BigInt(w.target.appendOffset + expandedList), script.offset + 40);
    for (const change of branchAdjustments) {
      const o = parsed.objects.find((o) => o.encoded === change.encoded);
      assert.equal(buffer.readUInt16LE(o.offset + 50), change.before);
      buffer.writeUInt16LE(change.after, o.offset + 50);
    }
    parsed = parseIgz(buffer);
  }
  function replaceRow(scriptId, row, beforeId, encoded, reason) {
    const old = scriptId === 2496 ? title : ui;
    assert.equal(old.entries[row], beforeId);
    const script = parsed.objects.find((o) => o.encoded === z.objects[scriptId].encoded);
    const list = parsed.objects[parsed.pointerReferencesByOffset.get(script.offset + 40).targetObjectIndex];
    const outputRow = scriptId === 2496 && expandedList !== null && row >= 1734 ? row + 2 : row;
    const at = parsed.pointerReferencesByOffset.get(list.offset + 32).targetOffset + outputRow * 8;
    assert.equal(parsed.pointerReferencesByOffset.get(at).encoded, z.objects[beforeId].encoded);
    buffer.writeBigUInt64LE(BigInt(encoded), at);
    changes.push({
      scriptId,
      row,
      outputRow,
      beforeId,
      beforeEncoded: z.objects[beforeId].encoded,
      afterEncoded: encoded,
      reason,
    });
  }
  replaceRow(
    4749,
    25,
    4840,
    object(4841, 'OpSetBehavior').encoded,
    'Unconditionally select the existing Title Screen behavior at startup; bypass Legal/ATVI/TFB/Beenox video behaviors.',
  );
  replaceRow(
    2496,
    1902,
    2974,
    w.target.appendOffset + find,
    'After real slot load and FillLiveGameData3120, find title-force-load variable on its actual Title_Main owner.',
  );
  replaceRow(
    2496,
    1903,
    1423,
    w.target.appendOffset + assign,
    'Assign the requested StringInfo to the owner-qualified variable, not the menu callback frame.',
  );
  replaceRow(
    2496,
    1904,
    3966,
    object(1285, 'OpFlowBuiltInBehavior').encoded,
    'Close original source-shaped FindVariable scope.',
  );
  replaceRow(
    2496,
    1905,
    3967,
    w.target.appendOffset + skip,
    'Skip obsolete MainMenu interface return to existing callback exit1908.',
  );
  if (stage === 'auto-slot') {
    replaceRow(
      4749,
      226,
      5034,
      object(6185, 'OpSetReference').encoded,
      'Use the original primary-controller assignment with physical controller1; no synthetic input event.',
    );
    replaceRow(
      4749,
      227,
      5037,
      w.target.appendOffset + enterNativePress,
      'Enter the exact native Press-X controller-binding call536; preserve the black startup backdrop and never construct title graphics.',
    );
    replaceRow(
      4749,
      542,
      1126,
      w.target.appendOffset + finishNativePress,
      'After native controller binding, enter the original portal-readiness branch655 and normal actor teardown without logo-exit animation.',
    );
    replaceRow(
      2496,
      2689,
      6412,
      w.target.appendOffset + openingMenuParameter,
      'Open native Pre_ChooseSlot_Title to asynchronously initialize/load the save header.',
    );
  }
  buffer = reconcileReferences(
    buffer,
    z,
    w.objects.map((o) => w.target.appendOffset + o.offset),
  );
  const out = parseIgz(buffer);
  assert.equal(out.unresolvedFixupEntries.length, 0);
  for (const c of changes) {
    const script = out.objects.find((o) => o.encoded === z.objects[c.scriptId].encoded);
    const list = out.objects[out.pointerReferencesByOffset.get(script.offset + 40).targetObjectIndex];
    const at = out.pointerReferencesByOffset.get(list.offset + 32).targetOffset + c.outputRow * 8;
    assert.equal(out.pointerReferencesByOffset.get(at).encoded, c.afterEncoded);
  }
  return {
    buffer,
    manifest: {
      schema: 'private-title-fastboot-v4-native-title-lifecycle',
      stage,
      map,
      sourceSha256: PROFILE.sourceSha256,
      outputSha256: bufferSha256(buffer),
      sourceSize: source.length,
      outputSize: buffer.length,
      changes,
      branchAdjustments,
      autoSlot:
        stage === 'auto-slot'
          ? {
              slot: 0,
              newGame: false,
              macroId: 4152,
              callSource: { scriptId: 20177, rows: [400, 406] },
              replacement: { scriptId: 2496, oldRows: [1729, 1733], newRows: [1729, 1735] },
              preservedHeaderReadyGuard: 3973,
              preservedPortalIdInitialization: 3974,
            }
          : null,
      addedObjects: w.objects.map((o) => ({ type: o.type, encoded: w.target.appendOffset + o.offset })),
      loadString: {
        ...loadString,
        text: map,
        storage: 'Existing resident StringInfo via EXID; no new localization ordinal',
      },
      correctedExperiment: {
        priorBuilds: ['fastboot-stage1-01', 'fastboot-stage2-01'],
        failure:
          'Native read-null at ELF0x482b1c after slot load: callback directly addressed Title actor frame-local variable.',
        correction:
          'Original Play-button source pattern3196/3197/3198: owner-qualified OpFindVariable + ReferenceStack to found variable.',
      },
      correctedStringExperiment: {
        priorBuild: 'fastboot-stage2-02',
        failure:
          'Native slot load completed without crash, then loader requested /app0/item/.bld: new StringInfo had no language-pack text.',
        correction:
          'Use the existing resident global load StringInfo; preserve all Title StringInfo and language dictionary ordinals.',
        evidence: [
          'ev_d5331c43aeaadcbbff8d89bf8123a0efba6c744e246a14eb01239bc8db9b4edd',
          'ev_e4efcca476e72dea97ca79ba07af045ce80540d37ac391aae79acaf3757f3109',
        ],
      },
      correctedLifecycleExperiment: {
        priorBuild: 'fastboot-stage2-03',
        observation:
          'The resident map value reached Title_Main and global level progression, but no requested map archive opened.',
        comparison:
          'fastboot-postslot-03 with original title initialization opened chapter314 in control17 and entered its native cinematic.',
        correction:
          'Retain Title_Main title animation setup/actor creation and the UI actor native controller-binding/portal-readiness path.',
        presentation:
          'Bypass UI sprite/logo construction and its removal of the opaque startup backdrop; normal Title shutdown removes that cover.',
      },
      preserved: [
        'Tfb.startLevel=Title',
        'bootstrap wait',
        'save header initialization',
        'real profile load and error path',
        'FillLiveGameData3120',
        'pending save requests wait',
        'controller assignment and player join',
        'normal level switch loader',
      ],
      expectedSequence: [
        'Title engine bootstrap',
        ...(stage === 'auto-slot'
          ? [
              'native title actor startup beneath opaque startup backdrop',
              'original controller-binding and portal readiness without title graphics',
              'native header-loading page (no input)',
              'original header completion and PortalMaster ID initialization',
              'automatic existing slot0 request',
            ]
          : ['Title Screen without branding videos', 'manual title/autosave/save-slot selection']),
        'original asynchronous slot load',
        'native title force-load route',
        'requested chapter',
      ],
      limitations: [
        ...(stage === 'post-slot' ? ['Not a zero-input startup: title and slot selection remain.'] : []),
        'This generated artifact has not itself been runtime-validated by the builder.',
        'Missing/corrupt profile follows original error menu; no automatic profile creation.',
        'Map-local scripted intro is separate from Title story movie and is not modified.',
      ],
      runtimeValidated: false,
      graphEvidence: { path: PROFILE.graph, sha256: PROFILE.graphSha256 },
    },
  };
}

/** Write a new inner payload, repacked title.bld and before/after manifest.
 * Source/archive must be caller-supplied originals matching PROFILE hashes;
 * outputDir must not exist. This function never changes an installed game.
 */
export async function buildFastbootTitle({
  source,
  archive,
  outputDir,
  map,
  stage = 'post-slot',
  registration,
}) {
  const dir = path.resolve(outputDir);
  assert.ok(!fs.existsSync(dir), 'Output directory must be new');
  assert.equal(
    bufferSha256(fs.readFileSync(archive)),
    PROFILE.archiveSha256,
    'Original Title archive required',
  );
  const { buffer, manifest } = patchFastbootTitle(fs.readFileSync(source), { map, stage, registration });
  fs.mkdirSync(dir, { recursive: true });
  const inner = path.join(dir, 'level.bld'),
    outer = path.join(dir, 'title.bld'),
    report = path.join(dir, 'fastboot.manifest.json');
  fs.writeFileSync(inner, buffer, { flag: 'wx' });
  const replacement = await replaceMember({
    source: archive,
    selector: 'level.bld',
    replacement: inner,
    output: outer,
  });
  manifest.archive = { source: path.resolve(archive), sha256: replacement.output.sha256, output: outer };
  fs.writeFileSync(report, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { inner, outer, report, innerSha256: manifest.outputSha256, outerSha256: replacement.output.sha256 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, archive, outputDir, map, stage = 'post-slot', ...extra] = process.argv.slice(2);
  assert.ok(
    source && archive && outputDir && map && !extra.length,
    'Usage: node tools/native_fastboot_title.mjs ORIGINAL-INNER ORIGINAL-TITLE-ARCHIVE NEW-DIR MAP [post-slot|auto-slot]',
  );
  console.log(JSON.stringify(await buildFastbootTitle({ source, archive, outputDir, map, stage }), null, 2));
}
