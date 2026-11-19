import { formatDateTime } from '@/features/work/reportForm';
import { useElapsed } from '@/features/work/run/useElapsed';
import type { WorkDayItem } from '@/features/work/types';
import { openRun, runLabel } from '@/lib/workRuns';
import { Card, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';

// 작업 종료 단계 오른쪽 위 카드: 진행 중 표시 · 경과 시간 · 시작 시각 · 서명 인원.
// 경과·시작 시각은 지금 실행 기준이다(S15P31A101-696). 실행 2 부터는 머리에 실행 번호를 붙인다.

const VALUE = 'text-lg font-semibold tabular-nums';

/** 작업 현황. signerCount 는 서명자 수(받는 중이면 undefined 라 줄을 감춘다). */
export function RunStatusCard({
  day,
  signerCount,
}: {
  day: Pick<WorkDayItem, 'actual_started_at' | 'runs'>;
  signerCount: number | undefined;
}) {
  const run = openRun({ runs: day.runs, startedAt: day.actual_started_at, endedAt: null });
  const startedAt = run?.started_at ?? day.actual_started_at;
  const elapsed = useElapsed(startedAt);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <h2>작업 현황</h2>
          <span className="rounded bg-ok/15 px-2 py-0.5 text-xs font-medium text-ok">
            {run && run.run_no > 1 ? `${runLabel(run)} · 진행 중` : '진행 중'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p
          role="timer"
          aria-label="경과 시간"
          className="text-[clamp(40px,7vw,68px)] leading-[1.1] font-bold tracking-[0.02em] tabular-nums"
        >
          {elapsed}
        </p>
        {startedAt !== null && <p className={VALUE}>시작 시각 {formatDateTime(startedAt)}</p>}
        {signerCount !== undefined && <p className={VALUE}>서명 {signerCount}명</p>}
      </CardContent>
    </Card>
  );
}
