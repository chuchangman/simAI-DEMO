import { requestReuseCheck, SETUP_REUSE_CHECK_KEY } from '@/features/setup/api';
import type { ReuseCandidate, ReuseCheck } from '@/features/setup/types';
import { api } from '@/lib/api';
import { cameraLabel } from '@/lib/cameraNames';
import { useQuery } from '@tanstack/react-query';

// 1단계 「이전 맵 재사용」을 고를 수 있는지(S15P31A101-689) — 어떤 맵을 고를지(S15P31A101-714).
// 재사용은 고른 맵을 만들 때의 보정·카메라 높이·구역을 그대로 쓴다. 서버(GET /api/setup-sessions/reuse-check)가 최근 완료 맵마다 1단계 헬퍼의
// 시점 확인(그 맵의 카메라 사진 ↔ 지금 화면)으로 「그때와 같은 자리인지」를 보고 순위를 매겨, 지금 카메라와 가장 잘 맞는 맵을 기본으로 추천한다.
// 맞지 않는 맵은 이유와 함께 고를 수 없게 보이고, 맞는 맵이 없으면 재사용을 끄고 이유를 두 줄(무엇이/어떻게)로 보인다(조용히 새 맵으로 바꾸지 않는다).

/** 1단계에 머무는 동안 다시 받는 주기. 헬퍼 한 라운드(노트북 GPU 약 2 s, CPU 16~24 s)마다 결과가 바뀔 수 있다. */
const REUSE_CHECK_POLL_MS = 10_000;

const NEW_MAP_HOW = '새 맵 만들기를 골라 주세요';

/** 무엇이 / 어떻게 두 줄. */
export interface ReuseBlocked {
  what: string;
  how: string;
}

/** 맵 목록 한 줄(S15P31A101-714). */
export interface ReuseMapOption {
  id: string;
  /** 그 맵을 만든(세팅 완료한) 날짜·시각(한국 시간, 예: 11-12(목) 15:20) */
  dateLabel: string;
  /** 그 시각(ms). 모르면 0. */
  completedAtMs: number;
  selectable: boolean;
  recommended: boolean;
  status: ReuseCandidate['status'];
  /** 상태 한 줄(고를 수 없으면 그 이유) */
  note: string;
  /** 그 맵을 만들 때의 카메라 높이(카메라 순서, 예: 2.41·2.42·2.47·2.48 m). 없으면 빈 글자 */
  heightsLabel: string;
}

export interface ReuseChoiceState {
  /** 첫 응답을 기다리는 중이다(그동안은 고를 수 없다). */
  checking: boolean;
  /** 재사용을 고를 수 없는 이유. 고를 수 있으면 null. */
  blocked: ReuseBlocked | null;
  /** 고를 수 있을 때 덧붙이는 한 줄(카메라 변화를 아직 모름, 옛 서버). 없으면 null. */
  note: string | null;
  /** 직전 보정과 달라진 카메라(카메라 배지 「직전 보정과 달라짐」 근거, S15P31A101-691). 모르면 빈 배열. */
  changedCameras: readonly string[];
  /** 최근 완료 맵(순위 순, S15P31A101-714). 옛 서버는 빈 배열. */
  maps: readonly ReuseMapOption[];
  /** 지금 카메라와 가장 잘 맞는 맵(기본 선택). 없으면 null. */
  recommendedId: string | null;
}

const NONE: readonly string[] = [];
const NO_MAPS: readonly ReuseMapOption[] = [];

/** 현장 게이트웨이의 카메라 헬퍼가 오래 답하지 않아 시점 확인을 못 한다(S15P31A101-719). */
const HELPER_LOST: ReuseBlocked = {
  what: '현장 게이트웨이와 연결이 끊겨 카메라 위치를 확인할 수 없어요',
  how: `게이트웨이 노트북이 켜져 있는지 확인하거나 ${NEW_MAP_HOW}`,
};

const CHECK_FAILED: ReuseBlocked = {
  what: '이전 맵을 확인하지 못했어요',
  how: '잠시 뒤 다시 열거나 새 맵 만들기를 골라 주세요',
};

