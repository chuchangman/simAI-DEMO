import { useMonitorStandby } from '@/features/monitor/useTodayWorks';
import { LivePlan } from '@/features/plan/LivePlan';
import { Button } from '@simai/ui/components/button';
import { useEffect, useState } from 'react';

// 3D 관제 왼쪽 칼럼 맨 아래 2D 미니맵(관제 데모와 같다). 칼럼 폭의 정사각형으로 고정돼 있고, 누르면 큰 2D 창이 뜨고 그 창에서는
// 사람·구역을 고를 수 있다. 2D 는 3D 와 따로 그리므로(명세 13.6) 3D 가 멈춰도 같은 평면을 볼 수 있다.

export function PlanMinimap({
  selectedKey,
  onSelect,
}: {
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // 대기 화면이 덮는 동안은 Tab 으로도 눌리지 않게 한다(이미 열어 둔 큰 창은 그대로 둔다).
  const standby = useMonitorStandby();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <div
        data-testid="plan-minimap"
        inert={standby}
        // 크기는 칼럼과 같은 CSS 변수에서 온다(index.css). 칼럼의 아래 끝이 이 크기에 맞춰 정해진다.
        className="absolute bottom-3.5 left-3.5 z-[3] size-(--minimap-size) rounded-[14px] bg-card/82 shadow-float ring-1 ring-border backdrop-blur-[8px] ring-inset hover:ring-point-soft"
      >
        <button
          type="button"
          aria-label="2D 평면 크게 보기"
          onClick={() => setOpen(true)}
          className="block size-full cursor-zoom-in rounded-[14px] p-2.5"
        >
          {/* 미니맵 안에서는 고르지 않는다(버튼 안에 버튼을 두지 않는다). 고르기는 큰 창에서 한다. */}
          <div aria-hidden className="size-full">
            <LivePlan selectedKey={selectedKey} className="size-full" />
          </div>
        </button>
      </div>
      {open && (
        <div
          data-testid="plan-modal"
          onClick={() => setOpen(false)}
          className="absolute inset-0 z-[8] flex items-center justify-center bg-foreground/28 p-5 dark:bg-background/62"
        >
          <section
            role="dialog"
            aria-label="2D 평면"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-full w-[min(860px,100%)] flex-col gap-2.5 rounded-[16px] bg-card px-[18px] py-4 shadow-float ring-1 ring-border ring-inset"
          >
            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="닫기"
                onClick={() => setOpen(false)}
              >
                ✕
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 justify-center">
              <LivePlan
                selectedKey={selectedKey}
                onSelect={onSelect}
                className="aspect-square h-auto w-[min(100%,600px,calc(100vh-320px))]"
              />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
