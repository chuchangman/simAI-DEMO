import { walkFailure } from '@/features/setup/cameraCheck';
import { cameraLabel, pairLabel } from '@/features/setup/cameraLabels';
import type { CameraCheck } from '@/features/setup/types';

// 서버 세팅 세션이 실패한 이유(failure_code)마다 무엇이 문제이고 어디서 어떻게 풀지 보이는 안내.
// retry 가 false 면 같은 상태로 다시 해도 같은 곳에서 멈추므로 '다시 시도' 없이 '카메라 연결 관리로' 만 둔다
// (서버는 FAILED 세션이면 늘 다시 시도를 받는다). 표에 없는 코드는 FALLBACK 이다.
// S15P31A101-719: 원인은 「자세히」를 열지 않아도 첫 줄에 보인다. 카메라 확인 실패는 걷기 창과 같은 문장(walkFailure)을 쓰고,
// 배경 미완료는 못 찍은 카메라 이름을 쓰고, 워커가 내는 그 밖의 코드도 표에 둔다. 서버 코드·메시지 원문은 화면에 쓰지 않는다.

/** 안내 문장을 만들 때 쓰는 이름들. 모르면 빈 글이다. */
export interface FailureNames {
  /** 실패 메시지에서 뽑은 카메라 쌍('카메라 1–카메라 2, 카메라 3–카메라 4'). */
  pairs: string;
  /** 직전 세팅과 달라진 카메라('카메라 2·카메라 3', 세션 world_anchor.changed_cameras). */
  changed: string;
  /** 실패 메시지가 짚은 카메라('카메라 2, 카메라 4'). 배경을 다 찍지 못한 카메라 등. */
  cameras: string;
}

export interface FailureEntry {
  /** 원인 한 줄. */
  title: (names: FailureNames) => string;
  /** 해결 방법. */
  fix: string;
  /** 같은 상태로 다시 시도해 볼 만한지. */
  retry: boolean;
  /** 「새 맵으로 다시 하기」를 보일지(이전 맵 재사용이 카메라 변화로 멈췄다, S15P31A101-689). */
  newMap?: boolean;
}

export interface FailureGuide {
  title: string;
  fix: string;
  retry: boolean;
  newMap: boolean;
}

/** 다시 시도한 뒤 걷기 창에서 할 일(카메라 확인 표본 부족·시작 안 함). */
const WALK_AGAIN = '다시 시도하면 처음부터 다시 하고, 카메라 확인 창이 열리면';

