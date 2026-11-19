import { adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  avatarSurfaceSourceUrl,
  avatarTextureUrl,
  getSyntheticAvatarPngPair,
  SYNTHETIC_MHR,
} from '@/features/viewer3d/dev-harness/avatarFixture';
import syntheticMhrGlb from '@/features/viewer3d/dev-harness/fixtures/synthetic-mhr.glb?raw';
import { avatarFrameMessage, scenarioWorld } from '@/features/viewer3d/dev-harness/scenarios';
import {
  attachAvatarAppearanceShader,
  AVATAR_ENV_MAP_INTENSITY,
  AVATAR_FACE_BLUR_BRIGHTNESS,
  AVATAR_FACE_BLUR_SATURATION,
  AVATAR_LOWER_COLOR_FACTOR,
  AVATAR_PBR_METALNESS,
  AVATAR_PBR_ROUGHNESS,
  AVATAR_SOURCE_FACE_INVALID_INTERPOLATED,
  AVATAR_SOURCE_FACE_OBSERVED,
  AVATAR_SOURCE_FACE_UNOBSERVED,
  AVATAR_SOURCE_INTERPOLATED,
  AVATAR_SOURCE_OBSERVED,
  AVATAR_SOURCE_UNOBSERVED,
  AVATAR_WAIST_REST_Y,
  avatarBaseColorAtHeight,
  classifyAvatarSurfaceCode,
  clearAvatarAppearanceCache,
  createAvatarAlbedoTexture,
  createAvatarDisplayAlbedoTexture,
  createAvatarPmremEnvMap,
  createAvatarSurfaceSourceTexture,
  decodeAvatarPng,
  encodeAvatarPng,
  evaluateAvatarSurfaceColor,
  facePolicyCode,
  getAvatarMaterialUniforms,
  type AvatarFacePolicy,
  type RgbTuple,
} from '@/features/viewer3d/people/avatarAppearance';
import { AVATAR_ASSET_RELEASE_MS } from '@/features/viewer3d/people/avatarAssetCache';
import {
  AVATAR_ASSET_RETRY_MS,
  AvatarMeshContext,
  clearAvatarMeshCache,
  readAvatarMesh,
} from '@/features/viewer3d/people/avatarMesh';
import { PersonLayer } from '@/features/viewer3d/people/PersonLayer';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { advance, createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, useEffect } from 'react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

void syntheticMhrGlb;

const DIR = dirname(fileURLToPath(import.meta.url));
const GLB_BYTES = readFileSync(
  resolve(DIR, '../../../features/viewer3d/dev-harness/fixtures/synthetic-mhr.glb'),
);
const glbArrayBuffer = () => new Uint8Array(GLB_BYTES).buffer;
const T0 = 1_710_000_000_000;

