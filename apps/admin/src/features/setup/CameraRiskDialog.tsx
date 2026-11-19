import { CALIBRATION_RISK_TITLE } from '@/features/setup/cameraGuides';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { ACTION, SECONDARY } from '@/features/tbm/styles';
import { Button } from '@simai/ui/components/button';

// 옆 카메라 쌍의 겹침이 부족한 채로 '다음'을 눌렀을 때의 확인창. 그대로 진행하면 세팅 세션을 만든다.

export function CameraRiskDialog({
  riskyPairs,
  onConfirm,
  onCancel,
}: {
  /** 겹침이 부족한 옆 카메라 쌍 이름. 예: ['캠2–캠3'] */
  riskyPairs: readonly string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalDialog
      label={CALIBRATION_RISK_TITLE}
      onClose={onCancel}
      closeOnBackdrop
      className="w-[min(420px,calc(100vw-48px))]"
    >
      <div className="flex flex-col gap-4 px-5 py-[18px]">
        <h2 className="text-[15px] leading-[22px] font-bold text-foreground">
          {CALIBRATION_RISK_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">
          {riskyPairs.join(', ')} 겹침이 부족한 채로 보정을 시작합니다.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} className={SECONDARY}>
            돌아가기
          </Button>
          <Button onClick={onConfirm} className={ACTION}>
            그대로 진행
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
