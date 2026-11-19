import { cameraShortLabel, neighborPairs, pairLabel } from '@/features/setup/cameraLabels';
import type {
  CameraCheck,
  CameraCheckPhase,
  QualityGate,
  SetupSessionResponse,
} from '@/features/setup/types';

// 세팅 「보정 검증 결과」 쌍별 표와 「카메라 확인」 카드(S15P31A101-646, docs/design/S15P31A101-646-setup-camera-check.md).
// 관제에서 뜨는 카메라 경고(쌍 에피폴라·잔차 실패, 한 카메라 제외 재투영 틀어짐)를 세팅에서 같은 계산으로 먼저 통과해야 다음 단계로
// 간다. 판정은 워커(보정 품질 게이트·카메라 확인)와 서버(camera_check_passed)가 하고, 화면은 그 판정을 그대로 보인다.
// S15P31A101-687: 카메라 확인은 맵을 굽기 전에 큰 걷기 창(CameraCheckModal)에서 한다. 사용자가 「걷기 시작」을 눌러야 시작하고,
// 실패하면 보정은 그대로 두고 「확인만 다시(30초)」 한다. 창의 단계는 서버 camera_check_phase 를 그대로 쓴다.

export type CameraCheckStatus = CameraCheck['status'] | 'NONE';

/** 녹화 재생 시험이라 걷기 확인을 건너뛴 세션의 표시 문구(S15P31A101-736). */
export const REPLAY_SKIP_LABEL = '재생 시험: 걷기 확인 생략';
/** 그 설명. */
export const REPLAY_SKIP_DETAIL =
  '녹화 파일을 재생하는 시험이라 사람 걷기 확인 없이 다음 단계로 갑니다(EC2 재생 시험 스위치 SIMAI_REPLAY_TEST_SKIP_CAMERA_CHECK). 실제 카메라 세팅에서는 걷기 확인을 그대로 합니다.';
/** 표 한 행의 종합 판정: 통과 · 실패 · 아직 모름(재는 중·근거 부족) · 해당 없음(시야가 겹치지 않는 쌍). */
export type PairOutcome = 'pass' | 'fail' | 'pending' | 'na';

export interface CameraCheckPairRow {
  key: string;
  label: string;
  /** 세팅 보정의 배경 특징점 홀드아웃 재투영 오차(중앙값·p90, px). 그 쌍을 보정에 쓰지 않았으면 null. */
  holdoutMedianPx: number | null;
  holdoutP90Px: number | null;
  holdoutVerdict: QualityGate['pairs'][string]['verdict'] | null;
  /** 카메라 확인의 쌍 통과율(0~1). 근거가 없으면 null. */
  passRate: number | null;
  samples: number;
  checkVerdict: CameraCheck['pairs'][string]['verdict'] | null;
  outcome: PairOutcome;
}

export interface CameraCheckCameraRow {
  cameraId: string;
  label: string;
  observedViews: number;
  looMedianPx: number | null;
  verdict: CameraCheck['cameras'][string]['verdict'];
}

export interface CameraCheckView {
  status: CameraCheckStatus;
  /** 서버 걷기 창 단계(-687). 모르는 이전 서버면 null. */
  phase: CameraCheckPhase | null;
  progressPct: number;
  elapsedS: number;
  /**
   * 서버가 카메라 확인 관문을 아는지(camera_check_passed 를 싣는다). 모르는 이전 서버는 관문이 없어 화면도 막지 않고 카드를 숨긴다.
   */
  gated: boolean;
  /** 서버 관문 판정(구역 단계·세팅 완료를 받는지). 관문을 모르는 서버면 true(막지 않는다). */
  passed: boolean;
  /** 녹화 재생 시험이라 걷기 확인을 건너뛰었다(camera_check SKIPPED_REPLAY, S15P31A101-736). */
  skippedForReplay: boolean;
  qualityVerdict: QualityGate['verdict'] | null;
  pairs: CameraCheckPairRow[];
  cameras: CameraCheckCameraRow[];
  /** 관리자에게 보일 원인 문장(품질 게이트 실패·확인 실패). */
  problems: string[];
}

