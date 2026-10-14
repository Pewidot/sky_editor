import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { extractMetadata, METADATA_DEFINITIONS, readMetadataCString } from '../tools/elf_metadata.mjs';

test('metadata C strings are nonempty printable ASCII and bounded to the selected file-backed span', () => {
  const bytes = Buffer.from('prefix\0_fieldName\0suffix\0', 'ascii');
  assert.equal(readMetadataCString(bytes, 7, 18), '_fieldName');
  assert.throws(() => readMetadataCString(bytes, 6), /Empty/);
  assert.throws(() => readMetadataCString(bytes, 7, 17), /unterminated/);
  assert.throws(() => readMetadataCString(bytes, 7, bytes.length, 3), /excessive/);
  assert.throws(() => readMetadataCString(Buffer.from([65, 0x80, 0]), 0), /non-ASCII/);
  assert.throws(() => readMetadataCString(Buffer.from([65, 10, 0]), 0), /non-ASCII/);
  for (const [at, end] of [
    [-1, 3],
    [0, 999],
    [3, 2],
    [1.5, 3],
  ])
    assert.throws(() => readMetadataCString(bytes, at, end), /span/);
  assert.throws(() => readMetadataCString(Buffer.from('unterminated'), 0), /unterminated/);
});

test('unknown executable bytes are rejected before fixed metadata addresses are dereferenced', () => {
  assert.throws(() => extractMetadata(Buffer.alloc(64)), /SHA-256/);
  assert.equal(
    Object.hasOwn(
      METADATA_DEFINITIONS.find((d) => d.name === 'igVertexBuffer'),
      'constructor',
    ),
    false,
  );
  assert.equal(METADATA_DEFINITIONS.find((d) => d.name === 'igVertexBuffer').parent, undefined);
  assert.equal(new Set(METADATA_DEFINITIONS.map((d) => d.name)).size, METADATA_DEFINITIONS.length);
});

