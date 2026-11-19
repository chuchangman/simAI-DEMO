import type { ViewerHealthMessage } from '@simai/contracts';
import { z } from 'zod';
import { applyMapCamerasToVdtConfig, readSceneMapCameras, readSceneVdtConfig } from './vdtMath';
import type { SceneMapCameras, SceneVdtConfig } from './vdtTypes';

export type SceneCompatibility = NonNullable<
  ViewerHealthMessage['payload']['scene']['compatibility']
>;
const compatibilitySchema = z.object({
  scene_version: z.string().min(1),
  calibration_version: z.string().min(1).nullable(),
  verification: z.enum(['VERIFIED', 'DIMMED', 'MISMATCH']),
  regeneration_required: z.boolean(),
  reason: z.enum([
    'SAME_CALIBRATION',
    'SMALL_CHANGE',
    'LARGE_CHANGE',
    'DIFFERENT_WORLD',
    'UNKNOWN',
  ]),
  max_center_delta_m: z.number().finite().nonnegative().nullable(),
  max_rotation_delta_rad: z.number().finite().min(0).max(Math.PI).nullable(),
});

// 정적 배경 Scene(S15P31A101-59)의 입력 계약과 상태 판정. 렌더러·React 와 떨어진 순수 함수라 시험한다.
//
// 입력은 BE -264 GET /api/scenes/current 응답 본문 그대로다(docs/design/server-rules-scenes.md, 서버 SceneService):
//   { scene_version, state: 'COMMITTED'|'DEFAULT', default, calibration_version, committed_at_ms, quality,
//     gltf_url, gltf_expires_at_ms, surface_source_map_urls? }
// 버전을 지정한 GET /api/scenes/{scene_version}/view(BE -613)도 같은 모양이다. state 는 그 버전의 실제 상태(CANDIDATE·COMMITTED)이고
// default 는 늘 false, CANDIDATE 는 committed_at_ms 가 null, current(boolean)가 더 실리며 compatibility 는 없다(쓰지 않는 필드는 그대로 둔다).
// FE 가 인증된 HTTP 로 받아 그대로 넘긴다. Viewer 는 조회·재시도·인증을 하지 않는다(서명 주소 5분 만료 뒤 다시 받기는 FE 몫).
//
// 좌표: 배경 glTF 는 scene_output 계약의 GLTF_VISUAL 자산이고 glTF 규약(+Y 위, World (x, y, z) → (x, z, −y))으로
// 내보낸다(contracts/experiments/scene_output.schema.json assets.axis_convention, "변환은 내보내기 어댑터 한 곳에서만").
// 그래서 Viewer 는 받은 장면을 회전·이동·배율 없이 그대로 둔다. 응답에 축 규약이 없어 위 계약을 전제로 하고, 상태에 적는다.
//
// 배경은 보기용 Visual Geometry 다. 위험 판정·작업면·구역 형상으로 쓰지 않는다(명세 5.3·7.5).

export const SCENE_STATES = ['COMMITTED', 'CANDIDATE', 'DEFAULT'] as const;
export type SceneState = (typeof SCENE_STATES)[number];

/**
 * scene_output 2.1.0(-317) SURFACE_SOURCE_MAP 픽셀 값(8-bit 단일 채널).
 * 2 = OBSERVED(관측), 1 = INTERPOLATED(보간), 0 = UNOBSERVED(미관측), 3 = ESTIMATED_PLANE(평면 추정).
 */
export const SURFACE_SOURCE_VALUES = {
  UNOBSERVED: 0,
  INTERPOLATED: 1,
  OBSERVED: 2,
  ESTIMATED_PLANE: 3,
} as const;

/** 재질·메시 순서 배열 또는 재질·메시 이름별 SURFACE_SOURCE_MAP 서명 주소. */
export type SurfaceSourceMapUrls = readonly string[] | Readonly<Record<string, string>>;