/** 달라진 카메라 이름(카메라 2·카메라 3). 현장 카메라 목록에 없는 ID 는 원문 그대로 둔다(번호를 지어내지 않는다). */
export function changedCamerasLabel(
  cameraIds: readonly string[],
  changed: readonly string[],
): string {
  return changed.map((id) => (cameraIds.includes(id) ? cameraLabel(cameraIds, id) : id)).join('·');
}

/** 서버 판정을 화면 문구로 바꾼다. helperLost 면 「확인하고 있어요」 대신 게이트웨이가 끊겨 확인할 수 없다고 말한다. */
export function reuseChoiceOf(
  check: ReuseCheck,
  cameraIds: readonly string[],
  helperLost = false,
): Pick<ReuseChoiceState, 'blocked' | 'note'> {
  if (check.available) {
    return {
      blocked: null,
      note: check.camera_status === 'UNKNOWN' ? '카메라가 그대로인지는 시작한 뒤 확인해요' : null,
    };
  }
  switch (check.blocked_reason) {
    case 'NO_SCENE':
      return { blocked: { what: '이전 맵이 없어요', how: NEW_MAP_HOW }, note: null };
    case 'SCENE_MISMATCH':
      return {
        blocked: { what: '이전 맵이 지금 카메라 보정과 맞지 않아요', how: NEW_MAP_HOW },
        note: null,
      };
    case 'VIEW_UNCONFIRMED':
      // 후보 맵이 있지만 카메라가 그때와 같은 자리인지 아직 모른다(헬퍼 결과 대기·가림·사진 없음, S15P31A101-714)
      if (helperLost) return { blocked: HELPER_LOST, note: null };
      return {
        blocked: {
          what: '카메라가 이전 맵 때와 같은 자리인지 확인하고 있어요',
          how: `카메라 앞을 비우고 잠시 기다리거나 ${NEW_MAP_HOW}`,
        },
        note: null,
      };
    case 'CAMERA_CHANGED': {
      const names = changedCamerasLabel(cameraIds, check.changed_cameras);
      if (check.camera_source === 'VIEW_MATCH')
        // 1단계 헬퍼가 이전 맵을 만들 때의 카메라 사진과 지금 화면을 비교했다(S15P31A101-712)
        return {
          blocked: {
            what: names ? `카메라가 바뀐 것 같아요(${names})` : '카메라가 바뀐 것 같아요',
            how: `이전 맵을 만들 때와 화면이 달라요 · ${NEW_MAP_HOW}`,
          },
          note: null,
        };
      return {
        blocked: {
          what: names
            ? `${names}의 위치나 방향이 직전 세팅과 달라졌어요`
            : '카메라 배치가 직전 세팅과 달라졌어요',
          how: NEW_MAP_HOW,
        },
        note: null,
      };
    }
    default:
      return { blocked: CHECK_FAILED, note: null };
  }
}

