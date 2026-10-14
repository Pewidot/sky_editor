import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  createChapterUiDraft,
  createChapterBackdropDraft,
  UI_LANGUAGES,
} from '../tools/chapter_ui_draft.mjs';
import { parseIgz } from '../tools/igz.mjs';
test('UI and backdrop writers reject unpinned source bytes', () => {
  assert.throws(() => createChapterUiDraft({ ui: Buffer.alloc(80), languages: {} }), /Pinned UI/);
  assert.throws(() => createChapterBackdropDraft(Buffer.alloc(80)), /Pinned paired global/);
  assert.equal(new Set(UI_LANGUAGES.map(([name]) => name)).size, 10);
});
test(
  'owned original UI: cloned literal, dictionary coverage and existing checks',
  { skip: !process.env.SKY_UI_INNER || !process.env.SKY_UI_LANGUAGES },
  () => {
    const ui = fs.readFileSync(process.env.SKY_UI_INNER),
      hash = createHash('sha256').update(ui).digest('hex');
    const languages = Object.fromEntries(
      UI_LANGUAGES.map(([n]) => [
        n + '.pak',
        fs.readFileSync(path.join(process.env.SKY_UI_LANGUAGES, n + '.pak')),
      ]),
    );
    const result = createChapterUiDraft({ ui, languages }),
      z = parseIgz(result.ui);
    assert.equal(result.manifest.loopLimit.after, 23);
    assert.equal(result.manifest.languages.length, 10);
    assert.equal(result.manifest.runtimeValidated, false);
    assert.equal(result.manifest.buttonCount, 23);
    assert.equal(z.u32(z.objects.find((o) => o.encoded === 296400).offset + 64), 22);
    assert.equal(createHash('sha256').update(ui).digest('hex'), hash);
  },
);
