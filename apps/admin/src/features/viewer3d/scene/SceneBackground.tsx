import { CAMERA_VDT_FADE_MS, createFpsGuard } from '@/features/viewer3d/cameras/cameraView';
import { useSpatialData } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  IDLE_LOAD,
  readCurrentScene,
  sceneStatusOf,
  SURFACE_SOURCE_VALUES,
  type CurrentScene,
  type SceneDisplay,
  type SurfaceSourceMapUrls,
} from '@/features/viewer3d/scene/sceneContract';
import {
  configureSceneKtx2Loader,
  SceneLoaderContext,
  SceneStoreContext,
  SceneTextureLoaderContext,
  SceneVdtTextureLoaderContext,
  type SceneStore,
  type SceneTextureLoader,
} from '@/features/viewer3d/scene/sceneStore';
import {
  applyMapCamerasToVdtCameras,
  convertVdtCameraToThree,
  readSceneMapCamerasFromObject3D,
  withVdtCameraImages,
} from '@/features/viewer3d/scene/vdtMath';
import {
  bakeVdtShadowMaps,
  collectVdtMeshes,
  mountVdtOnSceneRoot,
  type BakedShadowMaps,
  type MountedVdtScene,
} from '@/features/viewer3d/scene/vdtShader';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { threeToWorld, toThreePoint } from '@/features/viewer3d/worldCoordinates';
import { useFrame, useThree } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box3,
  Color,
  DataTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Material,
  type Object3D,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { useStore } from 'zustand';

// 정적 배경 Scene 레이어(S15P31A101-59, S15P31A101-360, S15P31A101-404). 같은 Canvas·깊이 버퍼에 그려 책상 뒤 사람의 가림이 맞게 한다(명세 13 머리말).
// - 받은 glTF 는 GLTF_Y_UP 계약대로 이미 Three 축이라 회전·이동·배율을 더하지 않는다(축 변환 한 곳 원칙).
// - 배경은 클릭을 받지 않는다(사람·구역·작업면 선택과 빈 곳 클릭 해제를 가리지 않는다).
// - 사진 텍스처(map)가 있는 메시는 이미 카메라 조명이 구워져 있으므로 광원 계산·톤매핑을 거치지 않는 MeshBasicMaterial(SRGBColorSpace, toneMapped: false)로 바꾼다.
// - 텍스처가 없는 정점색·회색 메시는 기존 조명 재질(MeshStandardMaterial 등)을 유지하고 법선이 없으면 계산해 입체감을 남긴다.
// - 정합 상태와 관계없이 원래 재질 색과 불투명도를 유지한다.
// - scene_output 2.1.0 SURFACE_SOURCE_MAP 이 주어지면 최근접 샘플링(NearestFilter, NoColorSpace, mipmap 끔)으로 읽어
//   2(OBSERVED)는 그대로, 3(ESTIMATED_PLANE)·1(INTERPOLATED)은 약간 낮추고, 0(UNOBSERVED)·기타는 어둡게 흐리고 빗금을 얹는다.

const noRaycast = () => {};
export interface SurfaceSourceShade {
  brightness: number;
  saturation: number;
  hatch: number;
}

export const SURFACE_SOURCE_SHADING: Readonly<
  Record<'OBSERVED' | 'ESTIMATED_PLANE' | 'INTERPOLATED' | 'UNOBSERVED', SurfaceSourceShade>
> = {
  OBSERVED: { brightness: 1.0, saturation: 1.0, hatch: 0.0 },
  ESTIMATED_PLANE: { brightness: 0.82, saturation: 0.85, hatch: 0.0 },
  INTERPOLATED: { brightness: 0.72, saturation: 0.75, hatch: 0.0 },
  UNOBSERVED: { brightness: 0.38, saturation: 0.25, hatch: 0.18 },
};

/**
 * SURFACE_SOURCE_MAP 픽셀 값(0, 1, 2, 3 및 미정의 값)에 대응하는 명도·채도·빗금 강도를 돌려준다.
 * 셰이더 분기식과 동일한 규칙이며 단위 시험에서 검증한다.
 */
