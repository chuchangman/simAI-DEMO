import { cameraLabel } from '@/features/setup/cameraLabels';
import type { HeightFieldNote } from '@/features/setup/setup';
import type { HeightReview, SetupSessionResponse } from '@/features/setup/types';

// 카메라 높이 빠른 확인(S15P31A101-690). 워커가 초기 복원·바닥 정의를 마친 뒤 카메라별 입력 높이가 모델 기하와 상대적으로 맞는지 보고,
// 기준(3%)을 넘는 카메라가 있으면 사람 확인을 기다린다(서버 paused_reason HEIGHT_CHECK). 화면은 1단계와 같은 높이 입력 창을 띄워
// 고치거나 「실측이 맞음」으로 진행한다. 확인한 높이는 뒤 단계에서 같은 높이 비교로 다시 막지 않는다.
// 이 파일은 세션 응답을 창의 글로 바꾸는 순수 함수만 둔다.

/** 서버가 내는 멈춤 까닭: 카메라 높이 확인을 기다린다. */
export const HEIGHT_CHECK_PAUSE = 'HEIGHT_CHECK';

/** 높이 확인 창을 띄울 세션인지(워커가 확인을 기다리고 결정이 아직 없다). */
export function heightCheckPending(session: SetupSessionResponse | null | undefined): boolean {
  return (
    !!session &&
    session.status !== 'FAILED' &&
    session.status !== 'COMPLETED' &&
    session.paused_reason === HEIGHT_CHECK_PAUSE &&
    session.height_review?.status === 'AWAITING_CONFIRMATION'
  );
}

/** 높이를 앞에서 이미 확인했는지(맞았거나 사람이 확인·수정). 그러면 결과 화면이 높이로 다시 고치라고 하지 않는다. */
export function heightSettled(session: SetupSessionResponse | null | undefined): boolean {
  const status = session?.height_review?.status;
  return status === 'PASSED' || status === 'CONFIRMED' || status === 'CORRECTED';
}

/** 카메라별 「맞음」 · 「다른 카메라보다 약 n cm 낮게(높게) 보임」. */
export function heightCheckNotes(review: HeightReview): Record<string, HeightFieldNote> {
  const out: Record<string, HeightFieldNote> = {};
  for (const [cameraId, cam] of Object.entries(review.cameras)) {
    if (cam.verdict === 'OK') {
      out[cameraId] = { text: '맞음', warn: false };
    } else {
      const cm = Math.max(1, Math.round(Math.abs(cam.difference_cm)));
      out[cameraId] = {
        text: `다른 카메라보다 약 ${cm} cm ${cam.verdict === 'LOW' ? '낮게' : '높게'} 보임`,
        warn: true,
      };
    }
  }
  return out;
}

/** 창 위 한 줄: 맞지 않는 카메라와 할 일. */
export function heightCheckSummary(review: HeightReview, cameraIds: readonly string[]): string {
  const off = cameraIds.filter((id) => review.cameras[id] && review.cameras[id].verdict !== 'OK');
  const names = off.map((id) => cameraLabel(cameraIds, id)).join(', ');
  return `${names || '일부 카메라'} 높이가 다른 카메라와 맞지 않습니다. 줄자로 다시 재 보고 고치거나, 실측이 맞으면 그대로 진행해 주세요.`;
}

/** 답이 없을 때 워커가 입력한 높이로 진행하기까지의 안내(분 단위, 대략). 모르면 null. */
export function heightCheckWaitNote(review: HeightReview): string | null {
  if (review.wait_s === undefined || review.wait_s <= 0) return null;
  const minutes = Math.max(1, Math.round(review.wait_s / 60));
  return `약 ${minutes}분 안에 답하지 않으면 입력한 높이로 진행합니다.`;
}

/** 입력 칸 값이 워커가 쓰는 높이와 다른지(서버가 CORRECTED 로 보는 기준 0.1 mm 와 같다). */
export function heightsChanged(
  current: Readonly<Record<string, number>>,
  next: Readonly<Record<string, number>>,
): boolean {
  return Object.entries(next).some(
    ([cameraId, value]) => Math.abs(value - (current[cameraId] ?? value)) > 1e-4,
  );
}
