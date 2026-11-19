import { SupplementCaptureBody } from '@/features/setup/SupplementCaptureBody';
import { rebakeApplied } from '@/features/setup/supplement';
import type { SetupSessionResponse } from '@/features/setup/types';
import { useSupplementCapture } from '@/features/setup/useSupplementCapture';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { ACTION, H2, SECONDARY } from '@/features/tbm/styles';
import { Button } from '@simai/ui/components/button';
import { useEffect, useRef } from 'react';

// 보정·생성 단계 「자세히 · 맵 보강」에서 여는 「맵 보강 촬영(선택)」 창(S15P31A101-607, S15P31A101-691 부터 '다음' 에 끼어들지 않는다).
// 닫으면(Esc·바깥 클릭 포함) 그 단계에 그대로 머문다. 아래 오른쪽 단추는 맵에 아직 안 들어간 파일이 있으면 다시 굽기, 올린 파일이 없으면
// 건너뛰기, 이미 다 굽고 새로 올린 게 없으면 다음이다(건너뛰기·다음은 onNext: 세팅 화면은 창만 닫는다). 다시 구웠는데 붙은 게 없으면(원래 맵
// 유지) 다시 굽기 옆에 건너뛰기도 둔다. 눌러 시작한 다시 굽기가 새 맵으로 반영되면 창이 닫히고 보정·생성 단계의 3D 가 새 맵으로 바뀐다.

export function SupplementModal({
  session,
  onNext,
  onCancel,
  onRebaked,
}: {
  session: SetupSessionResponse;
  onNext: () => void;
  onCancel: () => void;
  /** 다시 굽기가 새 맵으로 반영돼 창을 닫는다. */
  onRebaked: () => void;
}) {
  const capture = useSupplementCapture(session, 'FILE_UPLOAD');
  // 이 창이 올리는 중인 파일(취소할 수 있는 줄)이 있으면 창을 닫을 때 올리기가 멈추므로, 끝나기 전에는 넘어가지 않는다.
  const uploading = capture.rows.some((row) => row.actions.includes('cancel'));
  const hasFiles = uploading || (capture.supplement?.media.length ?? 0) > 0;
  const rebaking = capture.rebakeView?.running ?? false;
  const { rebake } = capture;
  // 다시 구웠지만 붙은 게 없어 원래 맵을 유지했다. 다시 굽기만 남기면 넘어갈 길이 없어 건너뛰기를 같이 둔다.
  const keptOriginal = rebake !== null && !rebaking && !rebakeApplied(rebake);

  // 이 창이 굽는 것을 본 뒤 끝나 새 맵으로 반영되면 닫는다. 전에 끝난 굽기가 남아 있을 때 열어도 저절로 닫히지 않게 굽는 모습을 봐야 한다.
  const sawRebaking = useRef(false);
  useEffect(() => {
    if (rebaking) {
      sawRebaking.current = true;
      return;
    }
    if (!sawRebaking.current || !rebake) return;
    sawRebaking.current = false;
    if (rebakeApplied(rebake)) onRebaked();
  }, [rebaking, rebake, onRebaked]);

  const label = rebaking
    ? '다시 굽는 중'
    : capture.canRebakeNow
      ? '다시 굽기'
      : hasFiles
        ? '다음'
        : '건너뛰기';

  return (
    <ModalDialog
      label="맵 보강 촬영"
      onClose={onCancel}
      closeOnBackdrop
      className="w-[min(560px,calc(100vw-48px))]"
    >
      <div className="flex max-h-[calc(100dvh-48px)] flex-col">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pt-[18px] pb-4">
          <h2 className={H2}>맵 보강 촬영(선택)</h2>
          <SupplementCaptureBody sessionId={session.setup_session_id} capture={capture} />
        </div>
        <div className="flex flex-none items-center justify-between gap-2 border-t border-border px-5 py-3">
          <Button variant="secondary" onClick={onCancel} className={SECONDARY}>
            닫기
          </Button>
          <div className="flex items-center gap-2">
            {keptOriginal && capture.canRebakeNow && (
              <Button
                variant="secondary"
                onClick={onNext}
                disabled={uploading || capture.rebakePending}
                className={SECONDARY}
              >
                건너뛰기
              </Button>
            )}
            <Button
              onClick={capture.canRebakeNow ? capture.startRebake : onNext}
              disabled={uploading || rebaking || capture.rebakePending}
              className={ACTION}
            >
              {label}
            </Button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