/** FE 가 넘기는 조회 결과. 실패면 이유와 HTTP 상태(있으면)만 넘긴다. 주소·토큰은 넘기지 않는다. */
export type ViewerSceneInput =
  { ok: true; raw: unknown } | { ok: false; reason: string; httpStatus?: number };

/** 검사를 통과한 현재 Scene. */
export interface CurrentScene {
  sceneVersion: string;
  state: SceneState;
  /** COMMITTED 는 늘 있다. 시연용 기본 Scene(DEFAULT)은 보정 근거가 없어 null 이다. */
  calibrationVersion: string | null;
  committedAtMs: number | null;
  calibrationState?: string;
  compatibility?: SceneCompatibility;
  /** 서명 주소. 자산이 없거나 저장소를 쓸 수 없으면 null(서버는 Scene 정보는 준다). */
  gltfUrl: string | null;
  gltfExpiresAtMs: number | null;
  /** 선택: scene_output 2.1.0 SURFACE_SOURCE_MAP 서명 주소(서버가 함께 내려줄 때만 채운다). */
  surfaceSourceMapUrls?: SurfaceSourceMapUrls;
  /** 선택: 최종 맵 굽기에 실제로 쓰인 단일 카메라 자세 사본(S15P31A101-539·-541, method.map_cameras). */
  mapCameras?: SceneMapCameras;
  /** 선택: 시점 의존 텍스처(VDT, -534) 카메라 K·R·t·배경 사진 URL 및 바닥·벽 표시 층 평면. */
  vdt?: SceneVdtConfig | null;
}

export type SceneReadResult = { ok: true; scene: CurrentScene } | { ok: false; reason: string };

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** 브라우저가 읽을 수 있는 주소인지. http(s)·같은 출처 경로·blob·data 만 받는다(javascript: 등은 거부). */
function readableUrl(value: string): boolean {
  try {
    const url = new URL(value, 'http://viewer.invalid/');
    return (
      url.protocol === 'http:' ||
      url.protocol === 'https:' ||
      url.protocol === 'blob:' ||
      url.protocol === 'data:'
    );
  } catch {
    return false;
  }
}

function readSurfaceSourceMapUrls(raw: unknown): SurfaceSourceMapUrls | null | 'INVALID' {
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) {
    if (raw.every((item) => isText(item) && readableUrl(item))) {
      return [...raw];
    }
    return 'INVALID';
  }
  if (typeof raw === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!isText(k) || !isText(v) || !readableUrl(v)) return 'INVALID';
      out[k] = v;
    }
    return out;
  }
  return 'INVALID';
}

/**
 * 응답을 검사한다. 값을 고쳐 받지 않고, 틀리면 이유를 돌려준다(주소는 이유에 넣지 않는다).
 * state 와 default 가 서로 맞지 않거나, COMMITTED 인데 보정 버전이 없으면 거부한다. 아직 확정되지 않은 CANDIDATE 도 읽는다.
 */
