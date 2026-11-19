import { cn } from '@simai/ui/lib/utils';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// 모달 창(네이티브 <dialog> + showModal). Esc 로 닫고, 닫으면 눌렀던 곳으로 포커스가 돌아간다.
// closeOnBackdrop 이면 창 바깥을 눌러도 닫는다(입력 내용이 없는 창에만 쓴다).

export function ModalDialog({
  label,
  onClose,
  closeOnBackdrop = false,
  className,
  children,
}: {
  label: string;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement;
    if (el && !el.open) {
      // showModal 이 없는 환경(시험)에서는 열린 상태로만 둔다.
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    }
    return () => {
      if (el?.open) {
        if (typeof el.close === 'function') el.close();
        else el.removeAttribute('open');
      }
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      className={cn(
        'm-auto max-h-none max-w-none rounded-xl bg-card p-0 text-card-foreground shadow-float ring-1 ring-border outline-none backdrop:bg-black/55',
        className,
      )}
    >
      {children}
    </dialog>,
    document.body,
  );
}
