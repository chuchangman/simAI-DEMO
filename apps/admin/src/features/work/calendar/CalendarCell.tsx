import {
  cellAriaLabel,
  type DayMark,
  type DaySummary,
} from '@/features/work/calendar/calendarMath';
import type { DateKey, DayKind } from '@/features/work/workDay';
import { buttonVariants } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { CheckCircle2 } from 'lucide-react';

// 달력 칸 하나: 오늘 칸만 밝은 주색 테두리·면과 큰 주 단추로 두드러지게 하고, 지난 날은 완료 아이콘과 색 점·숫자로 간소화하며,
// 작업 없는 지난 날은 차분하게 가라앉히고 예정인 날은 바탕에 맞춰 명도를 낮춘다.

/** 끝난 날의 표시: '작업 종료' 글자 반복 대신 작은 완료 아이콘(차분한 색). 마우스를 올리면 의미를 설명한다. */
function EndedMark({ className }: { className?: string }) {
  return (
    <span title="작업 완료(종료·제출)" className={cn('inline-flex shrink-0', className)}>
      <CheckCircle2
        aria-hidden
        data-slot="ended-mark"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </span>
  );
}

/**
 * 오늘 칸의 지금 할 일. 칸 전체가 이미 `<button>` 이라 그 안에 단추를 또 두지 않고 주 단추(`size: 'lg'`) 모양의 `span` 으로 크게 두며,
 * 누르면 칸을 누른 것과 같다(그 날 화면으로 간다).
 */
function ActionLabel({ label }: { label: string }) {
  return (
    <span
      className={cn(
        buttonVariants({ variant: 'default', size: 'lg' }),
        'mt-auto w-full text-sm font-bold shadow-xs group-hover/cell:bg-primary-hover',
      )}
    >
      {label}
    </span>
  );
}

/** 위험·경고 수: 작은 색 점 + 숫자만 보이고, 둘 다 0 이면 아무 문구도 그리지 않는다. */
function EventCounts({
  critical,
  high,
  incidents,
}: {
  critical: number;
  high: number;
  incidents?: { critical: number; high: number };
}) {
  if (critical === 0 && high === 0) return null;
  // 보이는 숫자는 관제 카드 기준 사건 수(S15P31A101-751). 경보 기록 한 건 한 건의 수는 hover 로 곁들인다
  const shownCritical = incidents ? incidents.critical : critical;
  const shownHigh = incidents ? incidents.high : high;
  const noun = incidents ? '사건' : '경보';
  const extra = (alarms: number) => (incidents ? `(경보 기록 ${alarms}건)` : '');
  return (
    <span
      data-slot="event-counts"
      className="flex items-center gap-2 font-mono text-xs tabular-nums"
    >
      {shownCritical > 0 && (
        <span
          data-slot="sev-critical"
          title={`위험 ${noun} ${shownCritical}건${extra(critical)}`}
          className="inline-flex items-center gap-1 font-bold text-sev-critical"
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-sev-critical" />
          {shownCritical}
        </span>
      )}
      {shownHigh > 0 && (
        <span
          data-slot="sev-high"
          title={`경고 ${noun} ${shownHigh}건${extra(high)}`}
          className="inline-flex items-center gap-1 font-semibold text-sev-high"
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-sev-high" />
          {shownHigh}
        </span>
      )}
    </span>
  );
}

function cellToneClass(kind: DayKind, hasSummary: boolean): string {
  if (kind === 'today') {
    // 불투명하게 섞어 바탕 모눈이 오늘 칸 안쪽에 비치지 않게 하고, 화면에서 유일하게 두드러지게 한다.
    return 'border-2 border-primary bg-[color-mix(in_oklab,var(--card),var(--primary)_14%)] text-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--card),var(--primary)_20%)] dark:bg-[color-mix(in_oklab,var(--card),var(--primary)_22%)] dark:hover:bg-[color-mix(in_oklab,var(--card),var(--primary)_28%)]';
  }
  if (kind === 'future') {
    // 예정인 날: 바탕과 어울리게 명도를 낮추되 점선 테두리로 작업 없는 지난 날과 가른다.
    return 'border border-dashed border-border/75 bg-[color-mix(in_oklab,var(--background)_72%,var(--card))] text-muted-foreground hover:border-border hover:bg-surface-2/70 hover:text-foreground focus-visible:border-border focus-visible:bg-surface-2/70';
  }
  if (hasSummary) {
    // 작업이 끝난 지난 날: 마우스 올림·키보드 초점에 은은한 테두리와 바탕 변화를 준다.
    return 'border border-border bg-card text-foreground hover:border-point-soft/65 hover:bg-surface-2 focus-visible:border-point-soft/75 focus-visible:bg-surface-2';
  }
  // 작업 없는 지난 날: 테두리 없이 아주 차분하게 가라앉힌다. 누를 수 없으므로(-670 disabled) 마우스 올림 변화도 없다.
  return 'border border-transparent bg-background/40 text-faint/65 cursor-default';
}

export function CalendarCell({
  dateKey,
  day,
  inMonth,
  kind,
  mark,
  summary,
  disabled,
  onPick,
}: {
  dateKey: DateKey;
  /** 칸에 보이는 날짜 숫자. */
  day: number;
  /** false 면 앞뒤 달의 날짜라 흐리게 보인다(누를 수 있으면 그 날로 간다). */
  inMonth: boolean;
  /** 지난 날·오늘·예정인 날. */
  kind: DayKind;
  /** 그 날의 표시(완료 아이콘·오늘의 주 단추). 없으면 비어 있다. */
  mark: DayMark | null;
  /** 지난 날 요약(작업 건수·위험·경고). 지난 날이 아니거나 끝난 작업이 없으면 null. */
  summary: DaySummary | null;
  /** 작업하지 않은 지난 날이라 누를 수 없다. */
  disabled: boolean;
  onPick: (dateKey: DateKey) => void;
}) {
  const isToday = kind === 'today';
  return (
    <button
      type="button"
      data-day-kind={kind}
      aria-label={cellAriaLabel({ dateKey, day, kind, mark, summary })}
      disabled={disabled}
      onClick={() => onPick(dateKey)}
      className={cn(
        'group/cell flex min-w-0 flex-col items-start gap-1 rounded-[12px] px-2.5 py-2 text-left',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        cellToneClass(kind, summary !== null),
        !inMonth && !isToday && 'opacity-45',
      )}
    >
      <span className="flex w-full items-center gap-1.5">
        <span
          className={cn(
            'tabular-nums',
            kind === 'past' && !summary
              ? 'text-sm font-normal'
              : kind === 'future'
                ? 'text-[15px] font-medium'
                : 'text-[15px] font-bold',
          )}
        >
          {day}
        </span>
        {isToday && (
          <span className="rounded-[4px] bg-primary px-1.5 text-[11px] leading-[18px] font-bold text-primary-foreground">
            오늘
          </span>
        )}
        {mark?.kind === 'ended' && <EndedMark className="ml-auto" />}
      </span>
      {summary && (
        <>
          <span className="text-xs text-muted-foreground">
            작업 {summary.count}건{summary.runs ? ` · 실행 ${summary.runs}회` : ''}
          </span>
          <span className="mt-auto flex w-full items-center gap-2">
            <EventCounts
              critical={summary.critical}
              high={summary.high}
              incidents={summary.incidents}
            />
            <span
              data-slot="history-hint"
              className="ml-auto text-[11px] font-medium whitespace-nowrap text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100"
            >
              히스토리 보기
            </span>
          </span>
        </>
      )}
      {mark?.kind === 'action' && <ActionLabel label={mark.label} />}
    </button>
  );
}
