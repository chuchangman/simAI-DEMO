import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { scenarioWorld } from '@/features/viewer3d/dev-harness/scenarios';
import {
  GROUND_SHADOW_LIFT_M,
  GROUND_SHADOW_OPACITY_OBSERVED,
  GROUND_SHADOW_OPACITY_PREDICTED,
  GroundShadowLayer,
  hasValidGroundShadow,
} from '@/features/viewer3d/GroundShadowLayer';
import {
  DEFAULT_POST_PROCESSING,
  PostProcessingContext,
  PostProcessingLayer,
  readPostProcessingParam,
  resolvePostProcessing,
  withPostProcessingParam,
  type ViewerPostProcessingInput,
} from '@/features/viewer3d/PostProcessingLayer';
import {
  configureSurfaceSourceMap,
  sampleSurfaceSourceColor,
  SceneBackground,
  SURFACE_SOURCE_SHADING,
  surfaceSourceShade,
} from '@/features/viewer3d/scene/SceneBackground';
import {
  readCurrentScene,
  sceneStatusOf,
  SURFACE_SOURCE_VALUES,
  type ViewerSceneInput,
} from '@/features/viewer3d/scene/sceneContract';
import {
  configureSceneKtx2Loader,
  createSceneGltfLoader,
  createSceneStore,
  parseGltfScene,
  SCENE_KTX2_TRANSCODER_PATH,
  SceneLoaderContext,
  SceneStoreContext,
  SceneTextureLoaderContext,
  sceneVersionsOf,
  type SceneAssetLoader,
  type SceneStore,
  type SceneTextureLoader,
} from '@/features/viewer3d/scene/sceneStore';
import { VIEWER_GL_CONSTRAINTS } from '@/features/viewer3d/ViewerCanvas';
import { WorldScene } from '@/features/viewer3d/WorldScene';
import { createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { act, StrictMode, useEffect } from 'react';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// S15P31A101-360·404 배경 텍스처 무조명 재질·SURFACE_SOURCE_MAP 흐림·VALID 접지 그림자·후처리·압축 glb 로더 시험.

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const T0 = 1_760_342_400_000;
const committed = (patch: Record<string, unknown> = {}) => ({
  ok: true as const,
  raw: {
    scene_version: 'scene-demo-1',
    state: 'COMMITTED',
    default: false,
    calibration_version: 'cal-demo',
    committed_at_ms: T0,
    quality: null,
    gltf_url: 'https://bucket.example/scene-demo-1.glb?sig=1',
    gltf_expires_at_ms: Date.now() + 300_000,
    ...patch,
  },
});

let data: SpatialDataStore;
let scene: SceneStore;
let three: THREE.Scene | null = null;
let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let loadedRoot: THREE.Object3D;
let texCalls: string[];
let texMap: Record<string, THREE.Texture>;

const loader: SceneAssetLoader = () => Promise.resolve(loadedRoot);
const textureLoader: SceneTextureLoader = (url) => {
  texCalls.push(url);
  const found = texMap[url];
  return found ? Promise.resolve(found) : Promise.reject(new Error(`404 ${url}`));
};

function Probe() {
  const current = useThree((s) => s.scene);
  useEffect(() => {
    three = current;
  }, [current]);
  return null;
}

function fakeRenderer(canvas: HTMLCanvasElement) {
  return {
    render: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
    dispose: () => {},
    forceContextLoss: () => {},
    domElement: canvas,
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    xr: {
      enabled: false,
      isPresenting: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      setAnimationLoop: () => {},
    },
    renderLists: { dispose: () => {} },
    outputColorSpace: '',
    toneMapping: 0,
  };
}

/** JSON·바이너리 청크를 합쳐 GLB 2.0 ArrayBuffer 를 만든다. */
function packGlbBuffer(jsonDoc: Record<string, unknown>, binData: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(jsonDoc));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const binPad = (4 - (binData.byteLength % 4)) % 4;
  const jsonChunkLen = jsonBytes.byteLength + jsonPad;
  const binChunkLen = binData.byteLength + binPad;
  const totalLen = 12 + 8 + jsonChunkLen + 8 + binChunkLen;

  const buffer = new ArrayBuffer(totalLen);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Header: magic 'glTF' (0x46546C67), version 2, length
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLen, true);

  // JSON chunk (0x4E4F534A)
  view.setUint32(12, jsonChunkLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i += 1) {
    bytes[20 + jsonBytes.byteLength + i] = 0x20;
  }

  // BIN chunk (0x004E4942)
  const binOffset = 20 + jsonChunkLen;
  view.setUint32(binOffset, binChunkLen, true);
  view.setUint32(binOffset + 4, 0x004e4942, true);
  bytes.set(binData, binOffset + 8);
  return buffer;
}

