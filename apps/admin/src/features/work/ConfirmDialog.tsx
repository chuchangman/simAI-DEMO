import { ModalDialog } from '@/features/tbm/ModalDialog';
import { ACTION, SECONDARY } from '@/features/tbm/styles';
import { Button } from '@simai/ui/components/button';
import type { ReactNode } from 'react';

// 작업 관리 흐름의 확인창(작업 종료·보고서 보내기·작업 전 확인 등). 제목·설명·확인/취소 단추가 기본이고, 확인 전에
// 체크가 필요한 창은 children 에 체크 줄을 넣고 confirmDisabled 로 확인을 막는다.

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = '취소',
  confirmDisabled = false,
  pending = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** 확인 조건이 아직 안 맞으면 true. */
  confirmDisabled?: boolean;
  /** 확인 요청이 가는 중이면 true(확인 단추를 막는다). */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <ModalDialog label={title} onClose={onCancel} className="w-[min(420px,calc(100vw-48px))]">
      <div className="flex flex-col gap-4 px-5 py-[18px]">
        <h2 className="text-[15px] leading-[22px] font-bold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} className={SECONDARY}>
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={confirmDisabled || pending} className={ACTION}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