export const SETUP_FAILURES: Readonly<Record<string, FailureEntry>> = {
  BACKGROUND_INCOMPLETE: {
    title: ({ cameras }) =>
      cameras
        ? `${cameras}에서 사람 없는 배경을 다 찍지 못했어요`
        : '사람 없는 배경을 다 모으지 못했어요',
    fix: '그 카메라 앞에서 사람과 장비가 비키고 영상이 들어오는지 확인한 뒤 다시 시도하세요.',
    retry: true,
  },
  FLOOR_FIT_FAILED: {
    title: () => '바닥을 찾지 못했어요',
    fix: '카메라 연결 관리에서 카메라 높이를 확인하고, 바닥이 영상에 넓게 보이게 맞춘 뒤 다시 시작하세요.',
    retry: false,
  },
  INSUFFICIENT_FEATURES: {
    title: ({ pairs }) =>
      pairs
        ? `옆 카메라 ${pairs} 사이에 같이 보이는 곳이 적어요`
        : '옆 카메라끼리 같이 보이는 곳이 적어요',
    fix: '카메라 연결 관리로 돌아가 두 카메라를 서로 쪽으로 돌리거나, 겹치는 곳에 무늬 있는 물건을 두세요.',
    retry: false,
  },
  VALIDATION_REJECTED: {
    title: ({ pairs }) =>
      pairs
        ? `보정한 뒤 오히려 어긋난 카메라 쌍이 있어요 (${pairs})`
        : '보정 결과가 검증을 통과하지 못했어요',
    fix: '「다시 시도」를 누르면 같은 카메라와 높이 설정으로 세팅을 다시 시작합니다.',
    retry: true,
  },
  // 카메라 확인 걷기 마감까지 통과하지 못했다(맵을 굽지 않음). 문장은 cameraCheckGuide 가 확인 결과로 고르고, 이 줄은 결과가 없을 때다
  CAMERA_CHECK_NOT_PASSED: {
    title: () => '카메라 확인 걷기를 통과하지 못해 맵을 만들지 않았어요',
    fix: `${WALK_AGAIN} 한 사람이 카메라 앞을 고루 지나가며 30초 걸어 주세요.`,
    retry: true,
  },
  CAMERA_CHECK_UNAVAILABLE: {
    title: () => '카메라 확인에 쓸 관제 영상을 받지 못했어요',
    fix: 'GPU 서버에서 카메라 영상이 들어오는지 확인한 뒤 다시 시도하세요.',
    retry: true,
  },
  TIMEOUT: {
    title: () => '시간이 너무 오래 걸렸어요 (15분)',
    fix: '잠시 뒤 다시 시도하세요. 계속되면 관리자에게 알려 주세요.',
    retry: true,
  },
  SETUP_QUEUE_TIMEOUT: {
    title: () => 'GPU 서버가 세팅 작업을 가져가지 않았어요',
    fix: 'GPU 서버를 켜고 분석 워커가 연결됐는지 확인한 뒤 다시 시도하세요.',
    retry: true,
  },
  CANCELLED_BY_ADMIN: {
    title: () => '세팅을 취소했어요',
    fix: '다시 시작하려면 다시 시도하세요.',
    retry: true,
  },
  // 워커 쪽 대여가 취소·시간 초과로 끝났다(관리자 취소는 CANCELLED_BY_ADMIN)
  CANCELLED: {
    title: () => '분석 서버에서 세팅 작업이 중간에 끊겼어요',
    fix: 'GPU 서버가 켜져 있는지 확인한 뒤 다시 시도하세요.',
    retry: true,
  },
  LIVE_EXP_BLOCKED: {
    title: () => '작업(관제)이 진행 중이라 정밀 맵을 굽지 못했어요',
    fix: '작업을 종료한 뒤 다시 시도하세요.',
    retry: true,
  },
  INVALID_INPUT: {
    title: () => '세팅 요청 값이 맞지 않아 시작하지 못했어요',
    fix: '카메라 연결 관리에서 카메라와 높이 칸을 확인한 뒤 다시 시작하세요.',
    retry: false,
  },
  INTERNAL_CONTRACT_ERROR: {
    title: () => '분석 서버 결과 형식이 맞지 않아 멈췄어요',
    fix: '서버와 분석 서버 버전이 맞지 않을 수 있어요. 관리자에게 알려 주세요.',
    retry: true,
  },
  // 이전 맵 재사용의 World 다시 맞추기가 거부됐다. 새 맵(약 13분)으로 저절로 넘어가지 않고 멈춘다(S15P31A101-689): 무엇이 / 어떻게
  REUSE_WORLD_REJECTED: {
    title: ({ changed }) =>
      changed
        ? `${changed}의 위치나 방향이 직전 세팅과 달라졌어요`
        : '카메라를 직전 세팅과 맞추지 못해 이전 맵을 쓸 수 없어요',
    fix: '새 맵으로 다시 하세요.',
    retry: false,
    newMap: true,
  },
  LEASE_EXPIRED: {
    title: () => '분석 서버와 연결이 끊겼어요',
    fix: '분석 서버가 켜져 있는지 확인한 뒤 다시 시도하세요.',
    retry: true,
  },
};

const FALLBACK: FailureEntry = {
  title: () => '서버에서 세팅을 끝내지 못했어요',
  fix: '잠시 뒤 다시 시도하세요. 계속되면 관리자에게 알려 주세요.',
  retry: true,
};