const sameIds = (ids: readonly string[], a: string, b: string) =>
  ids.length === 2 && ((ids[0] === a && ids[1] === b) || (ids[0] === b && ids[1] === a));

function pairOutcome(
  holdout: QualityGate['pairs'][string] | undefined,
  check: CameraCheck['pairs'][string] | undefined,
): PairOutcome {
  if (holdout?.verdict === 'FAIL' || check?.verdict === 'FAIL') return 'fail';
  if (check?.verdict === 'PASS') return 'pass';
  if (check?.verdict === 'NOT_OVERLAPPING' && holdout?.verdict !== 'NEEDS_CHECK') return 'na';
  return 'pending';
}

/** 세션 조회의 quality_gate·camera_check·camera_check_passed 를 표와 카드로 바꾼다. 카메라 쌍은 보정이 쓰는 옆 쌍만 카메라 순서로 만든다(마주 보는 쌍은 서버가 판정을 줘도 표에 두지 않는다). */
export function deriveCameraCheckView(
  session: SetupSessionResponse | null | undefined,
  cameraIds: readonly string[],
): CameraCheckView {
  const gate = session?.quality_gate ?? null;
  const check = session?.camera_check ?? null;
  const holdouts = Object.values(gate?.pairs ?? {});
  const checks = Object.values(check?.pairs ?? {});
  const pairs: CameraCheckPairRow[] = neighborPairs(cameraIds).map(({ a, b }) => {
    const holdout = holdouts.find((p) => sameIds(p.camera_ids, a, b));
    const pc = checks.find((p) => sameIds(p.camera_ids, a, b));
    return {
      key: `${a}|${b}`,
      label: pairLabel(cameraIds, a, b),
      holdoutMedianPx: holdout?.median_px ?? null,
      holdoutP90Px: holdout?.p90_px ?? null,
      holdoutVerdict: holdout?.verdict ?? null,
      passRate: pc?.pass_rate ?? null,
      samples: pc?.samples ?? 0,
      checkVerdict: pc?.verdict ?? null,
      outcome: pairOutcome(holdout, pc),
    };
  });
  const cameras: CameraCheckCameraRow[] = Object.entries(check?.cameras ?? {})
    .map(([cameraId, c]) => ({
      cameraId,
      label: cameraShortLabel(cameraIds, cameraId),
      observedViews: c.observed_views,
      looMedianPx: c.loo_median_px,
      verdict: c.verdict,
    }))
    .sort((x, y) => cameraIds.indexOf(x.cameraId) - cameraIds.indexOf(y.cameraId));
  const problems = [
    ...(gate?.verdict === 'FAILED' ? gate.problems.map((p) => p.message) : []),
    ...(check && (check.status === 'FAILED' || check.status === 'INCOMPLETE')
      ? check.problems.map((p) => p.message)
      : []),
  ];
  return {
    status: check?.status ?? 'NONE',
    phase: session?.camera_check_phase ?? null,
    progressPct: check ? Math.max(0, Math.min(100, check.progress_pct)) : 0,
    elapsedS: check?.elapsed_s ?? 0,
    // 고른 맵을 그대로 쓰는 재사용(S15P31A101-714)은 걷기 확인 대신 1단계 시점 확인을 통과해 시작했다(관문 없음)
    gated: !session?.reuse_source && typeof session?.camera_check_passed === 'boolean',
    passed: Boolean(session?.reuse_source) || session?.camera_check_passed !== false,
    skippedForReplay: check?.status === 'SKIPPED_REPLAY',
    qualityVerdict: gate?.verdict ?? null,
    pairs,
    cameras,
    problems,
  };
}

