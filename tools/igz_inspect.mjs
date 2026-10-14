#!/usr/bin/env node
import { parseIgz } from './igz.mjs';

function usage() {
  console.error(
    'Usage: igz_inspect.mjs <file.igz> [--types <regex>] [--strings <regex>] [--objects <regex>] [--limit <n>] [--json]',
  );
  process.exit(2);
}
const args = process.argv.slice(2);
if (!args.length) usage();
const file = args.shift();
let typePattern = null,
  stringPattern = null,
  objectPattern = null;
let limit = 80,
  json = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--types' && args[i + 1]) typePattern = new RegExp(args[++i], 'i');
  else if (args[i] === '--strings' && args[i + 1]) stringPattern = new RegExp(args[++i], 'i');
  else if (args[i] === '--objects' && args[i + 1]) objectPattern = new RegExp(args[++i], 'i');
  else if (args[i] === '--limit' && args[i + 1]) limit = Number(args[++i]);
  else if (args[i] === '--json') json = true;
  else usage();
}
if (!Number.isSafeInteger(limit) || limit < 0) usage();
try {
  const igz = parseIgz(file);
  const counts = new Map();
  for (const o of igz.objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  const types = [...counts]
    .map(([name, count]) => ({ name, count, size: igz.typeSizes[igz.types.indexOf(name)] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .filter((x) => !typePattern || typePattern.test(x.name))
    .slice(0, limit);
  const strings = stringPattern
    ? igz.stringEntries.filter((e) => stringPattern.test(e.value)).slice(0, limit)
    : undefined;
  const objects = objectPattern
    ? igz.objects
        .filter((o) => objectPattern.test(o.type))
        .slice(0, limit)
        .map(igz.summarizeObject)
    : undefined;
  const result = {
    file: igz.file,
    size: igz.size,
    version: igz.version,
    platform: igz.platform,
    descriptors: igz.descriptors,
    fixups: igz.fixups,
    typeNameCount: igz.types.length,
    stringCount: igz.strings.length,
    emptyStringIndices: igz.stringEntries.filter((e) => e.value === '').map((e) => e.index),
    dependencyCount: igz.dependencies.length,
    dependencies: igz.dependencies,
    objectCount: igz.objects.length,
    distinctObjectTypes: counts.size,
    stringReferenceCount: igz.stringReferences.length,
    pointerReferenceCount: igz.pointerReferences.length,
    specialRelocationCount: igz.specialRelocations.length,
    tmhnReferenceCount: igz.tmhnReferences.length,
    unresolvedFixupEntries: igz.unresolvedFixupEntries,
    types,
    strings,
    objects,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `File: ${igz.file}\nIGZ v${igz.version}, platform ${igz.platform}, ${igz.size.toLocaleString()} bytes`,
    );
    console.log(
      `Descriptors: ${igz.descriptors.length}; fixups: ${igz.fixups.map((f) => `${f.magic}:${f.count}`).join(', ')}`,
    );
    console.log(
      `Objects: ${igz.objects.length.toLocaleString()} (${counts.size} types); strings: ${igz.strings.length.toLocaleString()}; string refs: ${igz.stringReferences.length.toLocaleString()}; resolved pointers: ${igz.pointerReferences.length.toLocaleString()}`,
    );
    if (igz.unresolvedFixupEntries.length)
      console.log(
        `Unresolved fixup locations: ${igz.unresolvedFixupEntries.length} (raw values retained; use --json)`,
      );
    if (igz.specialRelocations.length)
      console.log(
        `Runtime zero-and-initialize slots: ${igz.specialRelocations.length} (initializer callee semantics remain undecoded)`,
      );
    if (igz.tmhnReferences.length)
      console.log(`RMHN references to TMHN entries: ${igz.tmhnReferences.length}`);
    console.log('\nObject types (count / size):');
    for (const t of types)
      console.log(`${String(t.count).padStart(8)} ${String(t.size).padStart(6)}  ${t.name}`);
    if (strings) {
      console.log('\nMatching strings (index / file offset):');
      for (const s of strings)
        console.log(`${String(s.index).padStart(8)} 0x${s.offset.toString(16)}  ${JSON.stringify(s.value)}`);
    }
    if (objects) {
      console.log('\nMatching objects (RVTB index / file offset / type / MTSZ size):');
      for (const o of objects) {
        console.log(`${o.index} 0x${o.offset.toString(16)} ${o.type} (${o.size} bytes)`);
        for (const r of o.stringReferences)
          console.log(`  +0x${r.fieldOffset.toString(16)} TSTR[${r.stringIndex}] ${JSON.stringify(r.value)}`);
        for (const r of o.pointerReferences) {
          const target = igz.objectsByOffset.get(r.targetOffset);
          console.log(
            `  +0x${r.fieldOffset.toString(16)} -> 0x${r.targetOffset.toString(16)} ${target ? `${target.type} #${target.index}` : '(data / interior pointer)'}`,
          );
        }
        for (const r of o.specialRelocations)
          console.log(`  +0x${r.fieldOffset.toString(16)} ROFS zero-and-initialize (not a pointer)`);
        for (const r of o.tmhnReferences)
          console.log(`  +0x${r.fieldOffset.toString(16)} RMHN -> TMHN[${r.tableIndex}]`);
      }
    }
  }
} catch (error) {
  console.error(`IGZ inspection failed: ${error.message}`);
  process.exitCode = 1;
}
