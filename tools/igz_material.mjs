// Source-bound, read-only material diagnostics. No shader evaluation or writes.
// Field layouts come from the exact CUSA00697 ELF tables in elf_metadata.mjs.
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const relocationSets = new WeakMap();
export const MATERIAL_PARAMETER_EVIDENCE = Object.freeze({
  parameters: 'ev_ba72a013f55bef0f3fabd72278ea72e2b7471096a5dd380595e21da93f0f93f3',
  base: 'ev_7ed3016613841860453ae4a3c46852c012bb489b7d9f175ad773e5f87161e2f6',
  vector: 'ev_853eab4c0c5787247598f1da7dee0e5b1ed0aed39a6a2aac4d15d98084b8114b',
  float: 'ev_c8541dad2a8a2c5e29b50061953d26a70fc348b2e67353baf2eb98fa7180255c',
  bool: 'ev_d3280b53bd8baed769ac9dcca41fb55f104899bd3a3f550637ccc4f75e311abb',
  animation: 'ev_5cbf2b3aa351a87ca26bc5d417a137cb44f8373d8097f4398f1da3a9b86a6345',
  uvTrack: 'ev_e85eac603c9e6f50dad93fad5d24b34ff8a02da704e5aeda8903b23bf8e20fa3',
  color: 'ev_3c322b1b3f8822dd81e93059c93d766f92371de01e93a33b5f72c6c806fff269',
  vertexMask: 'ev_3b25aa4e4a203034e921a8ecfb0a286ad1154f5be1f1fee219fe9d4924a4611b',
  pixelMask: 'ev_90016cb7f827d2c4b730c9f72287907dda354307aebebdb337993dfa7c6b95c0',
});
const CONSTANTS = new Map([
  ['igShaderConstantVector', { size: 0x30, kind: 'float32x4', evidence: MATERIAL_PARAMETER_EVIDENCE.vector }],
  ['igShaderConstantFloat', { size: 0x28, kind: 'float32', evidence: MATERIAL_PARAMETER_EVIDENCE.float }],
  // Despite the class name, native _data uses igIntMetaField (32 bits).
  ['igShaderConstantBool', { size: 0x28, kind: 'int32-boolean', evidence: MATERIAL_PARAMETER_EVIDENCE.bool }],
]);
function validate(z) {
  check(
    z?.version === 8 && z.platform === 14 && Buffer.isBuffer(z.buffer),
    'Material diagnostics require parsed PS4 IGZ v8',
  );
}
export function readShaderConstant(z, id) {
  validate(z);
  check(Number.isSafeInteger(id) && id >= 0, 'Invalid shader constant object ID');
  const o = z.objects[id],
    profile = CONSTANTS.get(o?.type);
  check(profile && o.size === profile.size, 'Unsupported shader constant layout');
  const at = o.offset + 0x20;
  const result = {
    id,
    type: o.type,
    name: z.stringReferencesByOffset.get(o.offset + 0x10)?.value ?? '',
    objectOffset: o.offset,
    dataOffset: at,
    dataType: profile.kind,
    enabledRaw: z.buffer[o.offset + 0x18],
    handleRaw: z.buffer.readInt32LE(o.offset + 0x1c),
    appliedToPreview: false,
    activeAtRuntime: 'unknown',
    evidence: profile.evidence,
  };
  if (profile.kind === 'int32-boolean') {
    result.rawInt32 = z.buffer.readInt32LE(at);
    check(result.rawInt32 === 0 || result.rawInt32 === 1, 'Noncanonical int32 shader boolean');
    result.value = result.rawInt32 === 1;
  } else {
    const values = Array.from({ length: profile.kind === 'float32x4' ? 4 : 1 }, (_, i) =>
      z.buffer.readFloatLE(at + i * 4),
    );
    check(values.every(Number.isFinite), 'Nonfinite shader constant');
    result.value = values.length === 1 ? values[0] : values;
  }
  return result;
}