export function readCurrentScene(raw: unknown): SceneReadResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: '응답이 객체가 아니다' };
  }
  const sceneVersion = field(raw, 'scene_version');
  if (!isText(sceneVersion)) return { ok: false, reason: 'scene_version 이 비었다' };
  const state = field(raw, 'state');
  if (!SCENE_STATES.some((s) => s === state)) {
    return { ok: false, reason: 'state 는 COMMITTED·CANDIDATE·DEFAULT 중 하나여야 한다' };
  }
  const isDefault = field(raw, 'default');
  if (typeof isDefault !== 'boolean' || isDefault !== (state === 'DEFAULT')) {
    return { ok: false, reason: 'default 와 state 가 맞지 않는다' };
  }
  const calibration = field(raw, 'calibration_version');
  if (calibration !== null && calibration !== undefined && !isText(calibration)) {
    return { ok: false, reason: 'calibration_version 형식이 틀렸다' };
  }
  if (state === 'COMMITTED' && !isText(calibration)) {
    return { ok: false, reason: 'COMMITTED Scene 에 calibration_version 이 없다' };
  }
  const committedAt = field(raw, 'committed_at_ms');
  if (committedAt !== null && committedAt !== undefined && !isFiniteNumber(committedAt)) {
    return { ok: false, reason: 'committed_at_ms 형식이 틀렸다' };
  }
  const url = field(raw, 'gltf_url');
  if (url !== null && url !== undefined && (!isText(url) || !readableUrl(url))) {
    return { ok: false, reason: 'gltf_url 이 읽을 수 있는 주소가 아니다' };
  }
  const expires = field(raw, 'gltf_expires_at_ms');
  if (expires !== null && expires !== undefined && !isFiniteNumber(expires)) {
    return { ok: false, reason: 'gltf_expires_at_ms 형식이 틀렸다' };
  }
  const sourceMaps = readSurfaceSourceMapUrls(field(raw, 'surface_source_map_urls'));
  if (sourceMaps === 'INVALID') {
    return { ok: false, reason: 'surface_source_map_urls 형식이 틀렸다' };
  }
  const mapCamerasRaw = field(raw, 'map_cameras') ?? field(field(raw, 'method'), 'map_cameras');
  let parsedMapCameras: SceneMapCameras | null = null;
  if (mapCamerasRaw !== undefined && mapCamerasRaw !== null) {
    parsedMapCameras = readSceneMapCameras(mapCamerasRaw);
    if (!parsedMapCameras) {
      return { ok: false, reason: 'map_cameras 형식이 틀렸다' };
    }
  }
  const vdtRaw = field(raw, 'vdt');
  let parsedVdt: SceneVdtConfig | null = null;
  if (vdtRaw !== undefined && vdtRaw !== null) {
    parsedVdt = readSceneVdtConfig(vdtRaw);
    if (!parsedVdt || !parsedVdt.cameras.every((c) => readableUrl(c.imageUrl))) {
      return { ok: false, reason: 'vdt 형식이 틀렸다' };
    }
    if (parsedMapCameras) {
      parsedVdt = applyMapCamerasToVdtConfig(parsedVdt, parsedMapCameras);
    }
  }
  const compatibility = field(raw, 'compatibility');
  const parsed = compatibility === undefined ? null : compatibilitySchema.safeParse(compatibility);
  if (parsed && (!parsed.success || parsed.data.scene_version !== sceneVersion)) {
    return { ok: false, reason: 'compatibility 형식 또는 Scene 참조가 틀렸다' };
  }
  const calibrationState = field(raw, 'calibration_state');
  if (
    calibrationState !== undefined &&
    !['UNCALIBRATED', 'PROVISIONAL', 'CALIBRATED', 'DRIFTED'].includes(String(calibrationState))
  ) {
    return { ok: false, reason: 'calibration_state 형식이 틀렸다' };
  }
  const scene: CurrentScene = {
    sceneVersion,
    state: state as SceneState,
    calibrationVersion: isText(calibration) ? calibration : null,
    committedAtMs: isFiniteNumber(committedAt) ? committedAt : null,
    gltfUrl: isText(url) ? url : null,
    gltfExpiresAtMs: isFiniteNumber(expires) ? expires : null,
  };
  if (parsed?.success) scene.compatibility = parsed.data;
  if (typeof calibrationState === 'string') scene.calibrationState = calibrationState;
  if (sourceMaps !== null) {
    scene.surfaceSourceMapUrls = sourceMaps;
  }
  const effectiveMapCameras = parsedMapCameras ?? parsedVdt?.mapCameras ?? null;
  if (effectiveMapCameras !== null) {
    scene.mapCameras = effectiveMapCameras;
  }
  if (parsedVdt !== null) {
    scene.vdt = parsedVdt;
  }
  return {
    ok: true,
    scene,
  };
}

