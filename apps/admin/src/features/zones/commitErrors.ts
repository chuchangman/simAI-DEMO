import { SetupZonePlanEditError } from '@/features/setup/setupZonePlan';
import { ApiError } from '@/lib/http';
import { HTTP_FORBIDDEN, outcomeUnknown } from '@/lib/writeFailure';

// 구역 편집 저장(POST /api/zones/commit) 실패 문구. 서버 오류 이름(ProblemDetail code)을 먼저 보고, 없으면 상태로 떨어진다
// (/commit 의 404·409 는 뜻이 여럿이라 상태만으로는 문구를 정할 수 없다).

type BlockedTarget = 'zone' | 'surface';
type BlockedReason = 'CHANGED' | 'UNCHECKED';

/**
 * 저장 직전 확인에서 멈춘 저장(서버에 보내지 않았다). CHANGED 는 그 사이 다른 관리자가 새 버전을 저장한 것이고(받은 목록은
 * 이미 화면에 넣었다), UNCHECKED 는 지금 버전을 확인하지 못한 것이다.
 */
export class CommitBlockedError extends Error {
  readonly target: BlockedTarget;
  readonly reason: BlockedReason;

  constructor(target: BlockedTarget, reason: BlockedReason, options?: { cause?: unknown }) {
    super(`구역 저장을 보내지 않았다 (${target} ${reason})`, options);
    this.name = 'CommitBlockedError';
    this.target = target;
    this.reason = reason;
  }
}

/**
 * 앞 저장이 아직 끝나지 않아 보내지 않은 저장(S15P31A101-651). 같은 화면에서 저장은 한 번에 하나만 보낸다. 받은 쪽은 알림 없이
 * 무시한다(앞 저장의 결과가 곧 화면에 들어온다).
 */
export class CommitInFlightError extends Error {
  constructor() {
    super('앞 구역 저장이 끝나지 않아 보내지 않았다');
    this.name = 'CommitInFlightError';
  }
}

const CHANGED_TEXT =
  '그 사이 다른 버전이 저장되어 최신 구역을 다시 받았습니다. 확인한 뒤 다시 저장하세요.';
const OUTCOME_UNKNOWN_TEXT =
  '저장됐는지 확인하지 못해 최신 구역을 다시 받았습니다. 확인한 뒤 다시 시도하세요.';
const FALLBACK_TEXT = '저장하지 못했습니다. 다시 시도하세요.';
const FORBIDDEN_TEXT = '구역을 저장할 권한이 없습니다.';

/** 저장 직전 확인에서 멈춘 대상·이유별 안내. */
const BLOCKED_TEXT: Record<BlockedTarget, Record<BlockedReason, string>> = {
  zone: {
    CHANGED: CHANGED_TEXT,
    UNCHECKED: '최신 구역을 확인하지 못해 저장하지 않았습니다. 다시 시도하세요.',
  },
  surface: {
    CHANGED:
      '그 사이 다른 버전이 저장되어 최신 작업면을 다시 받았습니다. 확인한 뒤 다시 저장하세요.',
    UNCHECKED: '최신 작업면을 확인하지 못해 저장하지 않았습니다. 다시 시도하세요.',
  },
};

/** 서버가 오류 상태로 답했을 때의 안내(오류 이름별). */
const CODE_TEXT = new Map<string, string>([
  ['INVALID_POLYGON', '바닥 다각형이 꼬였거나 넓이가 없어 저장하지 못했습니다.'],
  ['INVALID_Z_RANGE', '높이 범위가 맞지 않아 저장하지 못했습니다(최저 < 최고).'],
  ['INVALID_STATIC_OBJECT', '작업면 값이 올바르지 않아 저장하지 못했습니다.'],
  ['INVALID_SURFACE_ZONE', '작업면만 구역에 이을 수 있습니다.'],
  ['INVALID_ZONE_COMMIT', '저장 요청이 올바르지 않습니다.'],
  ['CONCURRENT_EDIT', CHANGED_TEXT],
  [
    'LAYOUT_REVISION_CONFLICT',
    '다른 변경이 먼저 저장되었습니다. 최신 레이아웃을 확인한 뒤 다시 시도하세요.',
  ],
  [
    'SURFACE_ZONE_TAKEN',
    '이 구역에 이미 다른 작업면이 이어져 있거나 작업면이 다른 구역에 이어져 있습니다. 새로 받은 값을 확인하세요.',
  ],
  ['ZONE_NOT_FOUND', '이미 없거나 보관된 구역입니다. 목록을 다시 받았습니다.'],
  ['STATIC_OBJECT_NOT_FOUND', '이미 없거나 보관된 작업면입니다. 목록을 다시 받았습니다.'],
  ['SITE_NOT_SINGLE', '현장이 하나로 정해지지 않아 저장할 수 없습니다.'],
  // 세팅 구역 목록(-612·-615)
  [
    'SETUP_ZONE_PLAN_CONFLICT',
    '다른 곳에서 먼저 고친 세팅 구역 목록이라 다시 받았습니다. 확인한 뒤 다시 저장하세요.',
  ],
  ['SETUP_ZONES_CLOSED', '세팅을 완료했거나 작업이 시작돼 세팅 구역을 더 고칠 수 없습니다.'],
  ['INVALID_SETUP_ZONE_PLAN', '세팅 구역 목록 값이 올바르지 않아 저장하지 못했습니다.'],
  ['SETUP_ZONE_STALE', '목록의 기존 구역이 더 이상 관제 구역이 아닙니다. 목록을 다시 받았습니다.'],
]);

/** 저장 실패를 화면 알림 문구로. 서버가 자체 문구를 줘도 보이지 않는다(서버 내부 정보가 섞일 수 있다). */
export function commitErrorText(error: unknown): string {
  if (error instanceof CommitBlockedError) return BLOCKED_TEXT[error.target][error.reason];
  if (error instanceof SetupZonePlanEditError) return `${error.message}.`;
  if (!(error instanceof ApiError)) return FALLBACK_TEXT;
  const byCode = CODE_TEXT.get(error.code ?? '');
  if (byCode !== undefined) return byCode;
  if (error.status === HTTP_FORBIDDEN) return FORBIDDEN_TEXT;
  return outcomeUnknown(error) ? OUTCOME_UNKNOWN_TEXT : FALLBACK_TEXT;
}