// These attrs affect context state when their pass executes. A serialized attr
// is not proof that its pass or its particular shader variant is active.
export function readMaterialStateAttr(z, id) {
  validate(z);
  check(Number.isSafeInteger(id) && id >= 0, 'Invalid material state object ID');
  const o = z.objects[id],
    color = o?.type === 'igColorAttr';
  const stage =
    o?.type === 'igVertexShaderVariantMaskAttr'
      ? 'vertex'
      : o?.type === 'igPixelShaderVariantMaskAttr'
        ? 'pixel'
        : null;
  check((color || stage) && o.size === (color ? 0x30 : 0x20), 'Unsupported material state layout');
  const result = {
    id,
    type: o.type,
    objectOffset: o.offset,
    appliedToPreview: false,
    activeAtRuntime: 'unknown',
  };
  if (color) {
    const value = Array.from({ length: 4 }, (_, i) => z.buffer.readFloatLE(o.offset + 0x20 + i * 4));
    check(value.every(Number.isFinite), 'Nonfinite material color');
    return {
      ...result,
      field: '_color',
      dataOffset: o.offset + 0x20,
      dataType: 'float32x4',
      value,
      evidence: MATERIAL_PARAMETER_EVIDENCE.color,
    };
  }
  return {
    ...result,
    stage,
    dataType: 'uint32-mask-pair',
    baseMask: z.u32(o.offset + 0x14),
    ignoreMask: z.u32(o.offset + 0x18),
    baseMaskOffset: o.offset + 0x14,
    ignoreMaskOffset: o.offset + 0x18,
    evidence: MATERIAL_PARAMETER_EVIDENCE[stage + 'Mask'],
  };
}

// The material's animation list is not a direct UV matrix. Report explicit
// target/track identities; do not treat its pointers or time tracks as floats.
export function readMaterialAnimations(z, materialId) {
  validate(z);
  check(Number.isSafeInteger(materialId) && materialId >= 0, 'Invalid material object ID');
  const m = z.objects[materialId];
  check(m?.type === 'tfbRuntimeMaterial' && m.size === 0x58, 'Unsupported material animation owner');
  if (!relocationSets.has(z))
    relocationSets.set(z, new Set([...z.offsetTables.values()].flatMap((t) => Array.from(t.offsets))));
  const allRelocations = relocationSets.get(z);
  const nullable = (o, field) => {
    check(field >= 0 && field + 8 <= o.size, 'Animation pointer exceeds object');
    const at = o.offset + field,
      ref = z.pointerReferencesByOffset.get(at);
    if (!ref && !allRelocations.has(at) && z.buffer.readBigUInt64LE(at) === 0n) return null;
    check(ref, 'Unresolved animation object relocation');
    const target = z.objectsByOffset.get(ref.targetOffset);
    check(target, 'Animation reference is not an object');
    return target;
  };
  const list = nullable(m, 0x48);
  if (!list) return [];
  check(
    list.type === 'igCustomMaterialAnimationList' && list.size === 0x28,
    'Unsupported material animation list',
  );
  const count = z.u32(list.offset + 0xc),
    capacity = z.u32(list.offset + 0x10),
    bytes = z.u32(list.offset + 0x18);
  check(count <= 128 && count <= capacity && bytes >= count * 8, 'Invalid or excessive animation list');
  if (!count) return [];
  const data = z.pointerReferencesByOffset.get(list.offset + 0x20);
  check(data, 'Missing animation list relocation');
  z.resolvePointer(data.encoded, count * 8);
  return Array.from({ length: count }, (_, index) => {
    const slot = data.targetOffset + index * 8,
      ref = z.pointerReferencesByOffset.get(slot);
    check(ref, 'Missing animation item relocation');
    const a = z.objectsByOffset.get(ref.targetOffset);
    check(a?.type === 'igCustomMaterialAnimation' && a.size === 0x30, 'Unsupported material animation item');
    const transform = nullable(a, 0x10);
    const track =
      transform?.type === 'tfbFxMaterialUvAnimationTransform' && transform.size === 0x80
        ? nullable(transform, 0x70)
        : null;
    return {
      id: a.index,
      objectOffset: a.offset,
      fieldName: z.stringReferencesByOffset.get(a.offset + 0x18)?.value ?? '',
      animationTargetRaw: z.u32(a.offset + 0x20),
      unitId: z.buffer.readInt32LE(a.offset + 0x24),
      transform: transform
        ? { id: transform.index, type: transform.type, objectOffset: transform.offset }
        : null,
      track: track ? { id: track.index, type: track.type, objectOffset: track.offset } : null,
      appliedToPreview: false,
      activeAtRuntime: 'unknown',
      evidence: MATERIAL_PARAMETER_EVIDENCE.animation,
    };
  });
}