export function surfaceSourceShade(code: number): SurfaceSourceShade {
  const rounded = Math.round(code);
  if (rounded === SURFACE_SOURCE_VALUES.OBSERVED) return SURFACE_SOURCE_SHADING.OBSERVED;
  if (rounded === SURFACE_SOURCE_VALUES.ESTIMATED_PLANE)
    return SURFACE_SOURCE_SHADING.ESTIMATED_PLANE;
  if (rounded === SURFACE_SOURCE_VALUES.INTERPOLATED) return SURFACE_SOURCE_SHADING.INTERPOLATED;
  return SURFACE_SOURCE_SHADING.UNOBSERVED;
}

/**
 * 셰이더와 동일한 계산으로 사진 텍스처 RGB(0~1)에 SURFACE_SOURCE_MAP 코드를 적용한 RGB 를 돌려준다.
 */
export function sampleSurfaceSourceColor(
  rgb: readonly [number, number, number],
  code: number | null,
  hatchStripe = 0,
): [number, number, number] {
  let [r, g, b] = rgb;
  if (code !== null) {
    const { brightness, saturation, hatch } = surfaceSourceShade(code);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const factor = brightness * (1 - hatch * (hatchStripe > 0 ? 1 : 0));
    r = (luma + (r - luma) * saturation) * factor;
    g = (luma + (g - luma) * saturation) * factor;
    b = (luma + (b - luma) * saturation) * factor;
  }
  return [r, g, b];
}

/**
 * SURFACE_SOURCE_MAP 텍스처가 보간·색공간 변환으로 값이 섞이지 않게 최근접 샘플링·비색공간으로 맞춘다.
 */
export function configureSurfaceSourceMap(texture: Texture, albedoMap?: Texture | null): Texture {
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  if (albedoMap) {
    texture.flipY = albedoMap.flipY;
  }
  texture.needsUpdate = true;
  return texture;
}

const FALLBACK_SOURCE_MAP = (() => {
  const tex = new DataTexture(
    new Uint8Array([SURFACE_SOURCE_VALUES.OBSERVED, 0, 0, 255]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  return configureSurfaceSourceMap(tex);
})();

interface SceneShaderUniforms {
  uSurfaceSourceMap: { value: Texture };
  uSurfaceSourceEnabled: { value: number };
}

type LoadedSourceMaps =
  | { kind: 'list'; textures: readonly (Texture | null)[] }
  | { kind: 'record'; textures: Readonly<Record<string, Texture>> }
  | null;

function resolveSourceMapForMesh(
  node: Mesh,
  material: Material,
  texturedIndex: number,
  loadedMaps: LoadedSourceMaps,
): Texture | null {
  const fromMat = (material.userData as { surfaceSourceMap?: unknown } | undefined)
    ?.surfaceSourceMap;
  if (fromMat && typeof fromMat === 'object' && (fromMat as Texture).isTexture) {
    return fromMat as Texture;
  }
  const fromMesh = (node.userData as { surfaceSourceMap?: unknown } | undefined)?.surfaceSourceMap;
  if (fromMesh && typeof fromMesh === 'object' && (fromMesh as Texture).isTexture) {
    return fromMesh as Texture;
  }
  if (!loadedMaps) return null;
  if (loadedMaps.kind === 'record') {
    return loadedMaps.textures[material.name] ?? loadedMaps.textures[node.name] ?? null;
  }
  return loadedMaps.textures[texturedIndex] ?? loadedMaps.textures[0] ?? null;
}

function attachPhotoShader(material: MeshBasicMaterial, sourceMap: Texture | null) {
  const uniforms: SceneShaderUniforms = {
    uSurfaceSourceMap: { value: sourceMap ?? FALLBACK_SOURCE_MAP },
    uSurfaceSourceEnabled: { value: sourceMap ? 1 : 0 },
  };
  material.customProgramCacheKey = () =>
    sourceMap ? 'scene-photo-basic-provenance-v1' : 'scene-photo-basic-v1';
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uSurfaceSourceMap = uniforms.uSurfaceSourceMap;
    shader.uniforms.uSurfaceSourceEnabled = uniforms.uSurfaceSourceEnabled;
    shader.fragmentShader =
      `uniform sampler2D uSurfaceSourceMap;\nuniform float uSurfaceSourceEnabled;\n` +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
  if (uSurfaceSourceEnabled > 0.5) {
    float rawCode = floor(texture2D(uSurfaceSourceMap, vMapUv).r * 255.0 + 0.5);
    float srcBrightness = ${SURFACE_SOURCE_SHADING.UNOBSERVED.brightness.toFixed(2)};
    float srcSaturation = ${SURFACE_SOURCE_SHADING.UNOBSERVED.saturation.toFixed(2)};
    float srcHatch = ${SURFACE_SOURCE_SHADING.UNOBSERVED.hatch.toFixed(2)};
    if (abs(rawCode - 2.0) < 0.25) {
      srcBrightness = ${SURFACE_SOURCE_SHADING.OBSERVED.brightness.toFixed(2)};
      srcSaturation = ${SURFACE_SOURCE_SHADING.OBSERVED.saturation.toFixed(2)};
      srcHatch = 0.0;
    } else if (abs(rawCode - 3.0) < 0.25) {
      srcBrightness = ${SURFACE_SOURCE_SHADING.ESTIMATED_PLANE.brightness.toFixed(2)};
      srcSaturation = ${SURFACE_SOURCE_SHADING.ESTIMATED_PLANE.saturation.toFixed(2)};
      srcHatch = 0.0;
    } else if (abs(rawCode - 1.0) < 0.25) {
      srcBrightness = ${SURFACE_SOURCE_SHADING.INTERPOLATED.brightness.toFixed(2)};
      srcSaturation = ${SURFACE_SOURCE_SHADING.INTERPOLATED.saturation.toFixed(2)};
      srcHatch = 0.0;
    }
    float srcLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 srcColor = mix(vec3(srcLuma), diffuseColor.rgb, srcSaturation) * srcBrightness;
    if (srcHatch > 0.0) {
      float stripe = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) * 0.125));
      srcColor *= (1.0 - srcHatch * stripe);
    }
    diffuseColor.rgb = srcColor;
  }