/**
 * 카메라 확인이 끝났는데 통과하지 못했고 더는 확인만 다시 할 수 없다(다시 보정해야 한다). 걷기 창 단계를 아는 서버면 그 단계가
 * FAILED 일 때만이다(RETRY_WAIT 는 걷기 창이 「확인만 다시」를 받는다).
 */
export function cameraCheckFailed(view: CameraCheckView): boolean {
  if (view.phase !== null) return view.phase === 'FAILED';
  return view.status === 'FAILED' || view.status === 'INCOMPLETE';
}

/** 2단계 '다음' 을 막는 이유(카메라 확인 미통과). 통과면 null. */
export function cameraCheckBlockReason(view: CameraCheckView): string | null {
  if (view.passed) return null;
  return cameraCheckFailed(view)
    ? '걷기 확인을 다시 받을 시간이 끝났어요. 「다시 보정」으로 새 세팅을 시작해 주세요'
    : '카메라 확인을 마치면 넘어갈 수 있어요';
}

// ---- 걷기 창(S15P31A101-687) ----

/** 걷기 목표 시간(초). 워커 판정 하한(thresholds.min_duration_s)과 같고 화면은 이만큼 센다. */
export const WALK_TARGET_SECONDS = 30;

/** 표본 부족(사람이 덜 걸었다) 사유. 그 밖의 사유는 기하 실패(카메라 위치가 보정과 맞지 않음)로 안내한다. */
const SHORTAGE_REASONS = new Set([
  'FEW_SAMPLES',
  'NO_PERSON',
  'NOT_FINISHED',
  'NOT_OBSERVED',
  'NOT_CONFIRMED',
  'FEW_PAIRS',
  'NOT_STARTED',
]);

export interface WalkCameraView {
  id: string;
  label: string;
  /** 사람이 보인 시각 수와 목표(min_camera_views). */
  observed: number;
  need: number;
  /** 최근 1.5초 안에 사람이 보였다. 모르면(걷는 중이 아니거나 이전 워커) null. */
  visible: boolean | null;
  /** 실패 안내가 짚은 카메라(창에서 테두리로 표시). */
  flagged: boolean;
  /** 한 카메라 제외 재투영 표본 수와 목표(min_loo_samples, S15P31A101-759). 다른 카메라 여럿에 함께 보여야 쌓인다. */
  looSamples: number;
  looNeed: number;
  /** 사람은 충분히 보였는데 재투영 표본이 모자라다(방 가운데를 지나야 찬다, S15P31A101-763). */
  looShort: boolean;
}

export interface WalkFailure {
  /** shortage: 표본 부족(사람이 덜 걸음) · geometry: 기하 실패(카메라 위치가 보정과 맞지 않음). */
  kind: 'shortage' | 'geometry';
  title: string;
  action: string;
}

export interface CameraWalkView {
  /** 걷기 창을 띄울 단계(걷기 시작 대기·시작하는 중·걷는 중·확인만 다시 대기). */
  open: boolean;
  phase: CameraCheckPhase | null;
  /** 지금 시도 번호(없으면 0)와 「걷기 시작」·「확인만 다시」가 보낼 다음 번호. */
  attemptNo: number;
  /**
   * 카운트다운을 다시 세는 기준(세션 + 워커 시도 ID). 다시 시도로 새 세션이 같은 번호(1)로 걸어도 앞 세션의 시작 시각을 쓰지 않는다
   * (S15P31A101-719: 걷기 시작 직후 0초로 보이던 것).
   */
  attemptKey: string;
  nextAttempt: number;
  progressPct: number;
  cameras: WalkCameraView[];
  pairs: WalkPairView[];
  /** 실패 안내(RETRY_WAIT). 아니면 null. */
  failure: WalkFailure | null;
  /** 워커가 걷기를 기다리는 남은 초(스냅샷 값, 대략). 모르면 null. */
  waitSeconds: number | null;
}