/** 배경 자산을 읽는 단계. */
export type SceneLoadPhase = 'IDLE' | 'LOADING' | 'LOADED' | 'FAILED' | 'EXPIRED';

export interface SceneLoad {
  phase: SceneLoadPhase;
  /** 읽은 Scene 버전. 다른 Scene 의 늦은 결과를 섞지 않으려고 같이 둔다. */
  sceneVersion: string | null;
  /** 실패 이유(주소 없음). */
  reason: string | null;
  /** 읽은 자산의 World 경계(m). 정합을 눈으로 확인할 때 쓴다. */
  boundsWorld: { min: [number, number, number]; max: [number, number, number] } | null;
}

export const IDLE_LOAD: SceneLoad = {
  phase: 'IDLE',
  sceneVersion: null,
  reason: null,
  boundsWorld: null,
};

/**
 * 화면 전체 상태.
 * - NONE: 입력 없음 · UNAVAILABLE: FE 조회 실패(404 SCENE_NOT_FOUND 포함) · REJECTED: 응답 형식 오류
 * - NO_ASSET: Scene 은 있으나 glTF 주소가 없음 · EXPIRED: 서명 주소 만료·권한 거부(다시 받아야 함)
 * - LOADING · LOADED · FAILED(404·손상·빈 자산)
 */
export type SceneStatusPhase =
  'NONE' | 'UNAVAILABLE' | 'REJECTED' | 'NO_ASSET' | 'EXPIRED' | 'LOADING' | 'LOADED' | 'FAILED';

/**
 * 정합 판정.
 * - VERIFIED·DIMMED: 같은 Scene·현재 보정에 결속된 서버 정합 판정
 * - DEFAULT_UNVERIFIED: 시연용 기본 Scene. 현장 정합 근거가 없다
 * - UNCONFIRMED: 비교할 world_state 가 아직 없음
 * - MISMATCH: 서버가 다른 World로 판정했거나 조회 자산이 활성 Scene과 다름(숨김)
 */
export type SceneVerification =
  'VERIFIED' | 'DIMMED' | 'DEFAULT_UNVERIFIED' | 'UNCONFIRMED' | 'MISMATCH';

/** FULL·DIMMED 원래 재질로 표시 · HIDDEN 숨기고 기본 바닥만. */
export type SceneDisplay = 'FULL' | 'DIMMED' | 'HIDDEN';

export interface ViewerSceneStatus {
  phase: SceneStatusPhase;
  sceneVersion: string | null;
  state: SceneState | null;
  calibrationVersion: string | null;
  verification: SceneVerification | null;
  provisionalBackground?: boolean;
  regenerationRequired?: boolean;
  display: SceneDisplay;
  /** 어긋난 항목(예: 'world.scene_version=scene-4'). 비교하지 못한 항목은 넣지 않는다. */
  mismatches: string[];
  /** FE 가 Scene(/api/scenes/current 또는 /api/scenes/{scene_version}/view)을 다시 받아야 한다(서명 주소 만료·권한 거부). */
  needsRefetch: boolean;
  reason: string | null;
  boundsWorld: SceneLoad['boundsWorld'];
  /** 축 규약은 응답에 없어 scene_output 계약(GLTF_Y_UP)을 전제로 한다. */
  axisConvention: 'GLTF_Y_UP_ASSUMED';
}

/** 정합 판정에 쓰는 지금 값. 모르면 null. */
export interface SceneVersions {
  worldScene: string | null;
  worldCalibration: string | null;
  healthCommitted: string | null;
  healthLive: string | null;
  healthMismatch: boolean | null;
  compatibility?: SceneCompatibility;
}

