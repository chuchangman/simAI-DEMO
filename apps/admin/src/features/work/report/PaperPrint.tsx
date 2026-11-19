import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

// 출력용 사본 자리: 화면에는 안 보이고, 인쇄할 때는 이 사본만 찍힌다(body 의 다른 자식 — 하단 메뉴·단추 줄·창 — 은 숨긴다).
// features/tbm/TbmDocument 의 TbmPrint 와 같은 방식이다.

export function PaperPrint({ children }: { children: ReactNode }) {
  return createPortal(
    <div className="hidden print:block print:[body:has(>&)]:bg-white print:[body:has(>&)>*:not(&)]:hidden!">
      <style>{'@page { size: A4; margin: 0 }'}</style>
      {children}
    </div>,
    document.body,
  );
}