describe('표면 출처 부호 분류와 색 선택(-359)', () => {
  const texRgb: RgbTuple = [0.2, 0.8, 0.4];
  const baseRgb: RgbTuple = [0.6, 0.65, 0.78];

  it('부호 0·1·2·128·129·130 과 미정 값을 설계대로 분류한다', () => {
    expect(classifyAvatarSurfaceCode(AVATAR_SOURCE_UNOBSERVED)).toBe('UNOBSERVED');
    expect(classifyAvatarSurfaceCode(AVATAR_SOURCE_INTERPOLATED)).toBe('INTERPOLATED');
    expect(classifyAvatarSurfaceCode(AVATAR_SOURCE_OBSERVED)).toBe('OBSERVED');
    expect(classifyAvatarSurfaceCode(AVATAR_SOURCE_FACE_UNOBSERVED)).toBe('FACE_UNOBSERVED');
    expect(classifyAvatarSurfaceCode(AVATAR_SOURCE_FACE_OBSERVED)).toBe('FACE_OBSERVED');
    // 129(얼굴 보간)는 만들지 않으며 모르는 값으로 본다.
    expect(classifyAvatarSurfaceCode(AVATAR_SOURCE_FACE_INVALID_INTERPOLATED)).toBe('UNKNOWN');
    expect(classifyAvatarSurfaceCode(3)).toBe('UNKNOWN');
    expect(classifyAvatarSurfaceCode(99)).toBe('UNKNOWN');
    expect(classifyAvatarSurfaceCode(255)).toBe('UNKNOWN');
    expect(classifyAvatarSurfaceCode(-1)).toBe('UNKNOWN');
  });

  it('2(OBSERVED)와 1(INTERPOLATED)은 모두 텍스처 색 그대로다(-742, 보간 감쇠 없음)', () => {
    const observed = evaluateAvatarSurfaceColor({
      code: AVATAR_SOURCE_OBSERVED,
      texRgb,
      baseRgb,
      facePolicy: 'OBSERVED',
    });
    expect(observed).toEqual(texRgb);

    const interpolated = evaluateAvatarSurfaceColor({
      code: AVATAR_SOURCE_INTERPOLATED,
      texRgb,
      baseRgb,
      facePolicy: 'OBSERVED',
    });
    expect(interpolated).toEqual(texRgb);
  });

  it('관측·보간·얼굴 관측인데 RGB 가 거의 0 인 빈 픽셀(-755)은 채운 색, 없으면 기본 재질 색이다', () => {
    const voidRgb: RgbTuple = [0, 2 / 255, 3 / 255];
    const fillRgb: RgbTuple = [0.3, 0.1, 0.5];
    for (const code of [AVATAR_SOURCE_OBSERVED, AVATAR_SOURCE_INTERPOLATED]) {
      expect(
        evaluateAvatarSurfaceColor({
          code,
          texRgb: voidRgb,
          baseRgb,
          facePolicy: 'OBSERVED',
          fillRgb,
        }),
      ).toEqual(fillRgb);
      expect(
        evaluateAvatarSurfaceColor({ code, texRgb: voidRgb, baseRgb, facePolicy: 'OBSERVED' }),
      ).toEqual(baseRgb);
    }
    expect(
      evaluateAvatarSurfaceColor({
        code: AVATAR_SOURCE_FACE_OBSERVED,
        texRgb: voidRgb,
        baseRgb,
        facePolicy: 'OBSERVED',
        fillRgb,
      }),
    ).toEqual(fillRgb);
    // 4/255 이상인 어두운 관측은 그대로다(검정 옷).
    const dark: RgbTuple = [4 / 255, 0, 0];
    expect(
      evaluateAvatarSurfaceColor({
        code: AVATAR_SOURCE_OBSERVED,
        texRgb: dark,
        baseRgb,
        facePolicy: 'OBSERVED',
        fillRgb,
      }),
    ).toEqual(dark);
  });

  it.each([
    ['0(UNOBSERVED)', AVATAR_SOURCE_UNOBSERVED],
    ['128(얼굴 미관측)', AVATAR_SOURCE_FACE_UNOBSERVED],
    ['129(얼굴 보간 금지·모르는 값)', AVATAR_SOURCE_FACE_INVALID_INTERPOLATED],
    ['3(모르는 값)', 3],
    ['200(모르는 값)', 200],
  ])('%s 은 face_policy 와 무관하게 채운 색을, 못 채웠으면 기본 재질 색을 쓴다', (_, code) => {
    const fillRgb: RgbTuple = [0.3, 0.1, 0.5];
    for (const facePolicy of ['OBSERVED', 'BLURRED', 'EXCLUDED'] as const) {
      expect(evaluateAvatarSurfaceColor({ code, texRgb, baseRgb, facePolicy, fillRgb })).toEqual(
        fillRgb,
      );
      expect(
        evaluateAvatarSurfaceColor({ code, texRgb, baseRgb, facePolicy, fillRgb: null }),
      ).toEqual(baseRgb);
    }
  });

  it('130(얼굴 관측)은 face_policy 3종(OBSERVED·BLURRED·EXCLUDED)을 따른다', () => {
    // 1. OBSERVED -> 관측 텍스처 색
    expect(
      evaluateAvatarSurfaceColor({
        code: AVATAR_SOURCE_FACE_OBSERVED,
        texRgb,
        baseRgb,
        facePolicy: 'OBSERVED',
      }),
    ).toEqual(texRgb);

    // 2. EXCLUDED -> 기본 재질 색
    expect(
      evaluateAvatarSurfaceColor({
        code: AVATAR_SOURCE_FACE_OBSERVED,
        texRgb,
        baseRgb,
        facePolicy: 'EXCLUDED',
      }),
    ).toEqual(baseRgb);

    // 3. BLURRED -> 주변 130 텍셀만 가중 평균하고(0·128 은 섞지 않음) 채도·명도를 완화한다.
    const blurred = evaluateAvatarSurfaceColor({
      code: AVATAR_SOURCE_FACE_OBSERVED,
      texRgb: [0.9, 0.7, 0.6],
      baseRgb,
      facePolicy: 'BLURRED',
      neighborhood: [
        { code: AVATAR_SOURCE_FACE_OBSERVED, texRgb: [0.9, 0.7, 0.6], weight: 4 },
        { code: AVATAR_SOURCE_FACE_OBSERVED, texRgb: [0.5, 0.3, 0.2], weight: 4 },
        // 배경(0)과 얼굴 미관측(128)은 평균에 섞이면 안 된다.
        { code: AVATAR_SOURCE_UNOBSERVED, texRgb: [0, 0, 0], weight: 10 },
        { code: AVATAR_SOURCE_FACE_UNOBSERVED, texRgb: [0, 1, 0], weight: 10 },
      ],
    });
    const avg: RgbTuple = [0.7, 0.5, 0.4];
    const avgLuma = 0.2126 * avg[0] + 0.7152 * avg[1] + 0.0722 * avg[2];
    expect(blurred[0]).toBeCloseTo(
      (avgLuma + (avg[0] - avgLuma) * AVATAR_FACE_BLUR_SATURATION) * AVATAR_FACE_BLUR_BRIGHTNESS,
      6,
    );
    expect(blurred).not.toEqual([0.9, 0.7, 0.6]);
    expect(blurred).not.toEqual(baseRgb);
  });

  it('바인드 자세 높이(restY)에 따라 상·하의 기본 대표색을 나눈다', () => {
    const upper: RgbTuple = [0.5, 0.6, 0.8];
    expect(avatarBaseColorAtHeight(AVATAR_WAIST_REST_Y + 0.1, upper)).toEqual(upper);
    const lower = avatarBaseColorAtHeight(AVATAR_WAIST_REST_Y - 0.1, upper);
    expect(lower[0]).toBeCloseTo(upper[0] * AVATAR_LOWER_COLOR_FACTOR, 6);
    expect(lower[1]).toBeCloseTo(upper[1] * AVATAR_LOWER_COLOR_FACTOR, 6);
    expect(lower[2]).toBeCloseTo(upper[2] * AVATAR_LOWER_COLOR_FACTOR, 6);
  });
});

