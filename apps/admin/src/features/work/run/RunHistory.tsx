import { formatClock } from '@/features/history/works';
import { formatDuration } from '@/features/work/reportForm';
import type { WorkDayItem } from '@/features/work/types';
import { runLabel, runsOf } from '@/lib/workRuns';

// 작업 종료 화면의 실행 기록(S15P31A101-696): 하루 작업 안에서 「작업 시작 ~ 작업 종료」를 여러 번 했으면 실행마다 시각·걸린 시간을 보인다.
// 실행이 하나면 그리지 않는다(종료 화면 위 시각과 같다).

export function RunHistory({
  day,
}: {
  day: Pick<WorkDayItem, 'runs' | 'actual_started_at' | 'actual_ended_at'>;
}) {
  const runs = runsOf({
    runs: day.runs,
    startedAt: day.actual_started_at,
    endedAt: day.actual_ended_at,
  });
  if (runs.length < 2) return null;
  return (
    <section
      aria-label="실행 기록"
      className="rounded-[12px] bg-card px-4 py-3 ring-1 ring-border ring-inset"
    >
      <ul className="flex flex-wrap gap-x-6 gap-y-1.5">
        {runs.map((run) => (
          <li key={run.run_no} className="flex items-baseline gap-2 tabular-nums">
            <span className="font-semibold">{runLabel(run)}</span>
            <span>
              {formatClock(run.started_at)}–
              {run.ended_at === null ? '진행 중' : formatClock(run.ended_at)}
            </span>
            {run.ended_at !== null && (
              <span className="text-muted-foreground">
                {formatDuration(run.ended_at - run.started_at)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