export function verifyScene(
  scene: CurrentScene,
  v: SceneVersions,
): { verification: SceneVerification; mismatches: string[] } {
  if (scene.state === 'DEFAULT') return { verification: 'DEFAULT_UNVERIFIED', mismatches: [] };
  const mismatches: string[] = [];
  if (v.worldScene !== null && v.worldScene !== scene.sceneVersion)
    mismatches.push(`world.scene_version=${v.worldScene}`);
  if (v.healthCommitted !== null && v.healthCommitted !== scene.sceneVersion)
    mismatches.push(`health.scene.committed_version=${v.healthCommitted}`);
  if (mismatches.length > 0) return { verification: 'MISMATCH', mismatches };
  if (v.worldCalibration === null || v.worldScene === null) {
    return { verification: 'UNCONFIRMED', mismatches };
  }
  const verdict = v.compatibility ?? scene.compatibility;
  if (
    verdict &&
    verdict.scene_version === scene.sceneVersion &&
    verdict.calibration_version === v.worldCalibration
  ) {
    return { verification: verdict.verification, mismatches };
  }
  // Scene 을 만든 보정과 같은 보정이면 변화가 0 이라 서버 판정(SAME_CALIBRATION) 없이도 VERIFIED 다.
  // 서버 판정이 늦거나 배포 전환 중에도 같은 보정을 확인한다.
  if (v.worldCalibration === scene.calibrationVersion) {
    return { verification: 'VERIFIED', mismatches };
  }
  return { verification: 'UNCONFIRMED', mismatches };
}

/** 입력·읽기 단계·지금 버전으로 화면 상태를 만든다. 같은 입력이면 같은 값이다. */
export function sceneStatusOf(
  input: ViewerSceneInput | null,
  load: SceneLoad,
  versions: SceneVersions,
): ViewerSceneStatus {
  const base: ViewerSceneStatus = {
    phase: 'NONE',
    sceneVersion: null,
    state: null,
    calibrationVersion: null,
    verification: null,
    display: 'HIDDEN',
    mismatches: [],
    needsRefetch: false,
    reason: null,
    boundsWorld: null,
    axisConvention: 'GLTF_Y_UP_ASSUMED',
  };
  if (!input) return base;
  if (!input.ok) {
    const forbidden = input.httpStatus === 401 || input.httpStatus === 403;
    return { ...base, phase: 'UNAVAILABLE', reason: input.reason, needsRefetch: forbidden };
  }
  const read = readCurrentScene(input.raw);
  if (!read.ok) return { ...base, phase: 'REJECTED', reason: read.reason };
  const { scene } = read;
  const { verification, mismatches } = verifyScene(scene, versions);
  const known = {
    ...base,
    sceneVersion: scene.sceneVersion,
    state: scene.state,
    calibrationVersion: scene.calibrationVersion,
    verification,
    needsRefetch:
      versions.healthCommitted !== null && versions.healthCommitted !== scene.sceneVersion,
    provisionalBackground: scene.calibrationState === 'PROVISIONAL',
    regenerationRequired: verification === 'DIMMED',
    mismatches,
  };
  const current = load.sceneVersion === scene.sceneVersion ? load : IDLE_LOAD;
  // 같은 Scene 을 이미 읽었으면 새 응답의 주소가 없거나 만료여도 그 자산을 그대로 쓴다(내용이 같다).
  if (!scene.gltfUrl && current.phase !== 'LOADED') {
    return { ...known, phase: 'NO_ASSET', reason: 'glTF 주소가 없다' };
  }
  const phase: SceneStatusPhase =
    current.phase === 'IDLE' ? 'LOADING' : (current.phase as SceneStatusPhase);
  const display: SceneDisplay =
    phase !== 'LOADED' || verification === 'MISMATCH'
      ? 'HIDDEN'
      : verification === 'VERIFIED'
        ? 'FULL'
        : 'DIMMED';
  return {
    ...known,
    phase,
    display,
    reason: current.reason,
    needsRefetch: phase === 'EXPIRED' || known.needsRefetch,
    boundsWorld: current.boundsWorld,
  };
}

/** 같은 상태인지(알림을 줄이려고 비교한다). */
export function sameSceneStatus(a: ViewerSceneStatus, b: ViewerSceneStatus): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