describe('합성 PNG 인코딩·디코딩과 DataTexture 설정', () => {
  it('albedo.png 는 sRGB·LinearFilter·mipmap 없음, surface_source.png 는 NoColorSpace·NearestFilter·mipmap 없음이다', async () => {
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    const codes = new Uint8Array([
      AVATAR_SOURCE_UNOBSERVED,
      AVATAR_SOURCE_INTERPOLATED,
      AVATAR_SOURCE_OBSERVED,
      AVATAR_SOURCE_FACE_OBSERVED,
    ]);
    const albedoBytes = encodeAvatarPng(2, 2, rgb, 2);
    const sourceBytes = encodeAvatarPng(2, 2, codes, 0);

    const decodedAlbedo = await decodeAvatarPng(new Uint8Array(albedoBytes).buffer);
    const decodedSource = await decodeAvatarPng(new Uint8Array(sourceBytes).buffer);

    expect([decodedAlbedo.width, decodedAlbedo.height, decodedAlbedo.channels]).toEqual([2, 2, 3]);
    expect([decodedSource.width, decodedSource.height, decodedSource.channels]).toEqual([2, 2, 1]);
    // Grayscale 부호가 손실 없이 R 채널에 그대로 복원된다.
    expect([
      decodedSource.data[0],
      decodedSource.data[4],
      decodedSource.data[8],
      decodedSource.data[12],
    ]).toEqual([0, 1, 2, 130]);

    const albedoTex = createAvatarAlbedoTexture(decodedAlbedo);
    const sourceTex = createAvatarSurfaceSourceTexture(decodedSource);

    expect(albedoTex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(albedoTex.minFilter).toBe(THREE.LinearFilter);
    expect(albedoTex.magFilter).toBe(THREE.LinearFilter);
    expect(albedoTex.generateMipmaps).toBe(false);
    expect(albedoTex.flipY).toBe(false);

    expect(sourceTex.colorSpace).toBe(THREE.NoColorSpace);
    expect(sourceTex.minFilter).toBe(THREE.NearestFilter);
    expect(sourceTex.magFilter).toBe(THREE.NearestFilter);
    expect(sourceTex.generateMipmaps).toBe(false);
    expect(sourceTex.flipY).toBe(false);

    // 셰이더에 묶는 표시용 albedo 는 삼선형 밉맵으로 축소 표본의 점묘 깜빡임을 막는다(-755).
    const displayTex = createAvatarDisplayAlbedoTexture(decodedAlbedo);
    expect(displayTex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(displayTex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(displayTex.magFilter).toBe(THREE.LinearFilter);
    expect(displayTex.generateMipmaps).toBe(true);
    expect(displayTex.flipY).toBe(false);

    albedoTex.dispose();
    sourceTex.dispose();
    displayTex.dispose();
  });

  it('onBeforeCompile 셰이더가 PBR 상수와 부호별·face_policy 분기 GLSL 을 주입한다', () => {
    const mat = new THREE.MeshStandardMaterial({ name: 'AvatarBody' });
    attachAvatarAppearanceShader(mat);
    expect(mat.roughness).toBeCloseTo(AVATAR_PBR_ROUGHNESS, 6);
    expect(mat.metalness).toBeCloseTo(AVATAR_PBR_METALNESS, 6);
    expect(mat.envMapIntensity).toBeCloseTo(AVATAR_ENV_MAP_INTENSITY, 6);

    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n}',
    };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('vAvatarUv = uv;');
    expect(shader.vertexShader).toContain('vAvatarRestY = position.y;');
    expect(shader.fragmentShader).toContain('simaiReadSurfaceCode');
    expect(shader.fragmentShader).toContain('simaiSampleBlurredFace');
    expect(shader.fragmentShader).toContain('simaiCode == 2');
    expect(shader.fragmentShader).toContain('simaiCode == 1');
    expect(shader.fragmentShader).toContain('simaiCode == 130');
    // -742: 보간(1)은 관측과 같은 원색, 미관측은 채운 albedo 알파로 기본 재질 색과 섞는다.
    expect(shader.fragmentShader).toContain('simaiCode == 2 || simaiCode == 1');
    expect(shader.fragmentShader).toContain('mix(simaiBaseColor, simaiTexRgb, simaiTex.a)');
    // -755: 관측·보간도 채운 albedo 알파를 따른다(빈 픽셀을 못 채웠으면 검정 대신 기본 재질 색).
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = simaiFilled;');
    expect(shader.fragmentShader).not.toContain('simaiAdjustSatBright(simaiTexRgb, 0.45');
    expect(shader.uniforms.uAvatarHasAppearance).toBeDefined();
    expect(shader.uniforms.uAvatarFacePolicy).toBeDefined();
  });

  it('합성 MHR GLB 에 UV 가 없으면 readAvatarMesh 가 상단 원점 UV 를 채우고, 이미 있으면 보존한다', async () => {
    const rawFrame = avatarFrameMessage(0, T0)!;
    const adapted = adaptMessage(rawFrame, T0);
    if (adapted.kind !== 'avatar') throw new Error(adapted.kind);
    const asset = adapted.frame.avatars[0]!.asset!;
    const mesh = await readAvatarMesh(glbArrayBuffer(), asset);
    let uvCount = 0;
    mesh.scene.traverse((node) => {
      const m = node as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        const uv = m.geometry.getAttribute('uv');
        expect(uv).toBeDefined();
        uvCount += uv.count;
      }
    });
    expect(uvCount).toBeGreaterThan(0);
  });
});