export interface WalkPairView {
  key: string;
  label: string;
  samples: number;
  need: number;
  required: boolean;
  shortage: boolean;
  /** 필수 쌍인데 아직 한 번도 함께 보이지 않았다(걷는 중 강조, S15P31A101-763). */
  zero: boolean;
}

/**
 * 워커 판정 기준 값(camera_check.thresholds, 계약 site_setup). 응답에 criteria 로 오면 그 값을 쓰고, 없거나 틀리면 기본값이다
 * (기본값은 워커 기본 설정과 같다).
 */
function checkThreshold(check: CameraCheck | null, key: string, fallback: number): number {
  if (!check) return fallback;
  for (const group of ['thresholds', 'criteria']) {
    const box: unknown = Reflect.get(check, group);
    const value: unknown = typeof box === 'object' && box !== null ? Reflect.get(box, key) : null;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

const minCameraViews = (check: CameraCheck | null) => checkThreshold(check, 'min_camera_views', 30);
const minPairSamples = (check: CameraCheck | null) => checkThreshold(check, 'min_pair_samples', 30);
/** 카메라별 한 카메라 제외 재투영 표본 목표(-759 FEW_SAMPLES 기준). 워커 기본 20. */
const minLooSamples = (check: CameraCheck | null) => checkThreshold(check, 'min_loo_samples', 20);

/** 실패 사유를 표본 부족·기하 실패로 나눠 「카메라 4에서 사람이 충분히 보이지 않았습니다」처럼 카메라 번호로 안내한다. */
export function walkFailure(check: CameraCheck, cameraIds: readonly string[]): WalkFailure {
  const problems = check.problems;
  const label = (id: string) => cameraShortLabel(cameraIds, id);
  const shortage = problems.length > 0 && problems.every((p) => SHORTAGE_REASONS.has(p.reason));
  if (shortage) {
    if (problems.some((p) => p.reason === 'NO_PERSON' || p.reason === 'NOT_STARTED'))
      return {
        kind: 'shortage',
        title: '어느 카메라에서도 사람이 보이지 않았습니다',
        action: '한 사람이 카메라 4대에 모두 보이도록 30초만 다시 걸어 주세요',
      };
    const cams = [
      ...new Set(problems.filter((p) => p.kind === 'CAMERA').flatMap((p) => p.camera_ids)),
    ];
    // 사람은 충분히 보였는데 FEW_SAMPLES 인 카메라는 4대에 함께 보인 표본(재투영)이 모자란 것이다(-759): 방 가운데로 안내한다
    const seen = minCameraViews(check);
    const looOnly =
      cams.length > 0 && cams.every((id) => (check.cameras[id]?.observed_views ?? 0) >= seen);
    if (looOnly)
      return {
        kind: 'shortage',
        title: cams.map(label).join(', ') + '에 다른 카메라와 함께 보인 시간이 모자랐습니다',
        action: '방 가운데(카메라 4대가 모두 보는 곳)를 천천히 돌며 다시 걸어 주세요',
      };
    if (cams.length > 0)
      return {
        kind: 'shortage',
        title: cams.map(label).join(', ') + '에서 사람이 충분히 보이지 않았습니다',
        action: '표시된 구간을 지나며 30초만 다시 걸어 주세요',
      };
    const pairs = problems.filter((p) => p.kind === 'PAIR' && p.camera_ids.length === 2);
    if (pairs.length > 0)
      return {
        kind: 'shortage',
        title:
          pairs.map((p) => label(p.camera_ids[0]!) + '·' + label(p.camera_ids[1]!)).join(', ') +
          '가 함께 보는 곳에서 사람이 충분히 보이지 않았습니다',
        action: '두 카메라가 함께 보는 곳을 지나며 30초만 다시 걸어 주세요',
      };
    return {
      kind: 'shortage',
      title: '걸은 시간이 모자랐습니다',
      action: '멈추지 말고 30초 동안 계속 걸어 주세요',
    };
  }
  const flagged = [...new Set(problems.flatMap((p) => p.camera_ids))];
  return {
    kind: 'geometry',
    title:
      flagged.length > 0
        ? flagged.map(label).join(', ') + ' 위치가 보정과 맞지 않습니다'
        : '카메라 위치가 보정과 맞지 않습니다',
    action:
      '카메라가 흔들리지 않았는지 확인한 뒤 확인만 다시 하세요. 계속 실패하면 현재 시도를 중단하고 다시 보정해 주세요',
  };
}

const OPEN_PHASES = new Set<CameraCheckPhase>([
  'AWAITING_START',
  'STARTING',
  'WALKING',
  'RETRY_WAIT',
]);

/** 세션 조회의 camera_check·camera_check_phase 를 걷기 창 모양으로 바꾼다. 걷기 창 단계를 모르는 이전 서버면 열지 않는다. */
export function deriveCameraWalkView(
  session: SetupSessionResponse | null | undefined,
  cameraIds: readonly string[],
): CameraWalkView {
  const check = session?.camera_check ?? null;
  const phase = session?.camera_check_phase ?? null;
  const attemptNo = check?.attempt?.no ?? 0;
  const need = minCameraViews(check);
  const retrying = phase === 'RETRY_WAIT' && check !== null;
  const flagged = new Set(retrying ? check.problems.flatMap((p) => p.camera_ids) : []);
  const showCounts = phase === 'WALKING' || phase === 'RETRY_WAIT';
  const ids = cameraIds.length > 0 ? cameraIds : Object.keys(check?.cameras ?? {});
  const requiredSamples = minPairSamples(check);
  const looNeed = minLooSamples(check);
  return {
    open: phase !== null && OPEN_PHASES.has(phase),
    phase,
    attemptNo,
    attemptKey: `${session?.setup_session_id ?? ''}:${check?.attempt?.id ?? attemptNo}`,
    nextAttempt: attemptNo + 1,
    progressPct: check && showCounts ? Math.max(0, Math.min(100, check.progress_pct)) : 0,
    cameras: ids.map((id) => {
      const cam = check?.cameras[id];
      const observed = showCounts ? (cam?.observed_views ?? 0) : 0;
      const looSamples = showCounts ? (cam?.loo_samples ?? 0) : 0;
      return {
        id,
        label: cameraShortLabel(cameraIds, id),
        observed,
        need,
        visible: phase === 'WALKING' ? (cam?.person_visible ?? null) : null,
        flagged: flagged.has(id),
        looSamples,
        looNeed,
        looShort: showCounts && cam !== undefined && observed >= need && looSamples < looNeed,
      };
    }),
    // 걷기는 서버가 검사하는 모든 쌍을 표시한다(보정 오차 표의 옆 쌍 제한과 다름).
    pairs: Object.entries(check?.pairs ?? {}).flatMap(([key, pair]) => {
      if (pair.camera_ids.length !== 2) return [];
      return [
        {
          key,
          label: pairLabel(ids, pair.camera_ids[0]!, pair.camera_ids[1]!),
          samples: showCounts ? pair.samples : 0,
          need: requiredSamples,
          required: pair.required,
          shortage: showCounts && pair.required && pair.samples < requiredSamples,
          zero: showCounts && pair.required && pair.samples === 0,
        },
      ];
    }),
    failure: retrying ? walkFailure(check, cameraIds) : null,
    waitSeconds: check?.user_wait ? Math.max(0, Math.round(check.user_wait.wait_s)) : null,
  };
}

/** 걷기 시작 뒤 이만큼(초) 지나도 어느 카메라에도 사람이 한 번도 안 보였으면 창 안에서 원인을 알린다. */
export const NO_PERSON_HINT_AFTER_S = 10;

export interface WalkStatus {
  /** 창 맨 위 상태 한 줄. */
  status: string;
  /** 걷는 중 끼어드는 안내(사람이 계속 안 보임). 없으면 null. */
  hint: { title: string; action: string } | null;
}

/**
 * 걷기 창 맨 위 문구(S15P31A101-719). 걷는 중 일정 시간 동안 모든 카메라가 0 회면 「사람이 안 보임」 원인과 할 일을 창 안에 보이고
 * (예전에는 0/30 이 이어지다 마감 뒤 조용히 실패했다), 카운트다운이 끝났는데 덜 보인 카메라가 있으면 그 카메라 이름을 쓴다.
 */
export function walkStatus(view: CameraWalkView, secondsLeft: number): WalkStatus {
  const { phase } = view;
  if (phase === 'AWAITING_START')
    return { status: '보정이 끝났습니다. 아래처럼 걸으면 확인이 끝납니다.', hint: null };
  if (phase === 'STARTING')
    return { status: '확인을 준비하는 중입니다. 곧 걷기를 시작합니다.', hint: null };
  if (phase !== 'WALKING')
    return { status: view.failure?.action ?? '확인을 다시 해 주세요.', hint: null };
  const elapsed = WALK_TARGET_SECONDS - secondsLeft;
  const nobody = view.cameras.length > 0 && view.cameras.every((c) => c.observed === 0);
  const hint =
    nobody && elapsed >= NO_PERSON_HINT_AFTER_S
      ? {
          title: `${elapsed}초 동안 어느 카메라에도 사람이 보이지 않았어요`,
          action:
            '한 사람만 카메라 앞을 천천히 지나가 주세요(다른 사람은 화면 밖). 계속 0이면 현재 시도를 중단하고 GPU 서버에서 영상을 받는지 확인하세요.',
        }
      : null;
  if (secondsLeft > 0)
    return { status: '걷는 중입니다. 카메라 사이 겹치는 곳을 고루 지나가 주세요.', hint };
  const short = view.cameras.filter((c) => c.observed < c.need).map((c) => c.label);
  const shortPairs = view.pairs.filter((p) => p.shortage).map((p) => p.label);
  const looShort = view.cameras.filter((c) => c.looShort).map((c) => c.label);
  return {
    status:
      shortPairs.length > 0 && !nobody
        ? `함께 보인 횟수가 모자라요: ${shortPairs.join(', ')}. 두 카메라가 함께 보는 곳을 지나가 주세요.`
        : short.length > 0 && !nobody
          ? `조금만 더 걸어 주세요. 덜 보인 카메라: ${short.join(', ')}. 그 카메라 앞을 지나가면 끝납니다.`
          : looShort.length > 0 && !nobody
            ? `방 가운데(카메라 ${view.cameras.length}대가 모두 보는 곳)를 지나가 주세요. 아직 모자란 카메라: ${looShort.join(', ')}.`
            : '조금만 더 걸어 주세요. 사람이 덜 보인 카메라 앞을 지나가면 끝납니다.',
    hint,
  };
}

// ---- 걷기 전 안내·지금 보는 카메라(S15P31A101-763) ----
// 11-15~16 걷기 확인 실패 중 「어느 카메라에서도 사람이 보이지 않았습니다」 3회, 「함께 보인 시간 0/30」 1회. 누적 수치만으로는 걷는 사람이
// 지금 몇 대에 잡히는지, 어디를 걸어야 하는지 몰랐다. 계약·서버를 바꾸지 않고 기존 요약(observed_views·person_visible)으로만 계산한다.

/** 걷기 시작 전 안내(걷는 방법). 옆 카메라 쌍은 카메라 순서대로 고리를 돈다(1–2, 2–3, 3–4, 4–1). */
export function walkGuide(cameraIds: readonly string[]): string[] {
  const n = cameraIds.length;
  const starts = n < 2 ? [] : n === 2 ? [0] : cameraIds.map((_, i) => i);
  const ring = starts.map((i) => pairLabel(cameraIds, cameraIds[i]!, cameraIds[(i + 1) % n]!));
  return [
    '한 사람만 걸어요. 다른 사람은 카메라 밖에 있어 주세요.',
    `방 가운데(카메라 ${n}대가 모두 보는 곳)를 천천히 크게 돌아요.`,
    ...(ring.length > 0
      ? [`옆 카메라 둘이 함께 보는 곳을 한 번씩 지나가요: ${ring.join(', ')}.`]
      : []),
    '60~90초 걸어요. 확인이 끝나면 창이 저절로 닫혀요.',
  ];
}

/** 이만큼(ms) 안에 관측 수가 늘었으면 「지금 보는」 카메라로 켠다. 워커 요약은 2초마다 오고 화면도 2초마다 받아 한 번 건너뛸 수 있다. */
export const LIVE_HOLD_MS = 4_500;
/** 걷는 중 이만큼(ms) 동안 어느 카메라도 관측 수가 늘지 않으면 「사람이 안 보입니다」 경고. */
export const NO_PERSON_WARN_MS = 5_000;

/** 지금 보는 카메라 추적 상태(브라우저 시계). 시도(attemptKey)가 바뀌면 새로 시작한다. */
export interface LiveCameraTracker {
  attemptKey: string;
  /** 이 시도의 걷기를 처음 본 시각. */
  startedMs: number;
  /** 마지막으로 계산한 시각. */
  nowMs: number;
  /** 카메라별 마지막으로 받은 관측 수. */
  counts: Readonly<Record<string, number>>;
  /** 카메라별 관측 수가 마지막으로 늘었거나 워커가 최근 보였다고 한(person_visible) 시각. */
  seenMs: Readonly<Record<string, number>>;
}

/** 시계가 갈 때마다 지금 요약의 카메라별 관측 수를 앞 값과 견줘 늘어난 카메라를 기록한다. 순수 함수다. */
export function trackLiveCameras(
  prev: LiveCameraTracker | null,
  view: CameraWalkView,
  nowMs: number,
): LiveCameraTracker {
  const base = prev !== null && prev.attemptKey === view.attemptKey ? prev : null;
  const counts: Record<string, number> = {};
  const seenMs: Record<string, number> = base ? { ...base.seenMs } : {};
  for (const camera of view.cameras) {
    counts[camera.id] = camera.observed;
    // 처음 본 값은 기준이다(창을 늦게 열면 이미 쌓인 수가 있다). 그 뒤 늘었으면 지금 보는 것이다
    const before = base?.counts[camera.id];
    const grew = before !== undefined && camera.observed > before;
    if (grew || camera.visible === true) seenMs[camera.id] = nowMs;
  }
  return {
    attemptKey: view.attemptKey,
    startedMs: base ? base.startedMs : nowMs,
    nowMs,
    counts,
    seenMs,
  };
}

export interface LiveCamerasView {
  cameras: { id: string; label: string; live: boolean }[];
  liveCount: number;
  total: number;
  /** 걷는 중 NO_PERSON_WARN_MS 동안 어느 카메라도 늘지 않았다. */
  noPerson: boolean;
}

/** 추적 상태를 「지금 보는 카메라 n/4」 표시로 바꾼다. */
export function liveCameras(tracker: LiveCameraTracker, view: CameraWalkView): LiveCamerasView {
  const now = tracker.nowMs;
  const cameras = view.cameras.map((c) => {
    const seen = tracker.seenMs[c.id];
    return { id: c.id, label: c.label, live: seen !== undefined && now - seen <= LIVE_HOLD_MS };
  });
  const lastSeen = Math.max(tracker.startedMs, ...Object.values(tracker.seenMs));
  return {
    cameras,
    liveCount: cameras.filter((c) => c.live).length,
    total: cameras.length,
    noPerson: cameras.length > 0 && now - lastSeen >= NO_PERSON_WARN_MS,
  };
}
