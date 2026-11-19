import { stageIndexOf, WORK_STAGES, type WorkStageId } from '@/features/work/workDay';
import { cn } from '@simai/ui/lib/utils';
import { Check } from 'lucide-react';

// 날짜 화면 머리줄 오른쪽의 단계 줄: 번호 + 이름 네 칸. 표시만 한다(눌러도 이동하지 않는다).
// 지난 단계는 초록 ✓, 지금 단계는 굵게, 남은 단계는 흐리게 보인다. 작업이 끝나면 지금 단계(작업 종료)도 ✓ 다.

export function WorkStageNav({
  stage,
  finished = false,
}: {
  stage: WorkStageId;
  /** 작업이 끝났다(종료·제출). 지금 단계까지 모두 끝난 것으로 보인다. */
  finished?: boolean;
}) {
  const current = stageIndexOf(stage);
  return (
    <nav aria-label="작업 단계" className="flex min-w-0 flex-1 justify-end">
      <ol className="flex gap-2">
        {WORK_STAGES.map(({ id, label }, index) => {
          const isCurrent = index === current;
          const state =
            index < current || (finished && isCurrent) ? 'done' : isCurrent ? 'current' : 'todo';
          return (
            <li
              key={id}
              data-state={state}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 px-1.5 py-1 text-sm whitespace-nowrap',
                state === 'todo' ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {state === 'done' ? (
                <Check aria-hidden className="size-4 text-ok" />
              ) : (
                <span className={cn('tabular-nums', state === 'current' && 'text-point-soft')}>
                  {index + 1}
                </span>
              )}
              <span className={cn(isCurrent && 'font-bold')}>{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