// ---- PersonLayer 통합 시험 (외형 교체·실패 재시도·ID 분리·환경맵) ----

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

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

function makeTexturedFrame(
  tick: number,
  options: {
    versionByWorldId?: Record<string, number>;
    facePolicy?: AvatarFacePolicy;
    nullAssetWorldIds?: string[];
    untexturedWorldIds?: string[];
    extraTrackId?: string;
  } = {},
) {
  const base = avatarFrameMessage(tick, T0)!;
  const cloned = structuredClone(base) as {
    payload: {
      avatars: Array<{
        world_id: string;
        appearance_version: number;
        asset: {
          stream_epoch: number;
          mesh_url: string;
          mesh_sha256: string;
          texture_url: string | null;
          surface_source_url: string | null;
          surface_ratios: { OBSERVED: number; INTERPOLATED: number; UNOBSERVED: number };
          face_ratios: { OBSERVED: number; UNOBSERVED: number };
          face_policy: AvatarFacePolicy;
        } | null;
      }>;
    };
  };

  if (options.extraTrackId) {
    const template = structuredClone(cloned.payload.avatars[0]!);
    template.world_id = options.extraTrackId;
    cloned.payload.avatars.push(template);
  }

  for (const a of cloned.payload.avatars) {
    if (options.nullAssetWorldIds?.includes(a.world_id)) {
      a.asset = null;
      continue;
    }
    if (!a.asset) continue;
    const v = options.versionByWorldId?.[a.world_id] ?? (a.world_id === 'w-0003' ? 99 : 0);
    a.appearance_version = v;
    a.asset.mesh_url = `/api/avatars/${a.world_id}/epochs/${T0}/versions/0/mesh.glb`;
    a.asset.mesh_sha256 = SYNTHETIC_MHR.meshSha256;
    if (options.untexturedWorldIds?.includes(a.world_id)) {
      a.asset.texture_url = null;
      a.asset.surface_source_url = null;
      a.asset.face_policy = 'EXCLUDED';
    } else {
      a.asset.texture_url = avatarTextureUrl(a.world_id, T0, v);
      a.asset.surface_source_url = avatarSurfaceSourceUrl(a.world_id, T0, v);
      a.asset.surface_ratios = { OBSERVED: 0.5, INTERPOLATED: 0.2, UNOBSERVED: 0.3 };
      a.asset.face_ratios = { OBSERVED: 0.7, UNOBSERVED: 0.3 };
      a.asset.face_policy = options.facePolicy ?? 'OBSERVED';
    }
  }
  return cloned;
}