/** 직전 보정과 달라진 카메라: 서버가 카메라 변화(CHANGED)라고 판정했을 때만(-540 관제 회전 감시·1단계 시점 확인(-712)·직전 재사용 거부). */
export function changedCamerasOf(check: ReuseCheck): readonly string[] {
  return check.camera_status === 'CHANGED' || check.blocked_reason === 'CAMERA_CHANGED'
    ? check.changed_cameras
    : NONE;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 한국 시간 「MM-DD(요일) HH:mm」. */
export function mapDateLabel(ms: number): string {
  // 한국은 일광 절약 시간이 없어 UTC+9 고정이다
  const d = new Date(ms + 9 * 3_600_000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}(${WEEKDAYS[d.getUTCDay()]}) ${two(
    d.getUTCHours(),
  )}:${two(d.getUTCMinutes())}`;
}

const EXCLUDED_NOTE: Record<string, string> = {
  CAMERA_CHECK_NOT_PASSED: '그날 카메라 확인을 통과하지 못한 맵이에요',
  NOT_COMPLETED: '세팅 완료까지 하지 않은 맵이에요',
  MAP_RETIRED: '더는 쓰지 않는 맵이에요',
  NO_CALIBRATION: '보정 기록이 없어 쓸 수 없어요',
  CAMERAS_CHANGED: '그때와 카메라 구성이 달라요',
};

/** 후보 맵 하나의 상태 한 줄. */
export function mapNoteOf(
  candidate: ReuseCandidate,
  cameraIds: readonly string[],
  helperLost = false,
): string {
  const names = (ids: readonly string[]) => changedCamerasLabel(cameraIds, ids);
  switch (candidate.status) {
    case 'MATCH':
      return '카메라가 그때와 같은 자리예요';
    case 'SHIFTED':
      return `그때보다 조금 돌아간 카메라: ${names(candidate.shifted_cameras)}`;
    case 'CHANGED':
      return candidate.changed_cameras.length > 0
        ? `위치나 방향이 그때와 다른 카메라: ${names(candidate.changed_cameras)}`
        : '카메라 배치가 그때와 달라요';
    case 'EXCLUDED':
      return EXCLUDED_NOTE[candidate.reason ?? ''] ?? '쓸 수 없는 맵이에요';
    default:
      if (candidate.reason === 'NO_PHOTOS') return '그 맵의 카메라 사진이 없어 확인할 수 없어요';
      if (helperLost) return '게이트웨이 연결이 끊겨 카메라 위치를 확인할 수 없어요';
      if (candidate.reason === 'CHECKING' && candidate.unconfirmed_cameras.length > 0)
        return `확인하고 있는 카메라: ${names(candidate.unconfirmed_cameras)}`;
      return '카메라 위치를 확인하고 있어요';
  }
}

/** 서버 후보 목록 → 화면 목록(순서는 서버 순위 그대로). */
export function reuseMapsOf(
  check: ReuseCheck,
  cameraIds: readonly string[],
  helperLost = false,
): ReuseMapOption[] {
  return (check.candidates ?? []).map((c) => {
    const ordered = cameraIds.length > 0 ? cameraIds : Object.keys(c.camera_heights_m).sort();
    const heights = ordered
      .map((id) => c.camera_heights_m[id])
      .filter((h): h is number => typeof h === 'number');
    return {
      id: c.setup_session_id,
      dateLabel: mapDateLabel(c.completed_at_ms),
      completedAtMs: c.completed_at_ms ?? 0,
      selectable: c.selectable && c.status === 'MATCH',
      recommended: c.recommended,
      status: c.status,
      note: mapNoteOf(c, cameraIds, helperLost),
      heightsLabel: heights.length > 0 ? `${heights.map((h) => h.toFixed(2)).join('·')} m` : '',
    };
  });
}

/**
 * 시작할 맵: 사용자가 고른 맵이 아직 고를 수 있으면 그 맵, 아니면 추천 맵. 고를 수 있는 맵이 없으면 null.
 * (헬퍼 결과가 바뀌어 고른 맵이 어긋나면 추천으로 돌아간다. 시작은 서버가 같은 판정으로 다시 본다.)
 */
export function chosenReuseMap(
  maps: readonly ReuseMapOption[],
  picked: string | null,
  recommendedId: string | null,
): string | null {
  if (picked && maps.some((m) => m.id === picked && m.selectable)) return picked;
  return recommendedId && maps.some((m) => m.id === recommendedId && m.selectable)
    ? recommendedId
    : null;
}

/** 켜져 있는 동안(1단계) 재사용 판정을 받아 둔다. helperLost: 현장 게이트웨이의 카메라 헬퍼가 오래 답하지 않는다(S15P31A101-719). */
export function useReuseChoice(
  enabled: boolean,
  cameraIds: readonly string[],
  helperLost = false,
): ReuseChoiceState {
  const query = useQuery({
    queryKey: SETUP_REUSE_CHECK_KEY,
    queryFn: ({ signal }) => requestReuseCheck(api, signal),
    enabled,
    staleTime: 0,
    refetchInterval: enabled ? REUSE_CHECK_POLL_MS : false,
  });
  if (query.data)
    return {
      checking: false,
      ...reuseChoiceOf(query.data, cameraIds, helperLost),
      changedCameras: changedCamerasOf(query.data),
      maps: reuseMapsOf(query.data, cameraIds, helperLost),
      recommendedId: query.data.recommended_setup_session_id ?? null,
    };
  if (query.isError)
    return {
      checking: false,
      blocked: CHECK_FAILED,
      note: null,
      changedCameras: NONE,
      maps: NO_MAPS,
      recommendedId: null,
    };
  return {
    checking: enabled,
    blocked: null,
    note: null,
    changedCameras: NONE,
    maps: NO_MAPS,
    recommendedId: null,
  };
}