#endif`,
      );
  };
}

/** 장면 아래 모든 형상·재질·텍스처를 해제한다. */
export function disposeObject(root: Object3D) {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry?.dispose();
    const materials: Material[] = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && (value as Texture).isTexture) {
          (value as Texture).dispose();
        }
      }
      const sourceMap = (material.userData as { surfaceSourceMap?: unknown } | undefined)
        ?.surfaceSourceMap;
      if (
        sourceMap &&
        typeof sourceMap === 'object' &&
        (sourceMap as Texture).isTexture &&
        sourceMap !== FALLBACK_SOURCE_MAP
      ) {
        (sourceMap as Texture).dispose();
      }
      material.dispose();
    }
  });
}

/** 자산의 World 경계(m). 비었거나 유한하지 않으면 null(그리지 않는다). */
export function worldBoundsOf(root: Object3D) {
  root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const a = toThreePoint(box.min.toArray());
  const b = toThreePoint(box.max.toArray());
  if (!a || !b) return null;
  const [p, q] = [threeToWorld(a), threeToWorld(b)];
  // Three Z 가 World −Y 라 축마다 작은 값·큰 값을 다시 고른다.
  const min = [0, 1, 2].map((i) => Math.min(p[i]!, q[i]!)) as [number, number, number];
  const max = [0, 1, 2].map((i) => Math.max(p[i]!, q[i]!)) as [number, number, number];
  return { min, max };
}

/**
 * 배경으로 쓰기 전 준비:
 * - 클릭을 받지 않게 한다.
 * - 텍스처(map)가 있는 재질은 사진 색이 그대로 보이도록 MeshBasicMaterial(SRGBColorSpace, toneMapped: false)로 바꾼다.
 * - 텍스처가 없는 정점색·회색 메시는 기존 재질을 복제해 유지하고, 정점 법선이 없으면 계산해 입체감을 살린다.
 */
