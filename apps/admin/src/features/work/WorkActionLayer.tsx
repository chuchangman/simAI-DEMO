import { useWorkActionState, type WorkActionSecondary } from '@/features/work/WorkActionContext';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { Loader2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// 날짜 화면 우측 아래 단추 줄(주 단추 '다음'·'작업 종료'·'보고서 제출' + 보조 단추). 하단 메뉴(Dock)가 뜨는 층에 얹어 Dock 과 같은 줄에 놓는다.
// Dock 은 AppLayout 의 본문(<main>) 옆 상자에 absolute(bottom-3.5, 높이 70)로 떠 있고 본문 좌우 여백은 20px 이라, 같은 상자에
// right-5·bottom-3.5·높이 70 으로 얹고 단추(높이 44)를 세로 가운데에 둔다. <main> 은 스크롤되므로 그 안에 absolute 로 두지 않는다.

const BUTTON_SIZE = 'h-11 px-[22px] text-[15px]';

/** Dock 이 뜨는 층: 본문 <main> 의 부모. 못 찾으면(시험처럼 레이아웃 밖) 있는 자리에 그린다. */
const layerHostOf = (anchor: HTMLElement | null): HTMLElement | null =>
  anchor?.closest('main')?.parentElement ?? null;

function SecondaryButton({ label, onClick, kind = 'default', disabled }: WorkActionSecondary) {
  return (
    <Button
      variant={kind === 'danger' ? 'destructive' : 'secondary'}
      onClick={onClick}
      disabled={disabled}
      className={BUTTON_SIZE}
    >
      {label}
    </Button>
  );
}

export function WorkActionLayer() {
  const config = useWorkActionState();
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setHost(layerHostOf(anchor.current)), []);

  const layer = config && (
    <div
      role="group"
      aria-label="작업 단추"
      className={cn(
        'pointer-events-none absolute right-5 bottom-3.5 z-[6] flex h-[70px] items-center justify-end gap-2',
        '*:pointer-events-auto',
      )}
    >
      {config.reason && (
        // 꺼진 단추의 이유를 단추 왼쪽에 늘 보인다(문서 속 흐린 글이나 hover 에 기대지 않는다, -734). 너무 길면 줄여 보인다.
        <span
          role="status"
          title={config.reason}
          className="max-w-[320px] truncate text-sm text-muted-foreground"
        >
          {config.reason}
        </span>
      )}
      {config.secondary?.map((secondary) => (
        <SecondaryButton key={secondary.label} {...secondary} />
      ))}
      {/* 꺼진 단추는 마우스를 받지 않아 title 이 안 뜬다. 이유 글은 감싼 칸에 단다. */}
      <span title={config.title}>
        <Button
          onClick={config.onClick}
          disabled={!config.enabled || config.pending}
          aria-busy={config.pending || undefined}
          className={BUTTON_SIZE}
        >
          {config.pending && <Loader2 aria-hidden className="animate-spin" />}
          {config.label}
        </Button>
      </span>
    </div>
  );

  return (
    <>
      <span ref={anchor} hidden />
      {host ? createPortal(layer, host) : layer}
    </>
  );
}