/** 비압축 사각 바닥(Three 축 (0,0,0)..(4,0,-4) → World X·Y 0..4, Z 0) GLB 를 만든다. */
function buildUncompressedQuadGlb(): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 4, 0, 0, 4, 0, -4, 0, 0, -4]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const posBytes = new Uint8Array(positions.buffer);
  const uvBytes = new Uint8Array(uvs.buffer);
  const idxBytes = new Uint8Array(indices.buffer);

  const bin = new Uint8Array(posBytes.byteLength + uvBytes.byteLength + idxBytes.byteLength);
  bin.set(posBytes, 0);
  bin.set(uvBytes, posBytes.byteLength);
  bin.set(idxBytes, posBytes.byteLength + uvBytes.byteLength);

  return packGlbBuffer(
    {
      asset: { version: '2.0', generator: 'simai-test' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'textured_0000', mesh: 0 }],
      materials: [
        { name: 'observed_0000', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
      ],
      meshes: [
        {
          name: 'textured_0000',
          primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }],
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 4,
          type: 'VEC3',
          min: [0, 0, -4],
          max: [4, 0, 0],
        },
        { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
        { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength, target: 34962 },
        {
          buffer: 0,
          byteOffset: posBytes.byteLength,
          byteLength: uvBytes.byteLength,
          target: 34962,
        },
        {
          buffer: 0,
          byteOffset: posBytes.byteLength + uvBytes.byteLength,
          byteLength: idxBytes.byteLength,
          target: 34963,
        },
      ],
      buffers: [{ byteLength: bin.byteLength }],
    },
    bin,
  );
}