const executable = 'extracted/CUSA00697/eboot.elf';
test(
  'exact local executable reproduces every geometry/model field used by the decoder',
  { skip: !fs.existsSync(executable) },
  () => {
    const result = extractMetadata(executable),
      classes = new Map(result.classes.map((d) => [d.name, d]));
    const expected = {
      ScriptStructure: { _interface: 0, _fieldList: 0x30, _varContentsType: 0x38, _unTyped: 0 },
      ScriptSet: { _list: 0x30 },
      ValueRHSVariant: {
        _varOp1: 0x10,
        _arithOperator: 0x18,
        _varOp2: 0x20,
        _resultFunc: 0x28,
        _conditioner: 0x30,
      },
      RHSValueStack: {
        _type: 0x38,
        _value: 0x40,
        _properties: 0x30,
        _funcRHS: 0x30,
        _typeIsNumber: 0x30,
        _isRandom: 0,
      },
      OpParameter: { _combineOp: 0x54, _RHS: 0x58, _indexRHS: 0x60 },
      OpCheckMembership: { _LHS: 0x38, _membershipOp: 0x40, _RHS: 0x48, _cachedType: 0x50, _cachedObj: 0x58 },
      OpRemove: { _NP: 0x38 },
      OpAbstractControl: { _lastReceiver: 0x38, _LHS: 0x40, _cachedObject: 0x48 },
      OpControl: { _indexRHS: 0x50 },
      OpSpawn: { _RHS: 0x50, _facingRHS: 0x58 },
      OpUseMacro: { _NP: 0x38, _indexRHS: 0x40 },
      OpSetBehavior: { _NP: 0x38, _indexRHS: 0x40 },
      OpCheckValue: { _cachedType: 0, _cachedValue: 0 },
      tfbScriptInfo: { _opList: 0x28, _masterVarList: 0x30 },
      OpCode: { _internalFlagsStorage: 0x30, _branchPC: 0x32 },
      OpDefineMacro: { _macroVarList: 0x50, _returnMacro: 0x58 },
      OpUserBehavior: { _thisPC: 0x34, _scriptInfo: 0x38 },
      OpStartSequence: { _LHS: 0x38, _indexRHS: 0x40, _cachedObject: 0x48 },
      OpSetReference: { _LHS: 0x38, _RHS: 0x40, _indexRHS: 0x48 },
      OpLoopValue: { _RHS: 0x38, _numLoops: 0x40 },
      OpMacroParameter: { _macroDef: 0x68, _parameterID: 0x70 },
      LanguagePackInfo: { _langID: 0x24, _stringDict: 0x28 },
      StringInfo: { _unicodeText: 0x30, _flags: 0x38, _integerDigits: 0x3c, _decimalDigits: 0x40 },
      igVertexShaderVariantAttr: {
        _shaderConstants: 0x18,
        _elementIndices: 0x20,
        _vertexShaders: 0x28,
        _variant: 0x30,
      },
      igPixelShaderVariantAttr: {
        _shaderConstants: 0x18,
        _elementIndices: 0x20,
        _pixelShaders: 0x28,
        _variant: 0x30,
      },
      igColorAttr: { _color: 0x20 },
      igVertexShaderVariantMaskAttr: { _baseMask: 0x14, _ignoreMask: 0x18 },
      igPixelShaderVariantMaskAttr: { _baseMask: 0x14, _ignoreMask: 0x18 },
      igShaderVariant: { _shaderConstantIndices: 0x10, _elementIndices: 0x18, _shaderHandles: 0x20 },
      tfbFxMaterialUvAnimationTransform: { _track: 0x70 },
      igCustomMaterialAnimation: {
        _transform: 0x10,
        _fieldName: 0x18,
        _animationTarget: 0x20,
        _unitID: 0x24,
        _owner: 0x28,
      },
      igShaderConstantFloat: { _data: 0x20 },
      igShaderConstantBool: { _data: 0x20 },
      igShaderBuffer: {
        _platform: 0xc,
        _shaderType: 0x10,
        _header: 0x18,
        _shaderData: 0x28,
        _hash: 0x30,
        _shaderHandle: 0x34,
      },
      igShaderParametersAttr: { _dataList: 0x18, _unitID: 0x14 },
      igShaderConstantData: { _enabled: 0x18, _handle: 0x1c },
      igShaderConstantVector: { _data: 0x20 },
      igAttr: { _cachedUnitID: 0xc, _cachedAttrIndex: 0xe, _readOnlyCopy: 0x10 },
      igTextureSamplerSource: { _textureUnit: 0x18, _samplerNumber: 0x1c, _reserved: 0x20 },
      igTechniqueSampler: { _unitID: 0x18, _magFilter: 0x1c, _minFilter: 0x20 },
      OpChangeMembership: { _LHS: 0x38, _combineOp: 0x40, _RHS: 0x48 },
      tfbMoodBoxInfo: {
        _initMatrix: 0x30,
        _box: 0x48,
        _ID: 0x50,
        _enabled: 0x54,
        _envMap: 0x58,
        _cloudMap: 0x60,
        _influence: 0x68,
      },
      tfbLightInfo: {
        _lightType: 0x138,
        _diffuseColor: 0x13c,
        _min: 0x140,
        _max: 0x14c,
        _intensity: 0x158,
        _attenuation: 0x15c,
        _visible: 0x180,
        _ambientColor: 0x1b4,
        _multiplier: 0x1bc,
      },
      DirectionalLightInfo: {
        _initMatrix: 0x48,
        _diffuseColor: 0x30,
        _ambientColor: 0x34,
        _specularColor: 0x38,
        _multiplier: 0x3c,
        _ambientDiffuseMultiplier: 0x40,
        _ambientSpecularMultiplier: 0x44,
      },
      AbstractPlacement: { _initMatrix: 0x40, _currentMatrix: 0x58 },
      Placement: { _scaleVec: 0x114 },
      tfbActorInfo: { _model: 0x158 },
      CollisionInfo: {
        _properties: 0x30,
        _transform: 0x34,
        _width: 0x4c,
        _height: 0x50,
        _length: 0x54,
        _shapeType: 0x30,
        _isSolid: 0x30,
        _interactsWithWorld: 0x30,
        _isActorSurface: 0x30,
        _isActorPhysicsObject: 0x30,
      },
      igVertexBuffer: { _vertexCount: 0xc, _data: 0x20, _format: 0x28, _primitiveType: 0x30 },
      igIndexBuffer: { _indexCount: 0xc, _data: 0x20, _format: 0x28, _primitiveType: 0x30 },
      igVertexFormat: { _vertexSize: 0xc, _elements: 0x10 },
      igIndexFormat: { _indexType: 0xc },
      igGeometryAttr: { _vertexBuffer: 0x18, _indexBuffer: 0x20, _offset: 0x28, _primitiveCount: 0x2c },
      Drawable: { _geometry: 0x18, _entity: 0x28, _blendMatrixSet: 0x2a },
      igTransform: { _m: 0x40, _target: 0x80 },
      igTransformSource3: {
        _dataStride: 0xc,
        _data: 0x10,
        _times: 0x28,
        _duration: 0x40,
        _keyframeTimeOffset: 0x44,
        _componentChannels: 0x48,
        _channelOffsets: 0x4c,
        _interpolationMethod: 0x4f,
        _playMode: 0x54,
        _centerOfRotation: 0x60,
      },
      igGroup: { _childList: 0x38 },
      Entity: { _transform: 0x10, _parentIndex: 0x1c },
      tfbEntityInfo: { _drawables: 0x28, _entities: 0x30 },
      tfbBodyEntityInfo: { _flagBits: 0x38, _bounds: 0x40, _blendMatrixIndexLists: 0x48 },
      tfbSceneInfo: { _completeSceneGraph: 0x40 },
      tfbBodyInfo: { _combinerPrototype: 0x50, _visemePoses: 0x58, _entityInfo: 0x60 },
      tfbModelInfo: {
        _tfbBody: 0x28,
        _modelParameters: 0x30,
        _animationSet: 0x38,
        _stateData: 0x40,
        _attachList: 0x50,
      },
      ValueInfo: { _type: 0x38, _value: 0x40, _resetValue: 0x30 },
      OpSetValue: { _LHS: 0x38, _RHS: 0x40 },
      OpAbstractCreateVariable: {
        _varName: 0x38,
        _varContainerType: 0x40,
        _varContentsType: 0x48,
        _varIndex: 0x50,
      },
      OpAbstractDefinition: { _publicity: 0x34, _creationHandle: 0x38, _thisPC: 0x40, _scriptInfo: 0x48 },
      OpAbstractCheckValue: { _LHS: 0x38, _relOperator: 0x40, _RHS: 0x48 },
      BoneAttachInfo: {
        _boneName: 0x38,
        _boneIndex: 0x40,
        _exportsVisuals: 0x42,
        _transform: 0x44,
        _attachmentType: 0x5c,
      },
      igImage2: {
        _width: 0x40,
        _height: 0x42,
        _depth: 0x44,
        _levelCount: 0x46,
        _imageCount: 0x48,
        _format: 0x50,
        _data: 0x60,
        _colorScale: 0x20,
        _colorBias: 0x30,
      },
      igTextureAttr2: { _wrapS: 0x24, _wrapT: 0x28, _image: 0x38, _wrapR: 0x58 },
      igTextureBindAttr2: { _texture: 0x18, _unitID: 0x20 },
      tfbRuntimeMaterial: { _materialList: 0x28, _instanceAttrs: 0x40, _transforms: 0x48 },
      tfbTextureBindAttr: { _alphaTexture: 0x28, _data: 0x30 },
    };
    assert.equal(classes.size, 74);
    assert.equal(result.relativeRelocations, 114973);
    assert.equal(classes.get('ScriptStructure').size, 0x40);
    assert.equal(classes.get('ScriptSet').size, 0x38);
    assert.equal(
      classes.get('ScriptStructure').fields.some((f) => f.name === '_members'),
      false,
    );
    assert.equal(
      classes.get('ScriptSet').fields.some((f) => f.name === '_set'),
      false,
    );
    for (const name of ['_interface', '_unTyped']) {
      assert.equal(
        classes.get('ScriptStructure').fields.find((f) => f.name === name).metaConstructor,
        0xa55720,
      );
    }
    assert.equal(
      classes.get('ScriptStructure').fields.find((f) => f.name === '_fieldList').metaConstructor,
      0x589570,
    );
    assert.equal(classes.get('ScriptSet').fields.find((f) => f.name === '_list').metaConstructor, 0x589570);
    assert.equal(classes.get('ValueInfo').fields.find((f) => f.name === '_value').metaConstructor, 0x589680);
    assert.equal(classes.get('OpMacroParameter').parent, 'OpParameter');
    assert.deepEqual(
      result.enums.find((e) => e.name === 'MembershipTest').values,
      ['includes', 'excludes', 'intersects_with', 'includes_all'].map((name, value) => ({ name, value })),
    );
    const rhsFunctions = result.enums.find((e) => e.name === 'enumRHSfunc').values;
    assert.equal(rhsFunctions.length, 20);
    assert.equal(rhsFunctions.find((v) => v.name === 'kRHSfuncNone').value, 0);
    assert.equal(rhsFunctions.find((v) => v.name === 'kRHSfuncRandom').value, 1);
    assert.equal(rhsFunctions.find((v) => v.name === 'kRHSfuncArc_tangent').value, 16);
    assert.equal(
      result.enums
        .find((e) => e.name === 'IG_GFX_TEXTURE_FILTER')
        .values.find((v) => v.name === 'IG_GFX_TEXTURE_FILTER_LINEAR').value,
      1,
    );
    assert.equal(
      result.enums
        .find((e) => e.name === 'IG_GFX_TEXTURE_FILTER')
        .values.find((v) => v.name === 'IG_GFX_TEXTURE_FILTER_LINEAR_MIPMAP_LINEAR').value,
      5,
    );
    assert.deepEqual(
      result.enums.find((e) => e.name === 'Combiner').values,
      ['include', 'exclude', 'intersect_with', 'be_replaced_by', 'add', 'exclude_all'].map((name, value) => ({
        name,
        value,
      })),
    );
    assert.deepEqual(
      result.enums.find((e) => e.name === 'RelOp').values,
      ['LE_OP', 'EQ_OP', 'GE_OP', 'LT_OP', 'GT_OP', 'NE_OP'].map((name, value) => ({ name, value })),
    );
    assert.deepEqual(
      result.enums.find((e) => e.name === 'ArithOp').values,
      ['NO_OP', 'ADD_OP', 'SUB_OP', 'MULT_OP', 'DIV_OP'].map((name, i) => ({ name, value: i - 1 })),
    );
    assert.deepEqual(
      result.enums.find((e) => e.name === 'CollisionInfo._shapeType').values,
      ['SHAPE_NONE', 'SHAPE_BOX', 'SHAPE_CAPSULE', 'SHAPE_SPHERE', 'SHAPE_CYLINDER', 'SHAPE_MESH'].map(
        (name, value) => ({ name, value }),
      ),
    );
    assert.deepEqual(
      result.enums.find((e) => e.name === 'IG_GFX_TEXTURE_WRAP').values,
      ['CLAMP', 'REPEAT', 'REGION_CLAMP', 'REGION_REPEAT', 'BORDER'].map((name, value) => ({
        name: `IG_GFX_TEXTURE_WRAP_${name}`,
        value,
      })),
    );
    for (const [type, fields] of Object.entries(expected)) {
      const actual = new Map(classes.get(type).fields.map((f) => [f.name, f.offset]));
      for (const [name, offset] of Object.entries(fields))
        assert.equal(actual.get(name), offset, `${type}.${name}`);
    }
    for (const c of classes.values()) {
      assert.equal(c.fields.length, c.count);
      assert.ok(c.fields.every((f) => Number.isSafeInteger(f.metaConstructor) && f.metaConstructor > 0));
    }
    const child = spawnSync(process.execPath, ['tools/elf_metadata.mjs', executable], { encoding: 'utf8' });
    assert.equal(child.status, 0);
    assert.equal(child.stderr, '');
    assert.deepEqual(JSON.parse(child.stdout), result);
  },
);