const WORSENED_PAIRS = /worsened_pairs=\[([^\]]*)\]/;
/** 배경 미완료 메시지('사람 지운 배경 수집 미완료 카메라: [...] ({...}), 300s 대기')의 카메라 목록 부분. */
const MISSING_BACKGROUND = /미완료 카메라:\s*([^(]*)/;
const ID_CHAR = '[A-Za-z0-9_-]';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** text 안에서 id 가 앞뒤로 다른 id 글자 없이 나오는 첫 위치. 없으면 -1. */
function indexOfId(text: string, id: string): number {
  return new RegExp(`(?<!${ID_CHAR})${escapeRegExp(id)}(?!${ID_CHAR})`).exec(text)?.index ?? -1;
}

/**
 * 실패 메시지 안의 `cam_B-cam_C`·`cam1-cam2` 꼴에서 카메라 id 목록에 있는 쌍만 메시지에 나온 순서로 뽑는다.
 * id 에 '-' 가 있을 수 있어 글자를 쪼개지 않고 알려진 id 조합을 찾는다. `worsened_pairs=[...]` 가 있으면 그 안만 본다.
 */
export function pairsInMessage(message: string, cameraIds: readonly string[]): [string, string][] {
  const text = WORSENED_PAIRS.exec(message)?.[1] ?? message;
  const found: { index: number; pair: [string, string] }[] = [];
  for (const a of cameraIds) {
    for (const b of cameraIds) {
      if (a === b) continue;
      const index = indexOfId(text, `${a}-${b}`);
      if (index >= 0) found.push({ index, pair: [a, b] });
    }
  }
  return found.sort((x, y) => x.index - y.index).map((f) => f.pair);
}

/** 실패 메시지가 짚은 카메라(id 목록에 있는 것만, 카메라 번호 순서). 배경 미완료 메시지는 미완료 카메라 목록만 본다. */
export function camerasInMessage(message: string, cameraIds: readonly string[]): string[] {
  const text = MISSING_BACKGROUND.exec(message)?.[1] ?? message;
  return cameraIds.filter((id) => indexOfId(text, id) >= 0);
}

/** 실패 안내에 더 쓰는 세션 근거. */
export interface FailureEvidence {
  /** 같은 쌍이 바로 앞 시도에서도 거부됐다(같은 세션의 반복 조회는 세지 않음). */
  repeatedValidationPairs?: string;
  /** 세션의 마지막 카메라 확인 결과(CAMERA_CHECK_NOT_PASSED 의 원인). */
  cameraCheck?: CameraCheck | null;
  /** 카메라별 배경 수집 진행(%). 배경 미완료 카메라를 메시지에서 찾지 못하면 100 이 안 된 카메라를 쓴다. */
  backgroundCollection?: readonly { cameraId: string; pct: number }[];
}

/**
 * 카메라 확인 실패(CAMERA_CHECK_NOT_PASSED). 걷기 창이 보이던 원인 문장(walkFailure)을 그대로 첫 줄에 쓰고, 이제는 「확인만 다시」가
 * 아니라 다시 시도(처음부터)라 해결 줄만 바꾼다. 「걷기 시작」을 누르지 않아 끝난 경우는 따로 말한다.
 */
function cameraCheckGuide(
  check: CameraCheck | null | undefined,
  message: string | null,
  cameraIds: readonly string[],
): FailureGuide {
  const entry = SETUP_FAILURES.CAMERA_CHECK_NOT_PASSED!;
  const base = { retry: true, newMap: false };
  const problems =
    check && (check.status === 'FAILED' || check.status === 'INCOMPLETE') ? check.problems : [];
  if (
    problems.some((p) => p.reason === 'NOT_STARTED') ||
    (message ?? '').includes('「걷기 시작」을 받지 못해')
  )
    return {
      ...base,
      title: '「걷기 시작」을 누르지 않아 카메라 확인 시간이 지났어요',
      fix: `${WALK_AGAIN} 「걷기 시작」을 누르고 한 사람이 30초 걸어 주세요.`,
    };
  if (check && problems.length > 0) {
    const failure = walkFailure(check, cameraIds);
    return failure.kind === 'shortage'
      ? {
          ...base,
          title: failure.title,
          fix: `${WALK_AGAIN} 한 사람만 카메라 앞을 고루 지나가며 30초 걸어 주세요(다른 사람은 화면 밖).`,
        }
      : {
          ...base,
          title: failure.title,
          fix: '카메라와 거치대가 흔들리지 않게 고정한 뒤 다시 시도하세요(보정부터 다시 해요).',
        };
  }
  if ((message ?? '').includes('시간이 남지 않아'))
    return {
      ...base,
      title: '보정이 오래 걸려 카메라 확인에 쓸 시간이 남지 않았어요',
      fix: '다시 시도하세요. 계속되면 관리자에게 알려 주세요.',
    };
  return { ...base, title: entry.title({ pairs: '', changed: '', cameras: '' }), fix: entry.fix };
}

/** 서버 failure_code·failure_message 를 사용자 안내(원인·해결·다시 시도 가능 여부)로 바꾼다. */
export function failureGuide(
  code: string | null,
  message: string | null,
  cameraIds: readonly string[],
  changedCameras: readonly string[] = [],
  evidence: FailureEvidence = {},
): FailureGuide {
  if (code === 'CAMERA_CHECK_NOT_PASSED')
    return cameraCheckGuide(evidence.cameraCheck, message, cameraIds);
  const entry =
    (code !== null && Object.hasOwn(SETUP_FAILURES, code) ? SETUP_FAILURES[code] : undefined) ??
    FALLBACK;
  const label = (id: string) => cameraLabel(cameraIds, id);
  const pairs = pairsInMessage(message ?? '', cameraIds)
    .map(([a, b]) => pairLabel(cameraIds, a, b))
    .join(', ');
  const fromMessage = camerasInMessage(message ?? '', cameraIds);
  const cameras = (
    fromMessage.length > 0
      ? fromMessage
      : code === 'BACKGROUND_INCOMPLETE'
        ? (evidence.backgroundCollection ?? []).filter((c) => c.pct < 100).map((c) => c.cameraId)
        : []
  )
    .map(label)
    .join(', ');
  return {
    title: entry.title({ pairs, changed: changedCameras.map(label).join('·'), cameras }),
    fix:
      code === 'VALIDATION_REJECTED' && evidence.repeatedValidationPairs
        ? `${evidence.repeatedValidationPairs} 쌍이 두 번 연속 검증을 통과하지 못했어요. 카메라와 거치대가 흔들리지 않게 고정하고 위치를 점검한 뒤 다시 시도하세요.`
        : entry.fix,
    retry: entry.retry,
    newMap: entry.newMap === true,
  };
}
