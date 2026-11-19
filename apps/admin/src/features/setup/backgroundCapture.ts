import { cameraLabel } from '@/features/setup/cameraLabels';
import type { SetupTone } from '@/features/setup/setup';
import type { BackgroundCapture, SetupSessionResponse } from '@/features/setup/types';

// 세팅 배경 촬영 창(S15P31A101-686). 보정을 시작할 때 카메라 앞을 비우고 「시작」을 누르면 약 20초 동안 사람 없는 배경을 찍는다.
// 세팅 시작 뒤 새로 찍은 표본만 쓰므로(옛 화면으로 대신하지 않는다) 사람이 보이거나 영상이 없는 카메라는 그 카메라만 이어서 찍는다.
// 이 파일은 세션 응답(background_capture)을 창에 보일 문장·상태로 바꾸는 순수 함수만 둔다.

/** 화면 카운트다운(초). 서버 최소 표본 12장 × 1초에 사람 가림·검출 여유를 더한 값이다. */
export const CAPTURE_SECONDS = 20;

/** 배경을 끝내 찍지 못해 세팅이 끝났을 때 워커가 내는 실패 코드. */
export const CAPTURE_FAILURE_CODE = 'BACKGROUND_INCOMPLETE';

export type CaptureCameraState = BackgroundCapture['cameras'][string]['state'] | 'WAITING';

export interface CaptureCameraView {
  id: string;
  label: string;
  state: CaptureCameraState;
  tone: SetupTone;
  /** 짧은 상태(칸 위 글자). */
  title: string;
  /** 사용자가 할 일(사람이 보이거나 영상이 없을 때). 없으면 null. */
  hint: string | null;
  /** 0~1 수집 진행. */
  progress: number;
}

/** 창의 단계: 시작 전 · 시작 요청 중 · 촬영 중 · 못 찍어 끝남. */
export type CapturePhase = 'ready' | 'starting' | 'capturing' | 'failed';

export interface CaptureView {
  phase: CapturePhase;
  cameras: CaptureCameraView[];
  /** 다시 찍어야 하는 카메라 이름(사람 가림·영상 없음). */
  blockedLabels: string[];
  /** 아직 다 찍지 못한 카메라 이름(완료가 아닌 카메라, 사람 가림·영상 없음 포함). */
  pendingLabels: string[];
}

/** 배경 촬영 중인 세션인지(진행 중이고 단계가 배경 수집). */
export function captureCollecting(session: SetupSessionResponse | null | undefined): boolean {
  if (!session) return false;
  const stage = session.stage ?? session.status;
  return stage === 'COLLECTING_BACKGROUND' && session.status !== 'FAILED';
}

/** 배경을 끝내 찍지 못해 끝난 세션인지. */
export function captureFailed(session: SetupSessionResponse | null | undefined): boolean {
  return session?.status === 'FAILED' && session.failure_code === CAPTURE_FAILURE_CODE;
}

function cameraView(
  cameraIds: readonly string[],
  id: string,
  capture: BackgroundCapture | null,
): CaptureCameraView {
  const label = cameraLabel(cameraIds, id);
  const cam = capture?.cameras[id];
  if (!capture || !cam) {
    return { id, label, state: 'WAITING', tone: 'idle', title: '준비 중', hint: null, progress: 0 };
  }
  const required = Math.max(1, capture.required_samples);
  const progress = Math.min(1, cam.sample_count / required);
  switch (cam.state) {
    case 'READY':
      return { id, label, state: cam.state, tone: 'ok', title: '완료', hint: null, progress: 1 };
    case 'PERSON_OCCLUDED':
      return {
        id,
        label,
        state: cam.state,
        tone: 'delay',
        title: `${label} 앞에 사람이 보입니다`,
        hint: '화면 밖으로 이동하면 촬영을 이어갑니다',
        progress,
      };
    case 'NO_VIDEO':
      return {
        id,
        label,
        state: cam.state,
        tone: 'delay',
        title: '영상이 들어오지 않습니다',
        hint: '카메라 전원과 연결을 확인해 주세요',
        progress: 0,
      };
    default:
      return {
        id,
        label,
        state: cam.state,
        tone: 'active',
        title: `촬영 중 ${Math.min(cam.sample_count, required)}/${required}`,
        hint: null,
        progress,
      };
  }
}

