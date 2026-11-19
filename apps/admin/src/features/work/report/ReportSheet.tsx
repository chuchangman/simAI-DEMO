import { ReportView } from '@/features/work/report/ReportView';
import { useFitScale } from '@/features/work/report/useFitScale';
import { cn } from '@simai/ui/lib/utils';
import { useRef, type ComponentProps, type KeyboardEvent } from 'react';

// 틀 높이에 맞춘 A4 한 장(210:297)짜리 TBM 보고서. A4 틀(794×1123)은 비율을 지킨 채 틀 안에 통째로 줄이고,
// 종이 내용이 A4 보다 길면 내용만 틀 안쪽에서 한 번 더 줄인다(그냥 줄이면 종이가 길쭉해진다). 누르면(Enter·Space 도) onOpen 으로 크게 본다.

/** A4 화면 종이의 폭·높이(px, 96dpi). */
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;
const LABEL = 'TBM 보고서 크게 보기';

export function ReportSheet({
  paper,
  onOpen,
}: {
  paper: Omit<ComponentProps<typeof ReportView>, 'variant' | 'onEdit'>;
  onOpen: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sheetScale = useFitScale(frameRef, sheetRef);
  const contentScale = useFitScale(bodyRef, contentRef);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' '))
      return;
    event.preventDefault();
    onOpen();
  };

  return (
    <div
      ref={frameRef}
      role="button"
      tabIndex={0}
      aria-label={LABEL}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className="group relative min-h-0 flex-1 cursor-zoom-in overflow-hidden rounded-sm focus-visible:outline-none"
    >
      <div
        ref={sheetRef}
        style={{
          width: A4_WIDTH,
          height: A4_HEIGHT,
          transform: `translateX(-50%) scale(${sheetScale})`,
        }}
        className={cn(
          'paper absolute top-0 left-1/2 origin-top rounded-sm bg-card shadow-float transition-shadow',
          'group-hover:ring-4 group-hover:ring-ring group-focus-visible:ring-4 group-focus-visible:ring-ring',
        )}
      >
        <div ref={bodyRef} className="absolute inset-x-10 top-9 bottom-11 overflow-hidden">
          <div
            ref={contentRef}
            style={{ transform: `scale(${contentScale})` }}
            className="pointer-events-none origin-top"
          >
            <ReportView {...paper} variant="sheet" />
          </div>
        </div>
      </div>
    </div>
  );
}