export function prepareSceneRoot(root: Object3D, loadedMaps: LoadedSourceMaps = null) {
  let texturedIndex = 0;
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.raycast = noRaycast;
    const convert = (m: Material) => {
      const mapCandidate = (m as { map?: unknown }).map;
      const map =
        mapCandidate && typeof mapCandidate === 'object' && (mapCandidate as Texture).isTexture
          ? (mapCandidate as Texture)
          : null;
      const baseColor =
        'color' in m && (m as { color?: unknown }).color instanceof Color
          ? ((m as { color: Color }).color.clone() as Color)
          : new Color(0xffffff);

      if (map) {
        map.colorSpace = SRGBColorSpace;
        map.needsUpdate = true;
        const currentIndex = texturedIndex;
        texturedIndex += 1;
        const rawSourceMap = resolveSourceMapForMesh(node, m, currentIndex, loadedMaps);
        const sourceMap = rawSourceMap ? configureSurfaceSourceMap(rawSourceMap, map) : null;
        const basic = new MeshBasicMaterial({
          name: m.name,
          map,
          color: baseColor,
          transparent: m.transparent,
          opacity: m.opacity,
          alphaTest: m.alphaTest,
          depthWrite: m.depthWrite,
          depthTest: m.depthTest,
          side: DoubleSide,
          vertexColors: m.vertexColors,
          toneMapped: false,
        });
        basic.userData = {
          ...m.userData,
          surfaceSourceMap: sourceMap,
        };
        attachPhotoShader(basic, sourceMap);
        m.dispose();
        return basic;
      }

      if (node.geometry && !node.geometry.getAttribute('normal')) {
        node.geometry.computeVertexNormals();
      }
      const c = m.clone();
      m.dispose();
      return c;
    };
    node.material = Array.isArray(node.material)
      ? node.material.map(convert)
      : convert(node.material);
  });
}

function applyDisplay(root: Object3D, display: SceneDisplay) {
  root.visible = display !== 'HIDDEN';
}

async function loadSurfaceSourceMaps(
  urls: SurfaceSourceMapUrls | undefined,
  textureLoader: SceneTextureLoader,
): Promise<LoadedSourceMaps> {
  if (!urls) return null;
  if (Array.isArray(urls)) {
    const textures = await Promise.all(urls.map((u) => textureLoader(u).catch(() => null)));
    return { kind: 'list', textures };
  }
  const entries = await Promise.all(
    Object.entries(urls).map(async ([k, u]) => {
      const tex = await textureLoader(u).catch(() => null);
      return tex ? ([k, tex] as const) : null;
    }),
  );
  const record: Record<string, Texture> = {};
  for (const entry of entries) {
    if (entry) record[entry[0]] = entry[1];
  }
  return { kind: 'record', textures: record };
}

/** HTTP 상태가 실린 읽기 오류면 그 값(three FileLoader 의 HttpError.response.status). 주소는 꺼내지 않는다. */
function httpStatusOf(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : null;
}

// 뷰어 Store 가 없는 곳(시험 등)에서 읽는 빈 상태. 카메라 시점 보기가 없어 VDT 를 카메라 때문에 켜지 않는다.
const NO_VIEWER = createViewerStore();

export function SceneBackground() {
  const store = useContext(SceneStoreContext);
  return store ? <Background store={store} /> : null;
}