/**
 * 창에 보일 단계와 카메라별 상태. 카메라 순서는 화면의 카메라 번호 순서(cameraIds)를 따르고, 응답에만 있는 카메라는 뒤에 붙인다.
 * starting 은 「시작」을 눌러 세션을 만드는 중이다.
 */
export function deriveCaptureView(
  session: SetupSessionResponse | null | undefined,
  cameraIds: readonly string[],
  starting: boolean,
): CaptureView {
  const capture = session?.background_capture ?? null;
  const ids = [
    ...cameraIds,
    ...Object.keys(capture?.cameras ?? {}).filter((id) => !cameraIds.includes(id)),
  ];
  const cameras = ids.map((id) => cameraView(cameraIds, id, capture));
  const phase: CapturePhase = captureFailed(session)
    ? 'failed'
    : captureCollecting(session)
      ? 'capturing'
      : starting
        ? 'starting'
        : 'ready';
  const blockedLabels = cameras
    .filter((c) => c.state === 'PERSON_OCCLUDED' || c.state === 'NO_VIDEO')
    .map((c) => c.label);
  const pendingLabels = capture
    ? cameras.filter((c) => c.state !== 'READY').map((c) => c.label)
    : [];
  return { phase, cameras, blockedLabels, pendingLabels };
}

/**
 * 창 맨 위 상태 한 줄. 카운트다운이 0 이 된 뒤에도 끝나지 않으면 늦는 카메라 이름을 보인다(S15P31A101-719: 0초인데 「거의 다 찍었습니다」로
 * 1분 넘게 머물던 것). 못 찍고 끝나면 사람 가림·영상 없음 카메라를, 없으면 다 찍지 못한 카메라를 보인다.
 */
export function captureStatusText(
  view: CaptureView,
  secondsLeft: number,
  waitingForWorker: boolean,
  waitingSeconds = 0,
): string {
  const { phase } = view;
  const blocked = view.blockedLabels;
  if (phase === 'ready')
    return `카메라 ${view.cameras.length}대가 사람 없는 배경을 약 ${CAPTURE_SECONDS}초 동안 찍습니다. 모두 카메라 화면 밖으로 이동한 뒤 「시작」을 눌러 주세요.`;
  if (phase === 'starting') return '촬영을 준비하는 중입니다.';
  if (phase === 'failed') {
    const named = blocked.length ? blocked : view.pendingLabels;
    return `배경을 다 찍지 못했습니다${named.length ? `: ${named.join(', ')}` : ''}. 화면을 비운 뒤 다시 찍어 주세요.`;
  }
  if (waitingForWorker)
    return `서버 준비 기다리는 중 · 아직 비키지 않아도 됩니다 · ${Math.max(0, Math.floor(waitingSeconds))}초 경과`;
  if (blocked.length)
    return `${blocked.join(', ')}만 이어서 찍습니다. 다른 카메라는 그대로 찍고 있습니다.`;
  if (secondsLeft > 0) return '촬영 중입니다. 화면 밖에서 기다려 주세요.';
  if (view.pendingLabels.length)
    return `아직 찍는 중: ${view.pendingLabels.join(', ')}. 그 카메라 앞을 비우고 조금만 더 기다려 주세요.`;
  return '거의 다 찍었습니다. 조금만 더 기다려 주세요.';
}

/** 카운트다운 남은 초(0 아래로 내려가지 않는다). */
export function remainingSeconds(startedAtMs: number | null, nowMs: number): number {
  if (startedAtMs === null) return CAPTURE_SECONDS;
  return Math.max(0, CAPTURE_SECONDS - Math.floor((nowMs - startedAtMs) / 1000));
}
