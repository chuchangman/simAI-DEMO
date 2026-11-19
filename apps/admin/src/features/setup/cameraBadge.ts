import type { CameraReceptionStatus } from '@/features/setup/types';

// 세팅 화면 카메라 칸의 배지 하나(S15P31A101-691). 카메라마다 지금 실제 상태 하나만 보인다. 우선순위는
// 연결 끊김 → 직전 보정과 달라짐 → 겹침 부족 → 각도 확인 필요 → 준비됨 이고, 근거가 없거나 오래되면 「확인 중」이다(정상으로 미루지 않는다).
// 근거는 이미 있는 것만 쓴다: 연결·각도·겹침은 게이트웨이 카메라 각도 안내(GET /api/cameras/coverage-guides, age_ms·stale),
// 직전 보정과 달라짐은 이전 맵 재사용 판정(GET /api/setup-sessions/reuse-check 의 changed_cameras: -540 관제 회전 감시의 재세팅 요구와
// 직전 재사용 거부). 15차에 「정상」 배지와 "왼쪽으로 더 돌려 주세요" 가 같이 뜨던 모순(수신 상태와 안내를 따로 보임)을 없앤다.

export type CameraBadgeKind =
  'DISCONNECTED' | 'CHANGED' | 'LOW_OVERLAP' | 'ANGLE' | 'READY' | 'CHECKING' | 'NO_HELPER';

/** 배지 색: 위험 등급색(sev-*)과 겹치지 않는 세팅 화면 톤(SetupTone 과 같은 값). */
export type CameraBadgeTone = 'ok' | 'active' | 'delay' | 'idle';

export interface CameraBadge {
  kind: CameraBadgeKind;
  label: string;
  tone: CameraBadgeTone;
}

export const CAMERA_BADGE_LABEL: Record<CameraBadgeKind, string> = {
  DISCONNECTED: '연결 끊김',
  CHANGED: '직전 보정과 달라짐',
  LOW_OVERLAP: '겹침 부족',
  ANGLE: '각도 확인 필요',
  READY: '준비됨',
  CHECKING: '확인 중',
  NO_HELPER: '확인 못 함',
};

const CAMERA_BADGE_TONE: Record<CameraBadgeKind, CameraBadgeTone> = {
  DISCONNECTED: 'delay',
  CHANGED: 'delay',
  LOW_OVERLAP: 'delay',
  ANGLE: 'active',
  READY: 'ok',
  CHECKING: 'idle',
  NO_HELPER: 'idle',
};

/** 한 카메라의 배지 근거. */
export interface CameraBadgeEvidence {
  /** 각도 안내가 준 수신 상태. 그 카메라 항목이 없으면 null(근거 없음). */
  status: CameraReceptionStatus | null;
  /** 수신 상태가 지금 것인지(받은 결과가 있고 오래되지 않았다). */
  fresh: boolean;
  /** 겹침·각도 판정까지 지금 것인지(fresh 이고 연결 판정 계산에 실패하지 않았다). */
  judged: boolean;
  /** 직전 보정과 달라진 카메라로 판정됐다(재사용 판정 changed_cameras). */
  changed: boolean;
  /** 이 카메라가 낀 옆 카메라 쌍의 겹침이 부족(LACK)하다. */
  lowOverlap: boolean;
  /** 이 카메라에 보이는 각도 안내가 있다. */
  hasGuide: boolean;
  /** 현장 게이트웨이의 카메라 헬퍼가 오래 답하지 않는다(coverageHelperLost). 없으면 false. */
  helperLost?: boolean;
}

const badgeOf = (kind: CameraBadgeKind): CameraBadge => ({
  kind,
  label: CAMERA_BADGE_LABEL[kind],
  tone: CAMERA_BADGE_TONE[kind],
});

/**
 * 카메라 배지 하나를 고른다. 연결 끊김은 지금 결과에서만 말한다(오래된 결과의 끊김은 모른다). 직전 보정과 달라짐은 각도 안내와
 * 따로 받은 근거라 각도 안내가 오래돼도 보인다. 그 밖은 각도 안내가 지금 것일 때만 판단하고, 아니면 「확인 중」이다.
 */
export function cameraBadgeOf(evidence: CameraBadgeEvidence): CameraBadge {
  const live = evidence.fresh && evidence.status !== null;
  if (live && evidence.status !== 'OK') return badgeOf('DISCONNECTED');
  if (evidence.changed) return badgeOf('CHANGED');
  if (!live && evidence.helperLost) return badgeOf('NO_HELPER');
  if (!live || !evidence.judged) return badgeOf('CHECKING');
  if (evidence.lowOverlap) return badgeOf('LOW_OVERLAP');
  if (evidence.hasGuide) return badgeOf('ANGLE');
  return badgeOf('READY');
}

/** 각도 안내 응답이 오래돼 근거로 쓰지 못하는 시점(ms, 이 브라우저 시계). 서버 기준(stale_after_ms, 기본 10 s)에서 받은 때의 나이를 뺀다. */
export const COVERAGE_STALE_AFTER_MS = 10_000;

export function coverageFreshUntil(
  receivedAtMs: number,
  ageMs: number | null | undefined,
  staleAfterMs: number | undefined,
): number {
  return receivedAtMs + (staleAfterMs ?? COVERAGE_STALE_AFTER_MS) - Math.max(0, ageMs ?? 0);
}

/**
 * 헬퍼가 끊겼다고 말하는 기준(ms). 헬퍼는 관리자가 보는 동안만 계산하고 CPU 한 라운드가 16~24 초라 서버 STALE(10 초)만으로는
 * 끊김이라 하지 않는다(S15P31A101-719).
 */
export const HELPER_LOST_AFTER_MS = 60_000;

/**
 * 현장 게이트웨이의 카메라 헬퍼가 오래 답하지 않는지(S15P31A101-719). 서버가 이미 주는 마지막 헬퍼 결과의 나이(age_ms)를 쓰고,
 * 서버가 헬퍼 결과를 한 번도 받지 못했으면(EMPTY, age_ms 없음) 이 브라우저가 처음 빈 응답을 받은 때(emptySinceMs)부터 잰다.
 * receivedAtMs 는 마지막 응답을 받은 시각(이 브라우저 시계)이다. 조회 자체가 실패하면(서버 연결 문제) 헬퍼 탓이라 하지 않는다.
 */
export function coverageHelperLost(
  data: { age_ms: number | null } | undefined,
  receivedAtMs: number,
  emptySinceMs: number | null,
): boolean {
  if (!data || receivedAtMs <= 0) return false;
  if (data.age_ms !== null) return data.age_ms >= HELPER_LOST_AFTER_MS;
  return emptySinceMs !== null && receivedAtMs - emptySinceMs >= HELPER_LOST_AFTER_MS;
}
