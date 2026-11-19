import type { SpatialDataState } from '@/features/viewer3d/data/spatialData.store';
import {
  IDLE_LOAD,
  type SceneDisplay,
  type SceneLoad,
  type SceneVersions,
  type ViewerSceneInput,
} from '@/features/viewer3d/scene/sceneContract';
import { loadVdtCameraTextures } from '@/features/viewer3d/scene/vdtShader';
import type { ViewerVdtOptions } from '@/features/viewer3d/scene/vdtTypes';
import { createContext, useContext } from 'react';
import { TextureLoader, type Object3D, type Texture, type WebGLRenderer } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

// 뷰어 인스턴스마다 하나 두는 배경 Scene 상태. 입력(FE 조회 결과)과 읽기 단계, 장면에 보이는 방식만 둔다.

export const DEFAULT_VDT_OPTIONS: ViewerVdtOptions = {
  enabled: false,
  shadowMapSize: 1536,
  projectUnobserved: false,
  outlierRemoval: true,
  edgeFeather: true,
  floorLayer: true,
  wallLayer: true,
  bgTone: true,
  colorCorrection: true,
  topK: 3,
  renderMode: 'vdt',
};

export interface SceneStoreState {
  input: ViewerSceneInput | null;
  load: SceneLoad;
  /** 배경이 장면에 어떻게 보이는지. 기본 바닥은 HIDDEN 일 때만 채운다. */
  display: SceneDisplay;
  /** 시점 의존 텍스처(VDT, -534) 실행 옵션(기능 플래그 기본 끔). */
  vdtOptions: ViewerVdtOptions;
  setInput(input: ViewerSceneInput | null): void;
  setLoad(load: SceneLoad): void;
  setDisplay(display: SceneDisplay): void;
  setVdtOptions(options: ViewerVdtOptions): void;
}

export type SceneStore = StoreApi<SceneStoreState>;

export function createSceneStore(): SceneStore {
  return createStore<SceneStoreState>()((set, get) => ({
    input: null,
    load: IDLE_LOAD,
    display: 'HIDDEN',
    vdtOptions: DEFAULT_VDT_OPTIONS,
    setInput: (input) => {
      if (get().input !== input) set({ input });
    },
    setLoad: (load) => set({ load }),
    setDisplay: (display) => {
      if (get().display !== display) set({ display });
    },
    setVdtOptions: (options) => {
      const next: ViewerVdtOptions = { ...DEFAULT_VDT_OPTIONS, ...options };
      const cur = get().vdtOptions;
      if (JSON.stringify(cur) !== JSON.stringify(next)) {
        set({ vdtOptions: next });
      }
    },
  }));
}

/** ViewerShell 밖(시험 등)이면 null 이고 배경을 그리지 않는다. 기본 바닥은 늘 보인다. */
export const SceneStoreContext = createContext<SceneStore | null>(null);

// 배경 Scene 이 없는 곳(시험 등)에서 읽는 빈 상태. 늘 HIDDEN 이다.
const NO_SCENE = createSceneStore();

/** 이 뷰어의 장면 상태에서 값 하나를 읽는다. 배경 Scene 이 없는 곳이면 빈 상태(HIDDEN)를 읽는다. */
export function useSceneState<T>(select: (state: SceneStoreState) => T): T {
  return useStore(useContext(SceneStoreContext) ?? NO_SCENE, select);
}

/** KTX2 Basis Universal 변환기(basis_transcoder.js·wasm) 정적 자산 경로. */
export const SCENE_KTX2_TRANSCODER_PATH = '/basis/';

interface Ktx2WorkerConfig {
  astcSupported: boolean;
  astcHDRSupported: boolean;
  etc1Supported: boolean;
  etc2Supported: boolean;
  dxtSupported: boolean;
  bptcSupported: boolean;
  pvrtcSupported: boolean;
}

const DEFAULT_KTX2_WORKER_CONFIG: Ktx2WorkerConfig = {
  astcSupported: false,
  astcHDRSupported: false,
  etc1Supported: false,
  etc2Supported: false,
  dxtSupported: false,
  bptcSupported: false,
  pvrtcSupported: false,
};

function hasDetectableRenderer(renderer: unknown): renderer is WebGLRenderer {
  if (!renderer || typeof renderer !== 'object') return false;
  if ((renderer as { isWebGPURenderer?: unknown }).isWebGPURenderer === true) return true;
  const extensions = (renderer as { extensions?: { has?: unknown; get?: unknown } }).extensions;
  return typeof extensions?.has === 'function' && typeof extensions?.get === 'function';
}

function probeCanvasKtx2WorkerConfig(): Ktx2WorkerConfig {
  if (typeof document === 'undefined') return { ...DEFAULT_KTX2_WORKER_CONFIG };
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGLRenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl || typeof gl.getExtension !== 'function') {
      return { ...DEFAULT_KTX2_WORKER_CONFIG };
    }
    const astcExt = gl.getExtension('WEBGL_compressed_texture_astc') as {
      getSupportedProfiles?: () => string[];
    } | null;
    const astcSupported = Boolean(astcExt);
    const astcHDRSupported = Boolean(
      astcExt &&
      typeof astcExt.getSupportedProfiles === 'function' &&
      astcExt.getSupportedProfiles().includes('hdr'),
    );
    return {
      astcSupported,
      astcHDRSupported,
      etc1Supported: Boolean(gl.getExtension('WEBGL_compressed_texture_etc1')),
      etc2Supported: Boolean(gl.getExtension('WEBGL_compressed_texture_etc')),
      dxtSupported: Boolean(gl.getExtension('WEBGL_compressed_texture_s3tc')),
      bptcSupported: Boolean(gl.getExtension('EXT_texture_compression_bptc')),
      pvrtcSupported: Boolean(
        gl.getExtension('WEBGL_compressed_texture_pvrtc') ||
        gl.getExtension('WEBKIT_WEBGL_compressed_texture_pvrtc'),
      ),
    };
  } catch {
    return { ...DEFAULT_KTX2_WORKER_CONFIG };
  }
}

