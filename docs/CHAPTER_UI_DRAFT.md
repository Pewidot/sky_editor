# Chapter-selection UI draft

This narrow CUSA00697 tool extends a supported original UI payload, not arbitrary
game revisions. Original inner UI SHA-256 is
`bf0879a08c951f5b2e44bdd81c0b5cebbfe9b79bdd8bbe3d3bde666d64b65f6a`.
Ten exact language hashes are compiled into `chapter_ui_draft.mjs`.

```bash
node tools/chapter_ui_draft.mjs original-inner-ui.bld original-ui-languages new-ui-draft
```

The draft clones `ValueRHSVariant #3143` and `RHSValueStack #3144`, sets only
the new literal to 23, and redirects `OpLoopValue #3142` to it. The old shared
literal22 and its two other comparisons remain unchanged; its reference count
decreases3→2. The new wrapper and stack each have count1. Existing button023
(`#3098`) is reused without changing its model. Native metadata evidence:
`ev_ce2e384244e06a9d8c0f05bbf84e64769dcc66bf155c1c96895769ce14bfd389`.

One new `StringInfo` belongs to ROOT and the description list (count2); the
description is “A sunlit grid test ground featuring a Gallardo display model.”
All ten dictionaries are rebuilt by original encoded identity/native RVTB
ordering. Non-English languages deliberately receive English fallback.

The stack contains an RPID memory descriptor, not a plain zero-highword pointer.
Native `0x514e20` preserves the descriptor's top five bits while rebinding its
low bits: `ev_d10b7df50bfe4ac9739b83ea127c4cf19ecbad22e00b23d0dcf43a63859f0dd7`.
The append writer preserves those flags and reserves the full eight-byte slot.

`createChapterBackdropDraft` separately extends the paired global backdrop list
22→23 with an explicit existing Arena303 sprite. Its owning incoming slots and
serialized reference count are checked before count3→4. No sprite/image is
cloned, and this is explicitly reused loading art, not Gallardo artwork.
The generic append API's `appendExistingObjects` is restricted to ScriptSetList;
it does not infer or automatically update ownership counts.

Private first outputs: `builds/chapter-ui-draft-01` and
`builds/chapter-ui-runtime-01`. All eleven rebuilt UI members and the modified
global inner member were independently extracted and hashed. Only the stopped
independent game copy is patched, with backups. Native chapter selection and
new-level loading remain separate runtime acceptance tests; see current status.
