import type { CameraBadgeKind } from '@/features/setup/cameraBadge';
import { cameraShortLabel } from '@/features/setup/cameraLabels';
import type { SetupWaitingView, Step1CoverageView } from '@/features/setup/setup';

// 세팅 화면 오른쪽 「지금 할 일」 카드 한 장(S15P31A101-691). 사용자 원칙: 화면에는 지금 할 일 하나와 주 단추 하나만 보이고,
// 주 단추가 꺼져 있으면 그 이유를 이 카드 본문에 쓴다(마우스를 올려야 보이는 title 에만 두지 않는다). 문구는 "무엇이 / 어떻게" 두 줄이다.
// 진단 수치(단계별 %, 경과 시간, px, 쌍 이름 표, 복원 높이 표)는 이 카드에 두지 않고 「자세히」로 접는다.

export interface NextStep {
  /** 무엇이(지금 상태 한 줄). */
  title: string;
  /** 어떻게(사용자가 할 일 한 줄). */
  detail: string;
  /** delay: 고치면 좋은 문제가 있다 · ok: 준비됨 · idle: 기다리는 중. */
  tone: 'delay' | 'ok' | 'idle';
}

const join = (cameraIds: readonly string[], ids: readonly string[]) =>
  ids.map((id) => cameraShortLabel(cameraIds, id)).join(', ');

/** 1단계 「지금 할 일」의 입력. */
export interface Step1NextInput {
  coverage: Step1CoverageView;
  /** 높이 입력 칸 검사 결과(비었거나 틀린 칸). */
  heights: { missingIds: readonly string[]; invalidIds: readonly string[] };
  /** 높이 칸 카메라 순서(이름을 만드는 순서). */
  heightCameraIds: readonly string[];
  /** 이전 맵 재사용을 고를 수 있는지 아직 확인 중이라 '다음' 이 꺼져 있다. */
  modePending: boolean;
  /** 세팅 시작·다시 시도 요청이 가는 중이다. */
  submitting: boolean;
}

/**
 * 1단계(카메라 연결 관리) 「지금 할 일」. '다음' 을 막는 것(요청 중·높이 칸·재사용 확인 중)이 먼저고, 그다음은 카메라 배지와 같은
 * 우선순위(연결 끊김 → 직전 보정과 달라짐 → 게이트웨이 헬퍼 끊김 → 겹침 부족 → 각도 확인 필요)로 가장 급한 하나를 고른다. 카메라 문제는
 * 진행을 막지 않는다.
 */
export function step1NextStep(input: Step1NextInput): NextStep {
  const { coverage, heights, heightCameraIds } = input;
  const ids = coverage.cameras.map((c) => c.id);
  if (input.submitting)
    return { title: '세팅을 시작하는 중이에요', detail: '잠시 기다려 주세요', tone: 'idle' };
  if (heights.missingIds.length > 0)
    return {
      title: `${join(heightCameraIds, heights.missingIds)} 높이가 비어 있어요`,
      detail: '바닥에서 렌즈 중심까지 높이(m)를 입력하면 「다음」이 켜집니다',
      tone: 'delay',
    };
  if (heights.invalidIds.length > 0)
    return {
      title: `${join(heightCameraIds, heights.invalidIds)} 높이를 다시 확인해 주세요`,
      detail: '0보다 크고 20 m 이하로 입력하면 「다음」이 켜집니다',
      tone: 'delay',
    };
  if (input.modePending)
    return {
      title: '이전 맵을 쓸 수 있는지 확인하고 있어요',
      detail: '확인이 끝나면 「다음」이 켜집니다',
      tone: 'idle',
    };
  const byBadge = (kind: CameraBadgeKind) => coverage.cameras.filter((c) => c.badge.kind === kind);
  const disconnected = byBadge('DISCONNECTED');
  if (disconnected.length > 0)
    return {
      title: `${join(
        ids,
        disconnected.map((c) => c.id),
      )} 영상이 들어오지 않아요`,
      detail: '카메라 전원과 공유기 연결을 확인해 주세요',
      tone: 'delay',
    };
  const changed = byBadge('CHANGED');
  if (changed.length > 0)
    return {
      title: `${join(
        ids,
        changed.map((c) => c.id),
      )} 위치나 방향이 직전 세팅과 달라졌어요`,
      detail: '새 맵 만들기로 시작해 주세요',
      tone: 'delay',
    };
  if (coverage.helperLost)
    return {
      title: '현장 게이트웨이와 연결이 끊겨 카메라를 확인할 수 없어요',
      detail:
        '게이트웨이 노트북과 카메라 헬퍼가 켜져 있는지 확인하세요. 확인 없이도 「다음」으로 시작할 수 있어요',
      tone: 'delay',
    };
  if (coverage.fresh && coverage.riskyPairs.length > 0)
    return {
      title: `${coverage.riskyPairs.join(', ')} 겹침이 부족해요`,
      detail: '카메라를 돌리거나 겹치는 곳에 무늬 있는 물건을 두세요',
      tone: 'delay',
    };
  // 세팅 보정(Stage A) 기준 미달·불안정 옆 쌍(S15P31A101-761). 경고만 하고 「다음」은 막지 않는다
  if (coverage.stageAAlerts.length > 0) {
    const first = coverage.stageAAlerts[0]!;
    const unstableOnly = coverage.stageAAlerts.every((a) => a.status === 'UNSTABLE');
    return {
      title: `${coverage.stageAAlerts.map((a) => a.label).join(', ')} ${
        unstableOnly ? '판정이 흔들려요' : '보정 기준에 못 미쳐요'
      }`,
      detail: `${first.guides[0]}. 그대로 「다음」으로 시작할 수도 있어요`,
      tone: 'delay',
    };
  }
  const angled = byBadge('ANGLE')[0];
  if (angled)
    return {
      title: `${angled.label} 각도를 맞춰 주세요`,
      detail: angled.guides[0]?.text ?? '영상 위 화살표 쪽으로 돌려 주세요',
      tone: 'delay',
    };
  if (byBadge('CHECKING').length > 0)
    return {
      title: '카메라 상태를 확인하고 있어요',
      detail: '확인이 끝나지 않아도 「다음」으로 시작할 수 있어요',
      tone: 'idle',
    };
  return {
    title: `카메라 ${coverage.cameras.length}대가 준비됐어요`,
    detail: '「다음」을 누르면 카메라 앞을 비우고 배경을 찍어요',
    tone: 'ok',
  };
}

