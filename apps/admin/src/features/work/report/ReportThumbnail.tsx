import { ReportLoadError } from '@/features/work/report/ReportLoadError';
import { ReportView } from '@/features/work/report/ReportView';
import { useFitScale } from '@/features/work/report/useFitScale';
import { useReportPaper } from '@/features/work/report/useReportPaper';
import { cn } from '@simai/ui/lib/utils';
import { Maximize2 } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

// TBM 보고서 종이의 작은 미리보기. 종이 한 장이 틀 안에 통째로 들어가도록 줄여 보이고, 누르면(Enter·Space 도) onOpen 으로 크게 본다.
// 종이는 화면 종이와 같은 모양·글이고 읽기 전용이라, 줄이는 것은 배율(transform)뿐이다.

/** 줄이기 전 종이 폭(px). A4 화면 종이의 최대 폭이다. */
const PAPER_WIDTH = 794;
const LABEL = 'TBM 보고서 크게 보기';

export function ReportThumbnail({ workId, onOpen }: { workId: string; onOpen: () => void }) {
  const { query, latest, paper } = useReportPaper(workId);
  const frameRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(frameRef, paperRef);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {query.error && latest === null && <ReportLoadError onRetry={() => void query.refetch()} />}
      <div
        ref={frameRef}
        role="button"
        tabIndex={0}
        aria-label={LABEL}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        className={cn(
          'group relative min-h-0 flex-1 cursor-zoom-in overflow-hidden rounded-md bg-muted/40',
          'transition-shadow hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        )}
      >
        <div
          ref={paperRef}
          style={{
            width: PAPER_WIDTH,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
          className="pointer-events-none absolute top-1/2 left-1/2 origin-center"
        >
          <ReportView {...paper} />
        </div>
        <Maximize2
          aria-hidden
          className="absolute top-2 right-2 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </div>
    </div>
  );
}
