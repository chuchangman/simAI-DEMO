import { formatClock } from '@/features/history/works';
import { formatDuration } from '@/features/work/reportForm';
import { workDurationMs } from '@/features/work/run/run';
import { useRunAlarms } from '@/features/work/run/useRunAlarms';
import type { WorkDayItem } from '@/features/work/types';
import { lastRun, runLabel } from '@/lib/workRuns';
import { Card, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';
import { cn } from '@simai/ui/lib/utils';

// 작업 종료 뒤 화면의 실행 요약 카드(S15P31A101-734): 이번에 얼마나 했고(경과), 위험 경보가 몇 건 났고 그중 확인하지 않은 것이 몇 건인지.
// 보고서를 내기 전에 한눈에 보게 한다. 경과는 마지막 실행 기준이다(한 번 더 실행하면 그 실행). 경보 목록을 못 받았으면 건수를 지어내지 않는다.

export function EndSummaryCard({
  day,
}: {
  day: Pick<WorkDayItem, 'runs' | 'actual_started_at' | 'actual_ended_at'>;
}) {
  const run = lastRun({
    runs: day.runs,
    startedAt: day.actual_started_at,
    endedAt: day.actual_ended_at,
  });
  const { counts, failed } = useRunAlarms(run?.started_at ?? null, run?.ended_at ?? null);
  if (run === null || run.ended_at === null) return null;
  const { started_at: startedAt, ended_at: endedAt } = run;
  return (
    <Card size="sm" aria-label="작업 요약">
      <CardHeader>
        <CardTitle>
          <h2>{run.run_no > 1 ? `${runLabel(run)} 요약` : '작업 요약'}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5">
          <dt className="text-muted-foreground">작업 시간</dt>
          <dd className="font-semibold tabular-nums">
            {formatDuration(workDurationMs(startedAt, endedAt, endedAt))}
            <span className="ml-2 font-normal text-muted-foreground">
              {formatClock(startedAt)}–{formatClock(endedAt)}
            </span>
          </dd>
          <dt className="text-muted-foreground">위험 경보</dt>
          <dd className="font-semibold">
            {counts === null ? (
              <span className="font-normal text-muted-foreground">
                {failed ? '경보 목록을 받지 못했어요' : '경보 목록을 받는 중이에요'}
              </span>
            ) : (
              <>
                {counts.total}건
                <span
                  className={cn(
                    'ml-2 font-normal',
                    counts.unconfirmed > 0 ? 'text-sev-caution' : 'text-muted-foreground',
                  )}
                >
                  {counts.unconfirmed > 0
                    ? `확인하지 않은 경보 ${counts.unconfirmed}건`
                    : '모두 확인했어요'}
                </span>
              </>
            )}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