/** 2단계 「지금 할 일」의 입력. */
export interface CalibrateNextInput {
  waiting: SetupWaitingView;
  /** 진행 상태를 서버에서 받지 못했다. */
  pollingError: boolean;
  /** 카메라 확인 걷기 창이 떠 있다(-687). */
  walkOpen: boolean;
  /** 카메라 확인을 통과하지 않아 '다음' 을 막는 이유(통과면 null). */
  cameraCheckBlocked: string | null;
}

/**
 * 2단계(보정·생성) 「지금 할 일」. 실패면 null(실패 안내가 대신한다). 대기 이유·창(높이 확인·걷기)·지금 단계 순으로 하나를 고르고,
 * '다음' 이 꺼진 동안은 언제 켜지는지를 쓴다.
 */
export function calibrateNextStep(input: CalibrateNextInput): NextStep | null {
  const { waiting } = input;
  if (waiting.failed) return null;
  if (input.pollingError)
    return {
      title: '진행 상태를 받지 못하고 있어요',
      detail: '네트워크 연결을 확인해 주세요. 세팅은 서버에서 계속됩니다',
      tone: 'delay',
    };
  if (waiting.waitReason)
    return {
      title: waiting.waitReason.title,
      detail: waiting.waitReason.hint,
      tone: waiting.waitReason.tone,
    };
  if (waiting.heightCheckPending)
    return {
      title: '카메라 높이를 확인해 주세요',
      detail: '열린 창에서 높이를 확인하면 이어서 만들어요',
      tone: 'delay',
    };
  if (input.walkOpen)
    return {
      title: '카메라 확인 걷기를 해 주세요',
      detail: '열린 창에서 「걷기 시작」을 누르고 30초 걸어 주세요',
      tone: 'delay',
    };
  if (waiting.mapComplete) {
    if (input.cameraCheckBlocked)
      return {
        title: '맵은 완성됐지만 카메라 확인이 남아 있어요',
        detail:
          '맵 생성 작업이 끝나 걷기만 다시 할 수 없어요. 「카메라 연결 관리로」 돌아가 세팅을 다시 시작해 주세요.',
        tone: 'delay',
      };
    return {
      title: '3D 맵이 준비됐어요',
      detail: '「다음」을 눌러 위험 구역을 확인하세요',
      tone: 'ok',
    };
  }
  const stage = waiting.stage;
  if (stage === 'COLLECTING_BACKGROUND')
    return {
      title: '사람 없는 배경을 찍고 있어요',
      detail: '카메라 앞에서 비켜 주세요',
      tone: 'idle',
    };
  if (stage === 'INITIAL_POSE_AND_WORLD' || stage === 'JOINT_BA_AND_VERIFY')
    return {
      title: '카메라를 보정하고 있어요',
      detail: '끝나면 카메라 확인 걷기 창이 열려요',
      tone: 'idle',
    };
  return {
    title: '3D 맵을 만들고 있어요',
    detail:
      waiting.remainingSec > 0
        ? `다 만들면 「다음」이 켜집니다 · ${waiting.remainingLabel} 남음`
        : '다 만들면 「다음」이 켜집니다',
    tone: 'idle',
  };
}
