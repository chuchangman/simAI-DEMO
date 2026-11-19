import { CalendarCell } from '@/features/work/calendar/CalendarCell';
import {
  dayMarkOf,
  groupByDate,
  monthCells,
  monthOfKey,
  shiftMonth,
  summarizeMonth,
  summarizeWorks,
  weeksOfMonth,
  type CalendarMonth,
} from '@/features/work/calendar/calendarMath';
import { useWorkDays } from '@/features/work/useWorkDays';
import { dayKind, WEEKDAY_NAMES, type DateKey } from '@/features/work/workDay';
import { Button } from '@simai/ui/components/button';
import { Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react';
import { useMemo, useState } from 'react';

// 작업 관리 첫 화면: 작업 히스토리 달력 + 오늘 작업 진입점. 날짜를 누르면 그 날로 간다(지난 날 = 다시 보기, 오늘·예정 = 작업 흐름).
// 지난 날 칸은 끝난 작업(종료·제출)만 간결하게 보이고 작업하지 않은 지난 날은 누를 수 없다(-670). 오늘 칸은 지금 할 일 주 단추를 크게 보이고, 예정인 날 칸은 차분히 비운다.
// 한 화면에 맞춘다: 폭 1080 가운데, 아래 80px 비움(5주는 높이 720 에 맞고 6주는 스크롤).

/** 날짜 칸의 완료 아이콘(✓)과 점 색깔(빨강=위험, 주황=경고)의 의미를 마우스 올림·초점 시 설명하는 범례. */
function CalendarLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="달력 표시 범례"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/80 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <CircleHelp aria-hidden className="size-3.5" />
        표시 범례
      </button>
      {open && (
        <div
          role="tooltip"
          aria-label="달력 기호 안내"
          className="pointer-events-none absolute top-full left-0 z-30 mt-1.5 w-max rounded-lg border border-border bg-card p-3 text-xs text-foreground shadow-float"
        >
          <p className="mb-2 font-semibold">날짜 칸 표시 안내</p>
          <ul className="flex flex-col gap-1.5 text-muted-foreground">
            <li className="flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span>작업 완료 (종료·제출된 작업이 있는 날)</span>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden className="mx-1 size-1.5 shrink-0 rounded-full bg-sev-critical" />
              <span>빨간 점 + 숫자: 위험 사건 수(관제 카드 기준)</span>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden className="mx-1 size-1.5 shrink-0 rounded-full bg-sev-high" />
              <span>주황 점 + 숫자: 경고 사건 수(관제 카드 기준)</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

export function WorkCalendar({
  todayKey,
  focusDate,
  notice,
  onPick,
}: {
  /** 오늘 날짜 키. */
  todayKey: DateKey;
  /** 처음 보일 달이 든 날짜(마지막에 연 날짜, 없으면 오늘). */
  focusDate: DateKey;
  /** 머리줄 오른쪽에 잠깐 보이는 알림. 없으면 null. */
  notice: string | null;
  onPick: (date: DateKey) => void;
}) {
  const [month, setMonth] = useState<CalendarMonth>(() => monthOfKey(focusDate));
  const cells = useMemo(() => monthCells(month), [month]);
  // 달 밖 칸에도 표시가 보이도록 그 달이 걸치는 칸 전체의 날짜 범위를 받는다.
  const range = { from: cells[0]!.key, to: cells[cells.length - 1]!.key };
  const { data, error, refetch } = useWorkDays(range);
  const byDate = useMemo(() => groupByDate(data ?? []), [data]);
  const monthSummary = useMemo(
    () => (data ? summarizeMonth(cells, byDate, todayKey) : null),
    [data, cells, byDate, todayKey],
  );

  return (
    <div className="mx-auto flex min-h-[calc(100vh-140px)] w-full max-w-[1080px] flex-none flex-col gap-3.5 pb-20">
      <header className="flex flex-wrap items-center gap-2.5">
        <h2 className="min-w-[150px] text-xl font-bold tabular-nums">
          {month.year}년 {month.month}월
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="이전 달"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="다음 달"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight aria-hidden />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setMonth(monthOfKey(todayKey))}>
          오늘
        </Button>
        {error && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            작업 목록을 불러오지 못했습니다.
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              다시 시도
            </Button>
          </span>
        )}
        {(notice || monthSummary) && (
          <div data-slot="calendar-summary-bar" className="flex flex-wrap items-center gap-2.5">
            {monthSummary && (
              <p
                aria-label="월간 요약"
                title={
                  monthSummary.incidents
                    ? `이번 달 완료 작업 일수와 위험·경고 사건 합계(관제 카드 기준). 경보 기록 한 건 한 건은 위험 ${monthSummary.critical}건·경고 ${monthSummary.high}건입니다.`
                    : '이번 달 완료 작업 일수와 위험(빨간 점)·경고(주황 점) 경보 합계'
                }
                className="rounded-lg border border-border/70 bg-card/80 px-3 py-1 text-[13px] text-muted-foreground tabular-nums"
              >
                <span>작업 {monthSummary.days}일</span>
                {' · '}
                <span
                  className={
                    monthSummary.critical > 0 ? 'font-semibold text-sev-critical' : undefined
                  }
                >
                  위험{' '}
                  {monthSummary.incidents
                    ? `사건 ${monthSummary.incidents.critical}`
                    : monthSummary.critical}
                  건
                </span>
                {' · '}
                <span className={monthSummary.high > 0 ? 'font-semibold text-sev-high' : undefined}>
                  경고{' '}
                  {monthSummary.incidents
                    ? `사건 ${monthSummary.incidents.high}`
                    : monthSummary.high}
                  건
                </span>
              </p>
            )}
            <CalendarLegend />
            {notice && (
              <span
                role="status"
                className="flex items-center gap-1.5 text-sm font-semibold text-ok"
              >
                <Check aria-hidden className="size-4" />
                {notice}
              </span>
            )}
          </div>
        )}
      </header>
      <div
        className="grid flex-1 grid-cols-7 gap-2"
        style={{ gridTemplateRows: `auto repeat(${weeksOfMonth(month)}, minmax(88px, 1fr))` }}
      >
        {WEEKDAY_NAMES.map((name) => (
          <div key={name} className="px-1 py-0.5 text-[13px] font-semibold text-muted-foreground">
            {name}
          </div>
        ))}
        {cells.map(({ key, day, inMonth }) => {
          const kind = dayKind(key, todayKey);
          const works = byDate.get(key) ?? [];
          const summary = kind === 'past' ? summarizeWorks(works) : null;
          return (
            <CalendarCell
              key={key}
              dateKey={key}
              day={day}
              inMonth={inMonth}
              kind={kind}
              mark={dayMarkOf(works, kind)}
              summary={summary}
              disabled={kind === 'past' && summary === null}
              onPick={onPick}
            />
          );
        })}
      </div>
    </div>
  );
}