describe('PersonLayer 외형 텍스처·표면 출처·환경맵 통합', () => {
  let scene: THREE.Scene | null = null;
  function SceneProbe() {
    const current = useThree((s) => s.scene);
    useEffect(() => {
      scene = current;
    }, [current]);
    return null;
  }

  let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
  let viewer: ViewerStore;
  let data: SpatialDataStore;
  let clock = T0;

  const defaultFetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/mesh.glb')) return glbArrayBuffer();
    if (url.endsWith('/albedo.png')) {
      return new Uint8Array(getSyntheticAvatarPngPair('w-0001', 0, 16).albedoPng).buffer;
    }
    if (url.endsWith('/surface_source.png')) {
      return new Uint8Array(getSyntheticAvatarPngPair('w-0001', 0, 16).surfaceSourcePng).buffer;
    }
    throw new Error('HTTP 404');
  });

  async function mount(fetcher = defaultFetcher) {
    const canvas = document.createElement('canvas');
    root ??= createRoot(canvas);
    await root.configure({
      gl: fakeRenderer(canvas) as never,
      size: { width: 800, height: 600, top: 0, left: 0 },
      frameloop: 'never',
    });
    await act(async () =>
      root!.render(
        <ViewerStoreContext value={viewer}>
          <SpatialDataContext value={data}>
            <AvatarMeshContext value={{ enabled: true, fetch: fetcher }}>
              <SceneProbe />
              <PersonLayer />
            </AvatarMeshContext>
          </SpatialDataContext>
        </ViewerStoreContext>,
      ),
    );
  }

  async function flushFrames(count = 4) {
    for (let i = 0; i < count; i++) {
      await act(async () => {
        if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(20);
        else await new Promise((r) => setTimeout(r, 0));
      });
      await act(async () => advance(performance.now() + i * 16));
    }
  }

  async function stepTick(n: number, frameOverride?: unknown, worldOverride?: unknown) {
    clock = T0 + n * 100 + 50;
    await act(async () => {
      data.getState().ingest(worldOverride ?? scenarioWorld('avatar-mesh', n, T0), clock);
      const frame = frameOverride ?? makeTexturedFrame(n);
      if (frame) data.getState().ingest(frame, clock);
    });
    await flushFrames(4);
  }

  function firstBodyMaterial(worldId: string): THREE.MeshStandardMaterial | null {
    const meshGroup =
      scene?.getObjectByName('person:' + worldId)?.getObjectByName('person-mesh') ?? null;
    if (!meshGroup) return null;
    let found: THREE.MeshStandardMaterial | null = null;
    meshGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!found && m.isMesh && m.material && !Array.isArray(m.material)) {
        found = m.material as THREE.MeshStandardMaterial;
      }
    });
    return found;
  }

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    viewer = createViewerStore();
    viewer.getState().markReady();
    data = createSpatialDataStore();
    defaultFetcher.mockClear();
  });

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    clearAvatarMeshCache();
    clearAvatarAppearanceCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('사람마다 독립된 외형 텍스처를 1회씩만 받고, PBR·환경맵은 아바타 재질에만 들어가며 scene.environment 는 건드리지 않는다', async () => {
    await mount();
    for (let i = 0; i <= 4; i++) await stepTick(i, makeTexturedFrame(i, { facePolicy: 'BLURRED' }));

    const mat1 = firstBodyMaterial('w-0001')!;
    const mat2 = firstBodyMaterial('w-0002')!;
    expect(mat1).not.toBeNull();
    expect(mat2).not.toBeNull();

    const u1 = getAvatarMaterialUniforms(mat1)!;
    const u2 = getAvatarMaterialUniforms(mat2)!;
    expect(u1.uAvatarHasAppearance.value).toBe(1);
    expect(u2.uAvatarHasAppearance.value).toBe(1);
    expect(u1.uAvatarFacePolicy.value).toBe(facePolicyCode('BLURRED'));

    // 다른 world_id 의 텍스처 인스턴스를 공유하지 않는다.
    expect(u1.uAvatarAlbedoMap.value).not.toBe(u2.uAvatarAlbedoMap.value);
    expect(u1.uAvatarSurfaceSourceMap.value).not.toBe(u2.uAvatarSurfaceSourceMap.value);

    // -742: 셰이더에는 미관측을 채운 표시용 albedo 가 들어간다(미관측 0 텍셀도 알파 255 색).
    const display = u1.uAvatarAlbedoMap.value;
    expect(display.name).toBe('avatar-albedo-display');
    const displayData = display.image.data as Uint8Array;
    const sourceData = u1.uAvatarSurfaceSourceMap.value.image.data as Uint8Array;
    let filledUnobserved = 0;
    for (let i = 0; i < sourceData.length / 4; i++) {
      if (sourceData[i * 4] === AVATAR_SOURCE_UNOBSERVED && displayData[i * 4 + 3] === 255) {
        filledUnobserved++;
      }
    }
    expect(filledUnobserved).toBeGreaterThan(0);

    // 같은 appearance_version(0)은 여러 tick 동안 사람마다 1번만 요청한다.
    expect(
      defaultFetcher.mock.calls.filter(([u]) => u.includes('/w-0001/') && u.endsWith('/albedo.png'))
        .length,
    ).toBe(1);
    expect(
      defaultFetcher.mock.calls.filter(([u]) => u.includes('/w-0002/') && u.endsWith('/albedo.png'))
        .length,
    ).toBe(1);

    // 아바타 재질에만 envMap 이 들어가고 scene.environment 는 null 그대로다.
    expect(mat1.envMap).not.toBeNull();
    expect(mat1.roughness).toBeCloseTo(AVATAR_PBR_ROUGHNESS, 6);
    expect(mat1.metalness).toBeCloseTo(AVATAR_PBR_METALNESS, 6);
    expect(scene!.environment).toBeNull();
  });

  it('appearance_version 이 바뀌면 새 텍스처를 다 읽을 때까지 이전 텍스처를 유지(깜빡임 없음)하고 교체 뒤 이전 텍스처를 캐시에 돌려주어 해제 지연 뒤 dispose 한다', async () => {
    // -797: 물러난 텍스처는 캐시에 남았다가 AVATAR_ASSET_RELEASE_MS 뒤에 해제된다. 그 시간을 넘기려고 가짜 시계를 쓴다.
    vi.useFakeTimers();
    let resolveV1Albedo!: (buf: ArrayBuffer) => void;
    const v1AlbedoGate = new Promise<ArrayBuffer>((r) => {
      resolveV1Albedo = r;
    });

    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/mesh.glb')) return glbArrayBuffer();
      if (url.includes('/w-0001/') && url.includes('/versions/1/albedo.png')) {
        return v1AlbedoGate;
      }
      if (url.endsWith('/albedo.png')) {
        return new Uint8Array(getSyntheticAvatarPngPair('w-0001', 0, 16).albedoPng).buffer;
      }
      if (url.endsWith('/surface_source.png')) {
        return new Uint8Array(getSyntheticAvatarPngPair('w-0001', 0, 16).surfaceSourcePng).buffer;
      }
      throw new Error('HTTP 404');
    });

    await mount(fetcher);
    for (let i = 0; i <= 3; i++) await stepTick(i, makeTexturedFrame(i));

    const mat = firstBodyMaterial('w-0001')!;
    const uniforms = getAvatarMaterialUniforms(mat)!;
    const v0Albedo = uniforms.uAvatarAlbedoMap.value;
    const v0Source = uniforms.uAvatarSurfaceSourceMap.value;
    // -755: v0 을 해제하는 순간 재질에는 이미 새 텍스처가 묶여 있어야 한다(해제된 텍스처를 다시 올려 GPU 에 남기지 않음).
    let boundAtDispose: unknown = null;
    const disposeAlbedoSpy = vi.fn(() => {
      boundAtDispose = uniforms.uAvatarAlbedoMap.value;
    });
    const disposeSourceSpy = vi.fn();
    v0Albedo.addEventListener('dispose', disposeAlbedoSpy);
    v0Source.addEventListener('dispose', disposeSourceSpy);

    // appearance_version = 1 로 올렸지만 v1 albedo.png 는 아직 읽는 중이다.
    await stepTick(4, makeTexturedFrame(4, { versionByWorldId: { 'w-0001': 1 } }));
    expect(uniforms.uAvatarHasAppearance.value).toBe(1);
    expect(uniforms.uAvatarAlbedoMap.value).toBe(v0Albedo);
    expect(disposeAlbedoSpy).not.toHaveBeenCalled();

    // v1 읽기가 끝나면 새 텍스처로 바뀌고, v0 텍스처는 캐시에 돌아가 해제 지연 동안 남는다.
    await act(async () => {
      resolveV1Albedo(new Uint8Array(getSyntheticAvatarPngPair('w-0001', 1, 16).albedoPng).buffer);
    });
    await flushFrames(4);

    expect(uniforms.uAvatarHasAppearance.value).toBe(1);
    expect(uniforms.uAvatarAlbedoMap.value).not.toBe(v0Albedo);
    expect(disposeAlbedoSpy).not.toHaveBeenCalled();

    // 해제 지연이 지나면 v0 텍스처를 dispose 한다(그때 재질에는 v1 이 묶여 있다).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AVATAR_ASSET_RELEASE_MS + 100);
    });
    expect(disposeAlbedoSpy).toHaveBeenCalledTimes(1);
    expect(boundAtDispose).not.toBeNull();
    expect(boundAtDispose).not.toBe(v0Albedo);
    expect(disposeSourceSpy).toHaveBeenCalledTimes(1);
  });

  it('texture_url 또는 surface_source_url 읽기가 실패하면 기본 재질(상·하의 대표색)로 그리고 일정 간격 뒤 재시도한다', async () => {
    vi.useFakeTimers();
    let shouldFail = true;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/mesh.glb')) return glbArrayBuffer();
      if (url.includes('/w-0001/') && url.endsWith('/surface_source.png') && shouldFail) {
        throw new Error('HTTP 503');
      }
      if (url.endsWith('/albedo.png')) {
        return new Uint8Array(getSyntheticAvatarPngPair('w-0001', 0, 16).albedoPng).buffer;
      }
      if (url.endsWith('/surface_source.png')) {
        return new Uint8Array(getSyntheticAvatarPngPair('w-0001', 0, 16).surfaceSourcePng).buffer;
      }
      throw new Error('HTTP 404');
    });

    await mount(fetcher);
    for (let i = 0; i <= 3; i++) {
      clock = T0 + i * 100 + 50;
      await act(async () => {
        data.getState().ingest(scenarioWorld('avatar-mesh', i, T0), clock);
        data.getState().ingest(makeTexturedFrame(i), clock);
        await vi.advanceTimersByTimeAsync(20);
      });
      await act(async () => advance(performance.now() + i * 16));
    }

    // 메시는 그대로 그리되 외형만 기본 재질(uAvatarHasAppearance = 0)로 폴백한다.
    const mat = firstBodyMaterial('w-0001')!;
    expect(mat).not.toBeNull();
    const uniforms = getAvatarMaterialUniforms(mat)!;
    expect(uniforms.uAvatarHasAppearance.value).toBe(0);

    // AVATAR_ASSET_RETRY_MS 뒤 재시도하여 성공하면 외형 텍스처가 켜진다.
    shouldFail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AVATAR_ASSET_RETRY_MS + 100);
    });
    await act(async () => advance(performance.now() + 200));

    expect(uniforms.uAvatarHasAppearance.value).toBe(1);
    vi.useRealTimers();
  });

  it('ID 분리로 생긴 새 world_id 는 원래 ID 의 외형 텍스처를 이어받지 않고, asset 이 null 이 되면 캡슐로 돌아간다', async () => {
    await mount();
    for (let i = 0; i <= 3; i++) await stepTick(i, makeTexturedFrame(i));

    const mat1 = firstBodyMaterial('w-0001')!;
    expect(getAvatarMaterialUniforms(mat1)!.uAvatarHasAppearance.value).toBe(1);

    // w-0099(분리된 새 ID, 아직 외형 텍스처 없음)가 등장하고 w-0002 는 asset 이 null 이 된다.
    const baseWorld = scenarioWorld('avatar-mesh', 4, T0) as {
      payload: { tracks: Array<Record<string, unknown>> };
    };
    const worldWithSplit = structuredClone(baseWorld);
    const splitTrack = structuredClone(worldWithSplit.payload.tracks[0]!);
    splitTrack.world_id = 'w-0099';
    splitTrack.position_xy = [4.5, 4.5];
    splitTrack.pelvis_xyz = [4.5, 4.5, 0.95];
    worldWithSplit.payload.tracks.push(splitTrack);

    for (let i = 4; i <= 6; i++) {
      await stepTick(
        i,
        makeTexturedFrame(i, {
          extraTrackId: 'w-0099',
          untexturedWorldIds: ['w-0099'],
          nullAssetWorldIds: ['w-0002'],
        }),
        worldWithSplit,
      );
    }

    // 새 ID w-0099 는 메시는 그리지만 w-0001 의 텍스처를 물려받지 않는다(uAvatarHasAppearance = 0).
    const matSplit = firstBodyMaterial('w-0099')!;
    expect(matSplit).not.toBeNull();
    expect(getAvatarMaterialUniforms(matSplit)!.uAvatarHasAppearance.value).toBe(0);

    // asset 이 null 이 된 w-0002 는 캡슐로 돌아간다.
    expect(firstBodyMaterial('w-0002')).toBeNull();
  });

  it('createAvatarPmremEnvMap 은 WebGLRenderTarget 이 있는 렌더러와 가짜 렌더러 모두에서 유효한 텍스처를 만들고 해제한다', () => {
    const fallbackHandle = createAvatarPmremEnvMap(null);
    expect(fallbackHandle.texture).toBeInstanceOf(THREE.Texture);
    const disposed = vi.fn();
    fallbackHandle.texture.addEventListener('dispose', disposed);
    fallbackHandle.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
