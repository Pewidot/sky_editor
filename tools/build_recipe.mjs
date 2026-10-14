#!/usr/bin/env node
// Source-only recipes select named objects in a user's own matching IGZ.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { describeObject, runRequest } from './level_builder.mjs';

export function buildRecipe(recipePath, input, output) {
  const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
  if (recipe.format !== 'skylanders-position-recipe' || recipe.version !== 1 || !Array.isArray(recipe.edits))
    throw new Error('Unsupported recipe format');
  if (!/^[0-9a-f]{64}$/.test(recipe.sourceSha256 ?? ''))
    throw new Error('Recipe needs an exact sourceSha256');
  const igz = parseIgz(input);
  const digest = createHash('sha256').update(igz.buffer).digest('hex');
  if (digest !== recipe.sourceSha256)
    throw new Error(
      'Recipe requires a different source SHA-256; do not apply it to another game/level/build',
    );
  const objects = igz.objects.map((o) => describeObject(igz, o));
  const edits = recipe.edits.map((edit) => {
    if (!edit || typeof edit.name !== 'string' || typeof edit.type !== 'string')
      throw new Error('Recipe edit requires a name and type');
    const matches = objects.filter((o) => o.name === edit.name && o.type === edit.type);
    if (matches.length !== 1)
      throw new Error(
        `Expected exactly one ${edit.type} named ${JSON.stringify(edit.name)}, got ${matches.length}`,
      );
    return { objectId: matches[0].id, position: edit.position };
  });
  return {
    recipe: path.resolve(recipePath),
    recipeName: recipe.name,
    ...runRequest({ operation: 'build', path: input, output, expectedSha256: digest, edits }),
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5)
      throw new Error(
        'Usage: node tools/build_recipe.mjs <recipe.json> <original-inner-level.bld> <new-inner-level.bld>',
      );
    console.log(JSON.stringify(buildRecipe(...process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
