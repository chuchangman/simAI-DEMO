import {
  heightCheckNotes,
  heightCheckSummary,
  heightCheckWaitNote,
} from '@/features/setup/heightCheck';
import type { HeightFieldView } from '@/features/setup/setup';
import { CameraHeightPanel } from '@/features/setup/SetupPanels';
import type { HeightReview } from '@/features/setup/types';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { ACTION, H2, NOTE } from '@/features/tbm/styles';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { useMemo } from 'react';

// 카메라 높이 확인 창(S15P31A101-690). 3D 공간을 만든 직후 워커가 카메라 높이가 서로 맞지 않는다고 보면 크게 띄운다.
// 1단계와 같은 높이 입력 칸에 카메라별 「맞음」·「다른 카메라보다 약 n cm 낮게(높게) 보임」을 보이고, 고친 값으로 진행하거나
// 실측이 맞으면 그대로 진행한다(서버 POST /resume). 고친 값은 MapAnything 을 다시 돌리지 않고 다시 계산된다.
// Esc·바깥 클릭으로 닫히지 않는다(답하지 않으면 워커가 대기 상한 뒤 입력한 높이로 진행한다).

export function HeightCheckModal({
  review,
  cameraIds,
  fields,
  changed,
  canSubmit,
  pending,
  error,
  onChange,
  onSubmit,
}: {
  review: HeightReview;
  cameraIds: readonly string[];
  /** 높이 입력 칸(워커가 쓰는 높이 + 이 창에서 고친 값). */
  fields: readonly HeightFieldView[];
  /** 입력 칸 값이 워커가 쓰는 높이와 다르다(고친 값으로 진행). */
  changed: boolean;
  canSubmit: boolean;
  pending: boolean;
  error: string | null;
  onChange: (cameraId: string, value: string) => void;
  onSubmit: () => void;
}) {
  const notes = useMemo(() => heightCheckNotes(review), [review]);
  const waitNote = heightCheckWaitNote(review);
  return (
    <ModalDialog
      label="카메라 높이 확인"
      onClose={() => {}}
      className="w-[min(640px,calc(100vw-48px))]"
    >
      <div className="flex max-h-[calc(100dvh-48px)] flex-col">
        <div className="flex flex-none flex-col gap-1 px-5 pt-[18px] pb-3">
          <h2 className={H2}>카메라 높이 확인</h2>
          <p role="status" className="text-sm text-foreground">
            {heightCheckSummary(review, cameraIds)}
          </p>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pb-4">
          <CameraHeightPanel
            fields={fields}
            onChange={onChange}
            submitError={error}
            fieldNotes={notes}
          />
        </div>
        <div className="flex flex-none items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className={cn(NOTE, !waitNote && 'invisible')}>{waitNote}</p>
          <Button onClick={onSubmit} disabled={!canSubmit || pending} className={ACTION}>
            {changed ? '고친 값으로 진행' : '실측이 맞음 · 이대로 진행'}
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
