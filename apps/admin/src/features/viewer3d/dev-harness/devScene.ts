import brokenSceneUrl from '@/features/viewer3d/dev-harness/fixtures/scene-broken.gltf?url';
import demoSceneUrl from '@/features/viewer3d/dev-harness/fixtures/scene-demo.gltf?url';
import { DEV_LOBBY_GLB_URL, DEV_VDT_GLB_URL } from '@/features/viewer3d/dev-harness/lobbyPreview';
import type { ViewerSceneInput, ViewerSceneStatus } from '@/features/viewer3d/scene/sceneContract';
import type { SceneVdtConfig } from '@/features/viewer3d/scene/vdtTypes';

// 개발 화면 전용 배경 Scene 입력(S15P31A101-59). FE 가 GET /api/scenes/current 로 받는 본문을 흉내 내 ViewerShell 에 넘긴다.
// 자산(scene-demo.gltf)은 DEMO 10×10m 교실의 바닥·벽·단상·책상을 World 좌표대로 GLTF_Y_UP 으로 구운 시험용이다.
// 실측 COMMITTED Scene 이 아니며, 제품 정합 근거로 쓰지 않는다.

export const SCENE_OPTIONS = [
  { key: 'off', label: '배경 · 없음(기본 바닥)' },
  { key: 'committed', label: '배경 · COMMITTED(버전 일치)' },
  { key: 'default', label: '배경 · DEFAULT(시연용 기본)' },
  { key: 'mismatch', label: '배경 · COMMITTED(Scene 불일치)' },
  { key: 'calibration', label: '배경 · COMMITTED(보정 불일치)' },
  { key: 'no-asset', label: '배경 · 주소 없음' },
  { key: 'missing', label: '배경 · 자산 404' },
  { key: 'broken', label: '배경 · 손상 자산' },
  { key: 'expired', label: '배경 · 서명 만료' },
  { key: 'rejected', label: '배경 · 응답 형식 오류' },
  { key: 'not-found', label: '배경 · 조회 실패(404 SCENE_NOT_FOUND)' },
  { key: 'lobby-preview', label: '배경 · 실측 로비 재구성(로컬 프리뷰)' },
  { key: 'vdt-s12', label: '배경 · 12차 로비 (VDT 시점 의존 텍스처)' },
] as const;

export type SceneOptionKey = (typeof SCENE_OPTIONS)[number]['key'];

const PARAM = 'scene';
const isKey = (value: unknown): value is SceneOptionKey =>
  SCENE_OPTIONS.some((o) => o.key === value);

export function readSceneOption(search: string): SceneOptionKey {
  const value = new URLSearchParams(search).get(PARAM);
  return isKey(value) ? value : 'off';
}

export function withSceneOption(href: string, key: SceneOptionKey): string {
  const url = new URL(href);
  if (key === 'off') url.searchParams.delete(PARAM);
  else url.searchParams.set(PARAM, key);
  return url.toString();
}

const absolute = (path: string) => new URL(path, window.location.href).href;

/** 고른 경우의 조회 결과. 시나리오 World 는 scene-demo-1·cal-demo 다(dev-harness/scenarios.ts VERSIONS). */
export function sceneInputOf(
  key: SceneOptionKey,
  now: number,
  vdtConfig: SceneVdtConfig | null = null,
): ViewerSceneInput | null {
  const committed = (patch: Record<string, unknown> = {}) => ({
    ok: true as const,
    raw: {
      scene_version: 'scene-demo-1',
      state: 'COMMITTED',
      default: false,
      calibration_version: 'cal-demo',
      committed_at_ms: now - 60_000,
      quality: null,
      gltf_url: absolute(demoSceneUrl),
      gltf_expires_at_ms: now + 5 * 60_000,
      ...patch,
    },
  });
  switch (key) {
    case 'off':
      return null;
    case 'committed':
      return committed();
    case 'default':
      return committed({
        scene_version: 'scene-demo',
        state: 'DEFAULT',
        default: true,
        calibration_version: null,
        committed_at_ms: null,
      });
    case 'mismatch':
      return committed({ scene_version: 'scene-demo-0' });
    case 'calibration':
      return committed({ calibration_version: 'cal-other' });
    case 'no-asset':
      return committed({ gltf_url: null, gltf_expires_at_ms: null });
    case 'missing':
      return committed({ gltf_url: absolute('/__missing__/scene-demo-404.gltf') });
    case 'broken':
      return committed({ gltf_url: absolute(brokenSceneUrl) });
    case 'expired':
      return committed({ gltf_expires_at_ms: now - 1_000 });
    case 'rejected':
      return committed({ state: 'COMMITTED', default: true });
    case 'not-found':
      return { ok: false, reason: 'SCENE_NOT_FOUND', httpStatus: 404 };
    case 'lobby-preview': {
      // 실영상 재구성 프리뷰(RECONSTRUCTED_PREVIEW·CALIBRATION_UNVERIFIED). COMMITTED·보정 버전을 꾸미지 않고 DEFAULT 로 넘겨
      // 판정은 DEFAULT_UNVERIFIED 그대로다. 자산은 저장소 밖 로컬 캐시에만 있다(없으면 FAILED).
      const withSourceMap =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('sourceMap') === 'on';
      return committed({
        scene_version: 'lobby-recon-preview',
        state: 'DEFAULT',
        default: true,
        calibration_version: null,
        committed_at_ms: null,
        gltf_url: absolute(DEV_LOBBY_GLB_URL),
        ...(vdtConfig ? { vdt: vdtConfig } : {}),
        ...(withSourceMap
          ? {
              surface_source_map_urls: Array.from({ length: 8 }, (_, i) =>
                absolute(
                  `/node_modules/.cache/spatial-dev/surface_source_${String(i).padStart(4, '0')}.png`,
                ),
              ),
            }
          : {}),
      });
    }
    case 'vdt-s12': {
      return committed({
        scene_version: 'scene-demo-1',
        state: 'COMMITTED',
        default: false,
        calibration_version: 'cal-demo',
        gltf_url: absolute(DEV_VDT_GLB_URL),
        ...(vdtConfig ? { vdt: vdtConfig } : {}),
      });
    }
  }
}

/** 진단 패널 한 줄 요약. 서명 주소는 보이지 않는다. */
export function sceneStatusText(status: ViewerSceneStatus | null): string {
  if (!status) return '배경 상태 없음';
  const parts = [
    status.phase,
    status.sceneVersion ?? '-',
    status.state ?? '-',
    status.verification ?? '-',
    status.display,
  ];
  if (status.mismatches.length) parts.push(status.mismatches.join(','));
  if (status.needsRefetch) parts.push('다시 받기 필요');
  if (status.reason) parts.push(status.reason);
  return parts.join(' · ');
}