function Background({ store }: { store: SceneStore }) {
  const gl = useThree((s) => s.gl);
  const loader = useContext(SceneLoaderContext);
  const textureLoader = useContext(SceneTextureLoaderContext);
  const vdtTextureLoader = useContext(SceneVdtTextureLoaderContext);
  const input = useStore(store, (s) => s.input);
  const load = useStore(store, (s) => s.load);
  const vdtOptions = useStore(store, (s) => s.vdtOptions);
  const viewerStore = useContext(ViewerStoreContext) ?? NO_VIEWER;
  // 카메라 시점 보기(-590): 시점이 카메라에 맞아 있고 프레임 저하로 막히지 않았으면 VDT 를 켠다.
  const cameraWant = useStore(
    viewerStore,
    (s) => s.alignedCamera !== null && s.cameraVdtBlocked === null,
  );
  const worldScene = useSpatialData((s) => s.world?.sceneVersion ?? null);
  const worldCalibration = useSpatialData((s) => s.world?.calibrationVersion ?? null);
  const compatibility = useSpatialData((s) => s.health?.scene.compatibility);
  const healthCommitted = useSpatialData((s) => s.health?.scene.committedVersion ?? null);
  const healthLive = useSpatialData((s) => s.health?.scene.liveVersion ?? null);
  const healthMismatch = useSpatialData((s) => (s.health ? s.health.scene.mismatch : null));
  const scene: CurrentScene | null = useMemo(() => {
    if (!input?.ok) return null;
    const read = readCurrentScene(input.raw);
    return read.ok ? read.scene : null;
  }, [input]);
  const [loaded, setLoaded] = useState<{ sceneVersion: string; root: Object3D } | null>(null);
  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  const sceneVersion = scene?.sceneVersion ?? null;
  const cacheVersion = scene?.state === 'COMMITTED' ? (sceneVersion ?? undefined) : undefined;
  const url = scene?.gltfUrl ?? null;
  const expiresAt = scene?.gltfExpiresAtMs ?? null;
  const surfaceSourceMapUrls = scene?.surfaceSourceMapUrls;

  useEffect(() => {
    // 같은 Scene 을 이미 읽었으면 서명 주소만 새로 받은 것이라 다시 읽지 않는다.
    if (sceneVersion && loadedRef.current?.sceneVersion === sceneVersion) return;
    setLoaded(null);
    if (!sceneVersion || !url) {
      store.getState().setLoad(IDLE_LOAD);
      return;
    }
    const at = (phase: 'LOADING' | 'FAILED' | 'EXPIRED', reason: string | null = null) =>
      store.getState().setLoad({ phase, sceneVersion, reason, boundsWorld: null });
    if (expiresAt !== null && expiresAt <= Date.now()) {
      at('EXPIRED', '서명 주소가 만료됐다');
      return;
    }
    let alive = true;
    at('LOADING');
    configureSceneKtx2Loader(gl);
    Promise.all([
      loader(url, cacheVersion),
      loadSurfaceSourceMaps(surfaceSourceMapUrls, textureLoader),
    ]).then(
      ([root, sourceMaps]) => {
        if (!alive) {
          disposeObject(root);
          return;
        }
        const boundsWorld = worldBoundsOf(root);
        if (!boundsWorld) {
          disposeObject(root);
          at('FAILED', '빈 자산이다');
          return;
        }
        prepareSceneRoot(root, sourceMaps);
        root.name = `scene-background:${sceneVersion}`;
        setLoaded({ sceneVersion, root });
        store.getState().setLoad({ phase: 'LOADED', sceneVersion, reason: null, boundsWorld });
      },
      (error: unknown) => {
        if (!alive) return;
        const status = httpStatusOf(error);
        const expired =
          status === 401 || status === 403 || (expiresAt !== null && expiresAt <= Date.now());
        if (expired) at('EXPIRED', status ? `HTTP ${status}` : '서명 주소가 만료됐다');
        else at('FAILED', status ? `HTTP ${status}` : '자산을 읽지 못했다(형식 오류 등)');
      },
    );
    return () => {
      alive = false;
    };
  }, [
    store,
    gl,
    loader,
    textureLoader,
    sceneVersion,
    cacheVersion,
    url,
    expiresAt,
    surfaceSourceMapUrls,
  ]);

  // 바뀌거나 내려가면 이전 자산을 해제한다.
  useEffect(() => {
    if (!loaded) return;
    return () => disposeObject(loaded.root);
  }, [loaded]);

  const display = sceneStatusOf(input, load, {
    compatibility,
    worldScene,
    worldCalibration,
    healthCommitted,
    healthLive,
    healthMismatch,
  }).display;
  const shown: SceneDisplay = loaded && loaded.sceneVersion === sceneVersion ? display : 'HIDDEN';

  const glbMapCameras = useMemo(
    () => (loaded ? readSceneMapCamerasFromObject3D(loaded.root) : null),
    [loaded],
  );
  // 카메라별 사진 주소(사람 지운 배경, cameraImageUrls)가 있으면 장면 vdt 에 끼우거나 map_cameras 로 설정을 만든다.
  const vdtConfig = useMemo(
    () =>
      withVdtCameraImages(
        scene?.vdt ?? null,
        scene?.mapCameras ?? glbMapCameras,
        vdtOptions.cameraImageUrls,
      ),
    [scene?.vdt, scene?.mapCameras, glbMapCameras, vdtOptions.cameraImageUrls],
  );
  const alwaysOn = Boolean(vdtOptions.enabled);
  // 카메라 시점 VDT 가 장착돼 있거나 장착 중인지. 끌 때는 서서히 0 으로 내린 뒤에 내린다(프레임에서 false 로 바꾼다).
  const [cameraLive, setCameraLive] = useState(false);
  const vdtEnabled = Boolean((alwaysOn || cameraWant || cameraLive) && vdtConfig && loaded);
  const shadowMapSize = vdtOptions.shadowMapSize ?? 1536;
  const vdtOptionsRef = useRef(vdtOptions);
  useEffect(() => {
    vdtOptionsRef.current = vdtOptions;
  }, [vdtOptions]);

  const camerasThree = useMemo(() => {
    if (!vdtEnabled || !vdtConfig) return null;
    const effectiveMapCameras = scene?.mapCameras ?? vdtConfig.mapCameras ?? glbMapCameras;
    const resolvedCameras = applyMapCamerasToVdtCameras(vdtConfig.cameras, effectiveMapCameras);
    return resolvedCameras.map((c) => convertVdtCameraToThree(c, vdtConfig.nearM, vdtConfig.farM));
  }, [vdtEnabled, vdtConfig, scene?.mapCameras, glbMapCameras]);

  const [vdtIndicatorGroup, setVdtIndicatorGroup] = useState<Object3D | null>(null);
  const mountedVdtRef = useRef<MountedVdtScene | null>(null);
  const bakedShadowsRef = useRef<BakedShadowMaps | null>(null);
  const lastBakedShadowSizeRef = useRef<number | null>(null);
  // 카메라 시점 VDT 페이드(-590): 지금 섞는 비율과 켠 동안 프레임 감시.
  const strengthRef = useRef(0);
  const fpsGuardRef = useRef<ReturnType<typeof createFpsGuard> | null>(null);
  const alwaysOnRef = useRef(alwaysOn);
  const cameraWantRef = useRef(cameraWant);
  useEffect(() => {
    alwaysOnRef.current = alwaysOn;
  }, [alwaysOn]);
  useEffect(() => {
    cameraWantRef.current = cameraWant;
    // 켜기는 바로, 끄기는 장착된 VDT 가 없을 때만 바로 한다(장착돼 있으면 프레임에서 서서히 내린 뒤 끈다).
    if (cameraWant || !mountedVdtRef.current) setCameraLive(cameraWant);
  }, [cameraWant]);

  useEffect(() => {
    if (!vdtEnabled || !loaded || !vdtConfig || !camerasThree) {
      return;
    }
    let alive = true;
    let loadedCamTextures: Texture[] | null = null;
    const urls = vdtConfig.cameras.map((c) => c.imageUrl);

    vdtTextureLoader(urls).then(
      (textures) => {
        if (!alive) {
          for (const t of textures) t.dispose();
          return;
        }
        loadedCamTextures = textures;
        const initShadowSize = vdtOptionsRef.current.shadowMapSize ?? 1536;
        const { shadowMeshes } = collectVdtMeshes(loaded.root);
        const baked = bakeVdtShadowMaps(
          gl,
          shadowMeshes,
          camerasThree,
          initShadowSize,
          vdtConfig.farM,
        );
        bakedShadowsRef.current = baked;
        lastBakedShadowSizeRef.current = initShadowSize;
        const startStrength = alwaysOnRef.current ? 1 : 0;
        const mounted = mountVdtOnSceneRoot({
          root: loaded.root,
          vdtConfig,
          camerasThree,
          cameraTextures: textures,
          bakedShadows: baked,
          options: vdtOptionsRef.current,
          strength: startStrength,
        });
        mountedVdtRef.current = mounted;
        strengthRef.current = startStrength;
        fpsGuardRef.current = createFpsGuard();
        setVdtIndicatorGroup(mounted.indicatorGroup);
      },
      () => {
        // VDT 카메라 텍스처 로드 실패 시 원래 구운 텍스처(MeshBasicMaterial) 경로를 그대로 유지한다.
        // 카메라 시점 보기는 시점만 옮긴 채로 두고, 맞음이 풀리면 위 effect 가 cameraLive 를 내린다.
      },
    );

    return () => {
      alive = false;
      strengthRef.current = 0;
      fpsGuardRef.current = null;
      setVdtIndicatorGroup(null);
      lastBakedShadowSizeRef.current = null;
      if (mountedVdtRef.current) {
        mountedVdtRef.current.dispose();
        mountedVdtRef.current = null;
      }
      if (bakedShadowsRef.current) {
        bakedShadowsRef.current.dispose();
        bakedShadowsRef.current = null;
      }
      if (loadedCamTextures) {
        for (const t of loadedCamTextures) t.dispose();
        loadedCamTextures = null;
      }
    };
  }, [vdtEnabled, loaded, vdtConfig, camerasThree, gl, vdtTextureLoader]);

  // VDT 가 이미 마운트된 상태에서 토글 옵션만 바뀔 때는 그림자 맵 재렌더 없이 유니폼/가시성만 즉시 갱신한다.
  useEffect(() => {
    if (mountedVdtRef.current) {
      mountedVdtRef.current.updateOptions(vdtOptions);
    }
  }, [vdtOptions]);

  // 그림자 맵 해상도 설정이 바뀌었을 때만 정적 깊이 그림자 맵을 다시 굽는다.
  useEffect(() => {
    if (
      !mountedVdtRef.current ||
      !loaded ||
      !vdtConfig ||
      !camerasThree ||
      lastBakedShadowSizeRef.current === shadowMapSize
    ) {
      return;
    }
    const { shadowMeshes } = collectVdtMeshes(loaded.root);
    const nextBaked = bakeVdtShadowMaps(
      gl,
      shadowMeshes,
      camerasThree,
      shadowMapSize,
      vdtConfig.farM,
    );
    const prevBaked = bakedShadowsRef.current;
    bakedShadowsRef.current = nextBaked;
    lastBakedShadowSizeRef.current = shadowMapSize;
    mountedVdtRef.current.updateShadowMaps(nextBaked);
    prevBaked?.dispose();
  }, [shadowMapSize, loaded, vdtConfig, camerasThree, gl]);

  // 카메라 시점 VDT 를 서서히 켜고 끈다(CAMERA_VDT_FADE_MS). 켠 동안 평균 FPS 가 기준 아래면 이번 카메라 시점에서 끈다.
  useFrame((_, delta) => {
    const mounted = mountedVdtRef.current;
    if (!mounted) return;
    if (alwaysOnRef.current) {
      if (strengthRef.current !== 1) {
        strengthRef.current = 1;
        mounted.setStrength(1);
      }
      return;
    }
    const want = cameraWantRef.current;
    const step = (delta * 1000) / CAMERA_VDT_FADE_MS;
    const prev = strengthRef.current;
    const next = want ? Math.min(1, prev + step) : Math.max(0, prev - step);
    if (next !== prev) {
      strengthRef.current = next;
      mounted.setStrength(next);
    }
    if (!want) {
      if (next === 0) setCameraLive(false);
      return;
    }
    if (fpsGuardRef.current?.push(delta * 1000)) viewerStore.getState().blockCameraVdt('LOW_FPS');
  });

  const activeVdtIndicatorGroup = vdtEnabled ? vdtIndicatorGroup : null;

  useEffect(() => {
    if (loaded) applyDisplay(loaded.root, shown);
    if (activeVdtIndicatorGroup) applyDisplay(activeVdtIndicatorGroup, shown);
    store.getState().setDisplay(shown);
  }, [store, loaded, activeVdtIndicatorGroup, shown]);
  useEffect(() => () => store.getState().setDisplay('HIDDEN'), [store]);

  if (!loaded) return null;
  return (
    <group name="scene-background-layer">
      {activeVdtIndicatorGroup ? <primitive object={activeVdtIndicatorGroup} /> : null}
      <primitive object={loaded.root} />
    </group>
  );
}