/** EXT_meshopt_compression 으로 압축된 같은 사각 바닥(Three 축 (0,0,0)..(4,0,-4)) GLB 를 만든다. */
function buildMeshoptCompressedQuadGlb(): ArrayBuffer {
  // MeshoptEncoder.encodeGltfBuffer 로 부호화한 4 정점(POSITION float32x3)·6 인덱스(TRIANGLES uint16) 바이트.
  const encodedAttributes = new Uint8Array([
    160, 0, 0, 1, 51, 0, 0, 0, 255, 255, 1, 51, 0, 0, 0, 128, 127, 0, 0, 0, 0, 0, 0, 1, 12, 0, 0, 0,
    255, 1, 12, 0, 0, 0, 127, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const encodedTriangles = new Uint8Array([
    225, 240, 0, 0, 118, 135, 86, 103, 120, 169, 134, 101, 137, 104, 152, 1, 105, 0, 0,
  ]);
  const attrPad = (4 - (encodedAttributes.byteLength % 4)) % 4;
  const triOffset = encodedAttributes.byteLength + attrPad;
  const bin = new Uint8Array(triOffset + encodedTriangles.byteLength);
  bin.set(encodedAttributes, 0);
  bin.set(encodedTriangles, triOffset);

  return packGlbBuffer(
    {
      asset: { version: '2.0', generator: 'simai-test-meshopt' },
      extensionsUsed: ['EXT_meshopt_compression'],
      extensionsRequired: ['EXT_meshopt_compression'],
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'textured_0000', mesh: 0 }],
      materials: [
        { name: 'observed_0000', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
      ],
      meshes: [
        {
          name: 'textured_0000',
          primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 4,
          type: 'VEC3',
          min: [0, 0, -4],
          max: [4, 0, 0],
        },
        { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
      ],
      bufferViews: [
        {
          buffer: 1,
          byteOffset: 0,
          byteLength: 48,
          byteStride: 12,
          extensions: {
            EXT_meshopt_compression: {
              buffer: 0,
              byteOffset: 0,
              byteLength: encodedAttributes.byteLength,
              byteStride: 12,
              count: 4,
              mode: 'ATTRIBUTES',
            },
          },
        },
        {
          buffer: 1,
          byteOffset: 48,
          byteLength: 12,
          extensions: {
            EXT_meshopt_compression: {
              buffer: 0,
              byteOffset: triOffset,
              byteLength: encodedTriangles.byteLength,
              byteStride: 2,
              count: 6,
              mode: 'TRIANGLES',
            },
          },
        },
      ],
      buffers: [
        { byteLength: bin.byteLength },
        {
          byteLength: 60,
          extensions: { EXT_meshopt_compression: { fallback: true } },
        },
      ],
    },
    bin,
  );
}

async function mountScene(options: { post?: ViewerPostProcessingInput } = {}) {
  const canvas = document.createElement('canvas');
  root = createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  await renderScene(options);
}

async function renderScene(options: { post?: ViewerPostProcessingInput } = {}) {
  const resolvedPost = resolvePostProcessing(options.post);
  await act(async () =>
    root!.render(
      <StrictMode>
        <SpatialDataContext value={data}>
          <SceneStoreContext value={scene}>
            <SceneLoaderContext value={loader}>
              <SceneTextureLoaderContext value={textureLoader}>
                <PostProcessingContext value={resolvedPost}>
                  <Probe />
                  <WorldScene />
                  <SceneBackground />
                  <GroundShadowLayer />
                  <PostProcessingLayer />
                </PostProcessingContext>
              </SceneTextureLoaderContext>
            </SceneLoaderContext>
          </SceneStoreContext>
        </SpatialDataContext>
      </StrictMode>,
    ),
  );
}

const find = (name: string) => three?.getObjectByName(name) ?? null;
const status = () => {
  const s = scene.getState();
  return sceneStatusOf(s.input, s.load, sceneVersionsOf(data.getState()));
};
const setInput = (input: ViewerSceneInput | null) =>
  act(async () => scene.getState().setInput(input));

let tick = 0;
const ingestWorld = (patch: Record<string, unknown> = {}) => {
  const message = scenarioWorld('normal', tick, T0) as { payload: Record<string, unknown> };
  data
    .getState()
    .ingest({ ...message, payload: { ...message.payload, ...patch } }, T0 + tick * 100 + 20);
  tick += 1;
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  tick = 0;
  texCalls = [];
  texMap = {};
  data = createSpatialDataStore();
  data.getState().reset('mock:normal:1');
  scene = createSceneStore();
  three = null;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.restoreAllMocks();
});

describe('S15P31A101-360·404 배경 텍스처·출처 맵·접지 그림자·후처리·압축 로더', () => {
  it('렌더러 출력 색공간은 SRGBColorSpace 이고 톤매핑은 NoToneMapping 이다', () => {
    expect(VIEWER_GL_CONSTRAINTS.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(VIEWER_GL_CONSTRAINTS.toneMapping).toBe(THREE.NoToneMapping);
  });

  it('배경 GLTFLoader 에 MeshoptDecoder 와 KTX2Loader(/basis/)가 설정되고 압축·비압축 glb 를 모두 읽는다', async () => {
    const gltfLoader = createSceneGltfLoader() as unknown as {
      meshoptDecoder: unknown;
      ktx2Loader: KTX2Loader & {
        transcoderPath: string;
        workerConfig: Record<string, boolean> | null;
      };
    };
    expect(gltfLoader.meshoptDecoder).toBe(MeshoptDecoder);
    expect(MeshoptDecoder.supported).toBe(true);
    expect(gltfLoader.ktx2Loader).toBeInstanceOf(KTX2Loader);
    expect(gltfLoader.ktx2Loader.transcoderPath).toBe(SCENE_KTX2_TRANSCODER_PATH);
    expect(gltfLoader.ktx2Loader.workerConfig).not.toBeNull();

    // WebGLRenderer 의 extensions 를 넘기면 하드웨어 압축 포맷 지원 여부를 KTX2Loader 에 반영한다
    const mockRendererWithBptc = {
      extensions: {
        has: (ext: string) =>
          ext === 'EXT_texture_compression_bptc' || ext === 'WEBGL_compressed_texture_s3tc',
        get: () => ({ getSupportedProfiles: () => [] }),
      },
    };
    const configuredKtx2 = configureSceneKtx2Loader(mockRendererWithBptc) as unknown as {
      transcoderPath: string;
      workerConfig: Record<string, boolean>;
    };
    expect(configuredKtx2.transcoderPath).toBe('/basis/');
    expect(configuredKtx2.workerConfig).toMatchObject({
      bptcSupported: true,
      dxtSupported: true,
      astcSupported: false,
    });

    // 1. 비압축 glb 해석 및 SceneBackground 적재 확인
    const uncompressedScene = await parseGltfScene(buildUncompressedQuadGlb());
    loadedRoot = uncompressedScene;
    ingestWorld();
    await mountScene();
    await setInput(committed({ scene_version: 'scene-uncompressed' }));
    await act(async () => {
      ingestWorld({ scene_version: 'scene-uncompressed' });
    });

    expect(status()).toMatchObject({ phase: 'LOADED', verification: 'VERIFIED', display: 'FULL' });
    expect(status().boundsWorld?.min.map((v) => +v.toFixed(4))).toEqual([0, 0, 0]);
    expect(status().boundsWorld?.max.map((v) => +v.toFixed(4))).toEqual([4, 4, 0]);

    // 2. EXT_meshopt_compression 압축 glb 해석 및 사진 텍스처·SURFACE_SOURCE_MAP·DIMMED 동작 확인
    const compressedScene = await parseGltfScene(buildMeshoptCompressedQuadGlb());
    const compressedMesh = compressedScene.getObjectByName('textured_0000') as THREE.Mesh;
    expect(compressedMesh).toBeInstanceOf(THREE.Mesh);
    expect(compressedMesh.geometry.getAttribute('position')?.count).toBe(4);
    expect(compressedMesh.geometry.index?.count).toBe(6);

    const ktx2LikeAlbedo = new THREE.CompressedTexture(
      [{ data: new Uint8Array(16), width: 4, height: 4 }],
      4,
      4,
    );
    compressedMesh.material = new THREE.MeshStandardMaterial({
      name: 'observed_0000',
      map: ktx2LikeAlbedo,
    });
    const sourceMapUrl = 'https://bucket.example/surface_source_0000.png';
    const sourceMapTex = new THREE.DataTexture(
      new Uint8Array([SURFACE_SOURCE_VALUES.OBSERVED, 0, 0, 255]),
      1,
      1,
    );
    texMap[sourceMapUrl] = sourceMapTex;
    loadedRoot = compressedScene;

    await setInput(
      committed({
        scene_version: 'scene-meshopt-404',
        gltf_url: 'https://bucket.example/scene-meshopt-404.glb?sig=1',
        surface_source_map_urls: { observed_0000: sourceMapUrl },
      }),
    );

    // 아직 world 의 scene_version 이 scene-uncompressed 라 MISMATCH 이므로 world 를 scene-meshopt-404 로 맞춘다
    await act(async () => {
      ingestWorld({ scene_version: 'scene-meshopt-404' });
    });
    expect(status()).toMatchObject({ phase: 'LOADED', verification: 'VERIFIED', display: 'FULL' });
    expect(status().boundsWorld?.min.map((v) => +v.toFixed(4))).toEqual([0, 0, 0]);
    expect(status().boundsWorld?.max.map((v) => +v.toFixed(4))).toEqual([4, 4, 0]);

    const preparedMat = compressedMesh.material as unknown as THREE.MeshBasicMaterial;
    expect(preparedMat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(preparedMat.toneMapped).toBe(false);
    expect(preparedMat.map).toBe(ktx2LikeAlbedo);
    expect(ktx2LikeAlbedo.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(preparedMat.userData.surfaceSourceMap).toBe(sourceMapTex);
    expect(sourceMapTex.minFilter).toBe(THREE.NearestFilter);
    expect(sourceMapTex.colorSpace).toBe(THREE.NoColorSpace);

    // 3. SIMAI_SCENE_MESH_SAMPLE 로 실제 변환 산출물(scene-mesh-404/textured.glb)을 주면 뷰어 로더·prepareSceneRoot·worldBoundsOf 로 직접 열어 검증한다
    const nodeProcess = (
      globalThis as {
        process?: {
          getBuiltinModule?: (id: string) => {
            existsSync(p: string): boolean;
            readFileSync(p: string): Uint8Array;
          };
          env?: Record<string, string | undefined>;
        };
      }
    ).process;
    const fsModule = nodeProcess?.getBuiltinModule?.('node:fs');
    // 실제 변환 산출물은 저장소에 두지 않는다. 경로를 환경 변수로 줄 때만 연다(CI 는 건너뜀)
    const realGlbPath = nodeProcess?.env?.SIMAI_SCENE_MESH_SAMPLE;
    if (realGlbPath && fsModule?.existsSync(realGlbPath)) {
      const ktx2 = configureSceneKtx2Loader();
      const loadSpy = vi.spyOn(ktx2, 'load').mockImplementation((_url, onLoad) => {
        const tex = new THREE.CompressedTexture(
          [{ data: new Uint8Array(16), width: 4096, height: 4096 }],
          4096,
          4096,
        );
        onLoad?.(tex);
        return tex;
      });
      try {
        const rawBytes = fsModule.readFileSync(realGlbPath);
        const arrayBuffer = new Uint8Array(rawBytes).buffer;
        const realScene = await parseGltfScene(arrayBuffer);
        let meshCount = 0;
        let totalFaces = 0;
        realScene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            meshCount += 1;
            const idxCount = obj.geometry.index?.count ?? 0;
            totalFaces += idxCount / 3;
          }
        });
        expect(meshCount).toBe(36);
        expect(totalFaces).toBe(395_730);
        loadedRoot = realScene;
        await setInput(
          committed({
            scene_version: 'scene-3ce8c02f-404',
            gltf_url: 'https://bucket.example/scene-3ce8c02f-404.glb?sig=1',
            surface_source_map_urls: { observed_0000: sourceMapUrl },
          }),
        );
        await act(async () => {
          ingestWorld({ scene_version: 'scene-3ce8c02f-404' });
        });
        expect(status()).toMatchObject({
          phase: 'LOADED',
          verification: 'VERIFIED',
          display: 'FULL',
        });
        const realBounds = status().boundsWorld!;
        expect(realBounds.max[0] - realBounds.min[0]).toBeGreaterThan(7.5);
        expect(realBounds.max[1] - realBounds.min[1]).toBeGreaterThan(7.5);
        expect(realBounds.max[2] - realBounds.min[2]).toBeGreaterThan(2.0);
        const unobserved = realScene.getObjectByName('unobserved_neutral') as
          THREE.Mesh | undefined;
        expect(unobserved).toBeInstanceOf(THREE.Mesh);
        expect(unobserved?.geometry.getAttribute('normal')).toBeDefined();
      } finally {
        loadSpy.mockRestore();
      }
    }
  });

  it('텍스처 있는 배경 메시는 MeshBasicMaterial(SRGB·toneMapped:false)로 바꾸고 무텍스처 메시는 기존 조명 재질과 법선을 유지한다', async () => {
    const group = new THREE.Group();
    const albedo = new THREE.DataTexture(new Uint8Array([200, 150, 100, 255]), 1, 1);
    const texturedMat = new THREE.MeshStandardMaterial({
      name: 'observed_0000',
      map: albedo,
    });
    const texturedMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 4), texturedMat);
    texturedMesh.name = 'textured_0000';

    // 법선 속성이 없는 무텍스처 회색 메시(세션 8 unobserved_neutral 재현)
    const untexturedGeo = new THREE.BufferGeometry();
    untexturedGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    const untexturedMat = new THREE.MeshStandardMaterial({
      name: 'unobserved_neutral',
      color: 0x808080,
    });
    const untexturedMesh = new THREE.Mesh(untexturedGeo, untexturedMat);
    untexturedMesh.name = 'unobserved_neutral';

    group.add(texturedMesh, untexturedMesh);
    loadedRoot = group;

    ingestWorld();
    await mountScene();
    await setInput(committed());

    const replacedTextured = texturedMesh.material as unknown as THREE.MeshBasicMaterial;
    expect(replacedTextured).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(replacedTextured.toneMapped).toBe(false);
    expect(replacedTextured.side).toBe(THREE.DoubleSide);
    expect(replacedTextured.map).toBe(albedo);
    expect(albedo.colorSpace).toBe(THREE.SRGBColorSpace);

    const preservedUntextured = untexturedMesh.material as THREE.MeshStandardMaterial;
    expect(preservedUntextured).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(untexturedMesh.geometry.getAttribute('normal')).toBeDefined();
  });

  it('DIMMED와 FULL에서 사진과 무텍스처 재질을 동일하게 유지한다', async () => {
    const group = new THREE.Group();
    const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const texturedMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 2),
      new THREE.MeshStandardMaterial({ map: albedo }),
    );
    const untexturedMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 2),
      new THREE.MeshStandardMaterial({ color: 0x808080 }),
    );
    group.add(texturedMesh, untexturedMesh);
    loadedRoot = group;

    await mountScene();
    // World 도착 전 COMMITTED Scene → UNCONFIRMED · DIMMED
    await setInput(committed());
    expect(status()).toMatchObject({ verification: 'UNCONFIRMED', display: 'DIMMED' });

    const texMat = texturedMesh.material as unknown as THREE.MeshBasicMaterial;
    const plainMat = untexturedMesh.material as THREE.MeshStandardMaterial;

    // 무텍스처 메시의 원래 재질을 유지한다
    expect([plainMat.transparent, plainMat.opacity]).toEqual([false, 1]);
    // 사진 텍스처의 원래 색과 불투명도를 유지한다
    expect([texMat.transparent, texMat.opacity]).toEqual([false, 1]);
    expect(texMat.color.r).toBeCloseTo(1, 5);

    // World 가 도착해 VERIFIED · FULL 이 되어도 재질은 같다
    await act(async () => ingestWorld());
    expect(status()).toMatchObject({ verification: 'VERIFIED', display: 'FULL' });
    expect([plainMat.transparent, plainMat.opacity]).toEqual([false, 1]);
    expect(texMat.color.r).toBeCloseTo(1, 5);
  });

  it('SURFACE_SOURCE_MAP 계약 입력·최근접 샘플링·값(0, 1, 2, 3, 미지 값)별 표시 규칙이 동작한다', async () => {
    // 1. 계약 검사: 배열·객체 허용, 잘못된 URL 거부
    const validList = readCurrentScene({
      ...committed().raw,
      surface_source_map_urls: ['https://bucket.example/source_0.png'],
    });
    expect(validList.ok).toBe(true);
    if (validList.ok) {
      expect(validList.scene.surfaceSourceMapUrls).toEqual(['https://bucket.example/source_0.png']);
    }
    const invalidUrl = readCurrentScene({
      ...committed().raw,
      surface_source_map_urls: ['javascript:alert(1)'],
    });
    expect(invalidUrl).toEqual({ ok: false, reason: 'surface_source_map_urls 형식이 틀렸다' });

    // 2. 최근접 샘플링(NearestFilter, mipmap 끔, NoColorSpace) 설정 확인
    const rawMap = new THREE.DataTexture(
      new Uint8Array([
        SURFACE_SOURCE_VALUES.UNOBSERVED,
        SURFACE_SOURCE_VALUES.INTERPOLATED,
        SURFACE_SOURCE_VALUES.OBSERVED,
        SURFACE_SOURCE_VALUES.ESTIMATED_PLANE,
      ]),
      2,
      2,
    );
    const albedo = new THREE.DataTexture(new Uint8Array([255, 200, 100, 255]), 1, 1);
    albedo.flipY = false;
    configureSurfaceSourceMap(rawMap, albedo);
    expect(rawMap.minFilter).toBe(THREE.NearestFilter);
    expect(rawMap.magFilter).toBe(THREE.NearestFilter);
    expect(rawMap.generateMipmaps).toBe(false);
    expect(rawMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(rawMap.flipY).toBe(false);

    // 3. 값(2=OBSERVED, 3=ESTIMATED_PLANE, 1=INTERPOLATED, 0=UNOBSERVED, 미지 값=99/-1)별 셰이딩 규칙 확인
    expect(surfaceSourceShade(2)).toEqual(SURFACE_SOURCE_SHADING.OBSERVED);
    expect(surfaceSourceShade(3)).toEqual(SURFACE_SOURCE_SHADING.ESTIMATED_PLANE);
    expect(surfaceSourceShade(1)).toEqual(SURFACE_SOURCE_SHADING.INTERPOLATED);
    expect(surfaceSourceShade(0)).toEqual(SURFACE_SOURCE_SHADING.UNOBSERVED);
    expect(surfaceSourceShade(4)).toEqual(SURFACE_SOURCE_SHADING.UNOBSERVED);
    expect(surfaceSourceShade(99)).toEqual(SURFACE_SOURCE_SHADING.UNOBSERVED);
    expect(surfaceSourceShade(-1)).toEqual(SURFACE_SOURCE_SHADING.UNOBSERVED);

    const baseRgb: [number, number, number] = [0.8, 0.6, 0.4];
    const colObserved = sampleSurfaceSourceColor(baseRgb, 2);
    const colPlane = sampleSurfaceSourceColor(baseRgb, 3);
    const colInterp = sampleSurfaceSourceColor(baseRgb, 1);
    const colUnobs = sampleSurfaceSourceColor(baseRgb, 0, 0);
    const colUnobsHatched = sampleSurfaceSourceColor(baseRgb, 0, 1);
    const colUnknown = sampleSurfaceSourceColor(baseRgb, 99, 0);

    // 2(OBSERVED)는 사진 그대로, 3(ESTIMATED_PLANE) > 1(INTERPOLATED) > 0(UNOBSERVED) > 0(빗금) 순으로 어두워진다
    expect(colObserved[0]).toBeCloseTo(0.8, 5);
    expect(colPlane[0]).toBeLessThan(colObserved[0]);
    expect(colInterp[0]).toBeLessThan(colPlane[0]);
    expect(colUnobs[0]).toBeLessThan(colInterp[0]);
    expect(colUnobsHatched[0]).toBeLessThan(colUnobs[0]);
    expect(colUnknown).toEqual(colUnobs);

    // 4. SceneBackground 에서 surface_source_map_urls 로부터 텍스처를 읽어 셰이더에 바인딩하는지 확인
    const mapUrl = 'https://bucket.example/source_0000.png';
    const loadedSourceTex = new THREE.DataTexture(new Uint8Array([2, 0, 0, 255]), 1, 1);
    texMap[mapUrl] = loadedSourceTex;

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 2),
      new THREE.MeshStandardMaterial({ name: 'observed_0000', map: albedo }),
    );
    group.add(mesh);
    loadedRoot = group;

    ingestWorld();
    await mountScene();
    await setInput(committed({ surface_source_map_urls: { observed_0000: mapUrl } }));

    expect(texCalls).toEqual([mapUrl]);
    const mat = mesh.material as unknown as THREE.MeshBasicMaterial;
    expect(mat.userData.surfaceSourceMap).toBe(loadedSourceTex);
    expect(loadedSourceTex.minFilter).toBe(THREE.NearestFilter);
    expect(loadedSourceTex.colorSpace).toBe(THREE.NoColorSpace);

    // onBeforeCompile 호출 시 셰이더 유니폼·프래그먼트 코드가 주입되는지 확인
    const fakeShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '',
      fragmentShader: 'void main() {\n#include <map_fragment>\n}',
    };
    mat.onBeforeCompile(fakeShader as never, {} as never);
    expect(fakeShader.uniforms.uSurfaceSourceMap?.value).toBe(loadedSourceTex);
    expect(fakeShader.uniforms.uSurfaceSourceEnabled?.value).toBe(1);
    expect(fakeShader.fragmentShader).toContain('uSurfaceSourceMap');
  });

  it('접지 VALID 인 사람에만 접지 그림자가 생기고, 불확실·미확인·inferred·UNKNOWN 에는 생기지 않는다', async () => {
    loadedRoot = new THREE.Group();
    await mountScene();

    // 1. crowd 시나리오: w-0101..w-0109 는 VALID 접지, w-0110 은 PELVIS(접지 미확인), w-0111 은 PREDICTED(무접지), w-0112 는 UNKNOWN
    await act(async () => {
      data.getState().ingest(scenarioWorld('crowd', 0, T0), T0 + 20);
    });

    const obsShadow = find('ground-shadow:w-0101') as THREE.Mesh | null;
    expect(obsShadow).not.toBeNull();
    expect(obsShadow!.position.y).toBeCloseTo(GROUND_SHADOW_LIFT_M, 5);
    expect((obsShadow!.material as THREE.MeshBasicMaterial).opacity).toBe(
      GROUND_SHADOW_OPACITY_OBSERVED,
    );

    // 골반만 있는 사람(w-0110), 무접지 예측(w-0111), UNKNOWN(w-0112)에는 그림자가 없다
    expect(find('ground-shadow:w-0110')).toBeNull();
    expect(find('ground-shadow:w-0111')).toBeNull();
    expect(find('ground-shadow:w-0112')).toBeNull();

    // 2. observation-loss 시나리오(tick 25): w-0001·w-0003 은 VALID 접지, w-0002 는 UNCERTAIN·inferred 접지
    await act(async () => {
      data.getState().reset('mock:observation-loss:1');
      data.getState().ingest(scenarioWorld('observation-loss', 25, T0), T0 + 2520);
    });
    expect(find('ground-shadow:w-0001')).not.toBeNull();
    expect(find('ground-shadow:w-0003')).not.toBeNull();
    expect(find('ground-shadow:w-0002')).toBeNull();

    // 3. 순수 판정 함수(hasValidGroundShadow)로 세부 조건(inferred, UNCERTAIN, PREDICTED+VALID, UNKNOWN) 검증
    const sampleTrack = data.getState().world!.tracks.find((t) => t.worldId === 'w-0001')!;
    expect(hasValidGroundShadow(sampleTrack)).toBe(true);
    expect(hasValidGroundShadow({ ...sampleTrack, observationState: 'PREDICTED' })).toBe(true);
    expect(hasValidGroundShadow({ ...sampleTrack, observationState: 'UNKNOWN' })).toBe(false);
    expect(hasValidGroundShadow({ ...sampleTrack, contactValidity: 'UNCERTAIN' })).toBe(false);
    expect(hasValidGroundShadow({ ...sampleTrack, zValidity: 'UNCERTAIN' })).toBe(false);
    expect(hasValidGroundShadow({ ...sampleTrack, supportSurfaceValidity: 'UNKNOWN' })).toBe(false);
    expect(hasValidGroundShadow({ ...sampleTrack, surfaceSource: 'inferred' })).toBe(false);
    expect(hasValidGroundShadow({ ...sampleTrack, groundAnchor: null })).toBe(false);
    expect(GROUND_SHADOW_OPACITY_PREDICTED).toBeLessThan(GROUND_SHADOW_OPACITY_OBSERVED);
  });

  it('후처리 옵션은 기본 off 이고 prop 및 쿼리 파라미터로 on/off 전환된다', async () => {
    expect(DEFAULT_POST_PROCESSING.enabled).toBe(false);
    expect(resolvePostProcessing(undefined).enabled).toBe(false);
    expect(resolvePostProcessing(false).enabled).toBe(false);
    expect(resolvePostProcessing(true)).toMatchObject({
      enabled: true,
      ao: true,
      smaa: true,
    });
    expect(resolvePostProcessing({ enabled: true, ao: false, smaa: true })).toMatchObject({
      enabled: true,
      ao: false,
      smaa: true,
    });
    expect(resolvePostProcessing({ enabled: true, ao: false, smaa: false }).enabled).toBe(false);

    expect(readPostProcessingParam('')).toBe(false);
    expect(readPostProcessingParam('?post=off')).toBe(false);
    expect(readPostProcessingParam('?post=on')).toBe(true);
    expect(withPostProcessingParam('http://localhost/?scene=default', true)).toBe(
      'http://localhost/?scene=default&post=on',
    );
    expect(withPostProcessingParam('http://localhost/?scene=default&post=on', false)).toBe(
      'http://localhost/?scene=default',
    );

    loadedRoot = new THREE.Group();
    await mountScene({ post: false });
    expect(find('post-processing-layer')).toBeNull();

    await renderScene({ post: true });
    const postLayer = find('post-processing-layer');
    expect(postLayer).not.toBeNull();
    expect(postLayer?.userData.postProcessing).toMatchObject({
      enabled: true,
      ao: true,
      smaa: true,
    });

    await renderScene({ post: false });
    expect(find('post-processing-layer')).toBeNull();
  });
});