let sharedKtx2Loader: KTX2Loader | null = null;

/**
 * 배경 glTF 용 공용 KTX2Loader 를 돌려준다.
 * 여러 인스턴스를 만들면 three 가 워커 중복 경고를 내므로 하나를 공유하고,
 * WebGLRenderer 가 주어지면 하드웨어 압축 텍스처 지원(ASTC·BPTC·S3TC·ETC2 등)을 갱신한다.
 */
export function configureSceneKtx2Loader(
  renderer?: unknown,
  transcoderPath = SCENE_KTX2_TRANSCODER_PATH,
): KTX2Loader {
  if (!sharedKtx2Loader) {
    sharedKtx2Loader = new KTX2Loader();
  }
  sharedKtx2Loader.setTranscoderPath(transcoderPath);
  if (hasDetectableRenderer(renderer)) {
    sharedKtx2Loader.detectSupport(renderer);
  } else {
    const internal = sharedKtx2Loader as unknown as { workerConfig: Ktx2WorkerConfig | null };
    if (internal.workerConfig === null) {
      internal.workerConfig = probeCanvasKtx2WorkerConfig();
    }
  }
  return sharedKtx2Loader;
}

/**
 * MeshoptDecoder(EXT_meshopt_compression)와 KTX2Loader(KHR_texture_basisu)를 붙인 GLTFLoader 를 만든다.
 * 압축되지 않은 기존 glb·gltf 도 그대로 읽는다.
 */
export function createSceneGltfLoader(
  options: { renderer?: unknown; transcoderPath?: string } = {},
): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setKTX2Loader(
    configureSceneKtx2Loader(
      options.renderer,
      options.transcoderPath ?? SCENE_KTX2_TRANSCODER_PATH,
    ),
  );
  return loader;
}

function attachTopLevelUserData(gltf: {
  scene: Object3D;
  userData?: Record<string, unknown>;
}): Object3D {
  const root = gltf.scene;
  if (gltf.userData?.simai !== undefined && root.userData?.simai === undefined) {
    root.userData = { ...root.userData, simai: gltf.userData.simai };
  }
  return root;
}

/** 메모리 버퍼(ArrayBuffer)나 JSON 문자열의 glb·gltf 를 설정된 로더로 해석해 장면 루트를 돌려준다. */
export function parseGltfScene(
  data: ArrayBuffer | string,
  path = '',
  options: { renderer?: unknown; transcoderPath?: string } = {},
): Promise<Object3D> {
  const loader = createSceneGltfLoader(options);
  return loader.parseAsync(data, path).then(attachTopLevelUserData);
}

/** 배경 glTF 를 읽어 장면 루트를 돌려준다. 시험은 이 함수를 바꿔 끼운다. */
export type SceneAssetLoader = (url: string, cacheVersion?: string) => Promise<Object3D>;

export const loadGltfScene: SceneAssetLoader = async (url, cacheVersion) => {
  // GLB 만 단일 파일이므로 외부 텍스처를 참조할 수 있는 glTF 는 기존 로더로 처리한다.
  if (
    !cacheVersion ||
    !new URL(url, window.location.href).pathname.toLowerCase().endsWith('.glb')
  ) {
    return createSceneGltfLoader().loadAsync(url).then(attachTopLevelUserData);
  }
  const { loadCachedScene } = await import('@/features/viewer3d/scene/sceneAssetCache');
  return loadCachedScene(url, cacheVersion, (bytes) =>
    parseGltfScene(bytes, new URL('.', new URL(url, window.location.href)).href),
  );
};

export const SceneLoaderContext = createContext<SceneAssetLoader>(loadGltfScene);

/** SURFACE_SOURCE_MAP 같은 보조 텍스처를 읽는다. 시험은 이 함수를 바꿔 끼운다. */
export type SceneTextureLoader = (url: string) => Promise<Texture>;

export const loadSceneTexture: SceneTextureLoader = (url) => new TextureLoader().loadAsync(url);

export const SceneTextureLoaderContext = createContext<SceneTextureLoader>(loadSceneTexture);

/** VDT 카메라 사진 텍스처 배열을 읽는다. 시험은 이 함수를 바꿔 끼운다. */
export type SceneVdtTextureLoader = (urls: readonly string[]) => Promise<Texture[]>;

export const SceneVdtTextureLoaderContext =
  createContext<SceneVdtTextureLoader>(loadVdtCameraTextures);

/** 정합 판정에 쓰는 지금 버전. World·Health 가 없으면 null. */
export const sceneVersionsOf = (state: SpatialDataState): SceneVersions => ({
  compatibility: state.health?.scene.compatibility,
  worldScene: state.world?.sceneVersion ?? null,
  worldCalibration: state.world?.calibrationVersion ?? null,
  healthCommitted: state.health?.scene.committedVersion ?? null,
  healthLive: state.health?.scene.liveVersion ?? null,
  healthMismatch: state.health ? state.health.scene.mismatch : null,
});
