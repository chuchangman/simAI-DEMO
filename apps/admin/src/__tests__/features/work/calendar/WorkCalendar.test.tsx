import { workDayOf } from '@/__tests__/features/work/workFixture';
import { WorkCalendar } from '@/features/work/calendar/WorkCalendar';
import type { WorkDayItem } from '@/features/work/types';
import { createWorkMock } from '@/mocks/work';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

// 달력은 GET /api/work-units?from&to 로 그 달이 걸치는 칸 전체의 작업을 받아 날짜별로 보인다. 오늘은 2026-11-11(수).

const TODAY = '2026-11-11';
/** 작업 목의 시계(오늘 아침 9시). */
const NOW = new Date(2026, 10, 11, 9, 0).getTime();

const daily = (date: string, overrides: Partial<WorkDayItem> = {}) =>
  workDayOf({ work_id: `d-${date}`, date, daily: true, ...overrides });
const past = (id: string, date: string, overrides: Partial<WorkDayItem> = {}) =>
  workDayOf({
    work_id: id,
    date,
    daily: false,
    progress: 'SUBMITTED',
    status: 'DONE',
    ...overrides,
  });

const FIXTURE_WORKS: WorkDayItem[] = [
  // 지난 날: 작업 2건(위험 2+1, 경고 1+없음)
  past('p1', '2026-11-09', { event_counts: { CRITICAL: 2, HIGH: 1 } }),
  past('p2', '2026-11-09', { event_counts: { CRITICAL: 1 } }),
  // 지난 날: 이벤트 수가 0
  past('p3', '2026-11-08', { event_counts: { CRITICAL: 0, HIGH: 0 } }),
  // 지난 날: 이벤트 수를 모름
  past('p4', '2026-11-10', { event_counts: null }),
  // 예정인 날: 보고서 작성 중
  daily('2026-11-12', { progress: 'REPORT' }),
];

let works: WorkDayItem[] = [];
/** 이 시험에서 달력이 보낸 날짜 범위('from..to'). */
let ranges: string[] = [];
let failList = false;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  works = FIXTURE_WORKS;
  ranges = [];
  failList = false;
  document.documentElement.classList.remove('dark');
  server.resetHandlers(
    http.get('*/api/work-units', ({ request }) => {
      const url = new URL(request.url);
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      ranges.push(`${from}..${to}`);
      if (failList) return HttpResponse.json({ code: 'SERVER_ERROR' }, { status: 500 });
      return HttpResponse.json({ works: works.filter((w) => w.date >= from && w.date <= to) });
    }),
  );
});
afterEach(cleanup);

function renderCalendar(overrides: Partial<Parameters<typeof WorkCalendar>[0]> = {}) {
  const onPick = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <WorkCalendar
        todayKey={TODAY}
        focusDate={TODAY}
        notice={null}
        onPick={onPick}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onPick, container };
}

/** 날짜 이름(예: '11월 9일')으로 시작하는 달력 칸 단추를 찾는다(뒤에 요약·할 일이 붙어도 찾는다). */
const cellOf = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label}(?:,|$)`) });
const endedIconOf = (cell: HTMLElement) =>
  cell.querySelector<SVGElement>('[data-slot="ended-mark"]');
const topCriticalDotOf = (cell: HTMLElement) =>
  cell.querySelector<HTMLElement>('[data-slot="critical-top-dot"]');
const criticalBadgeOf = (cell: HTMLElement) =>
  cell.querySelector<HTMLElement>('[data-slot="sev-critical"]');
const highBadgeOf = (cell: HTMLElement) =>
  cell.querySelector<HTMLElement>('[data-slot="sev-high"]');
const historyHintOf = (cell: HTMLElement) =>
  cell.querySelector<HTMLElement>('[data-slot="history-hint"]');

describe('WorkCalendar', () => {
  it('머리줄에 연·월과 이전·다음 달·오늘 단추, 요일 줄과 그 달이 걸치는 5주를 보인다', async () => {
    renderCalendar();
    expect(screen.getByRole('heading', { name: '2026년 11월' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '이전 달' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '다음 달' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '오늘' })).toBeTruthy();
    expect(screen.getAllByText(/^[일월화수목금토]$/).map((n) => n.textContent)).toEqual([
      '일',
      '월',
      '화',
      '수',
      '목',
      '금',
      '토',
    ]);
    // 5주 = 35칸(11월 1일 ~ 12월 5일).
    expect(screen.getAllByRole('button', { name: /^\d+월 \d+일(?:,|$)/ })).toHaveLength(35);
    expect(cellOf('11월 1일')).toBeTruthy();
    expect(cellOf('12월 5일')).toBeTruthy();
    await screen.findByText('작업 2건');
  });

  it('5주 달은 행이 5개, 6주 달은 6개다(행 높이는 최소 88px)', async () => {
    const rowsOf = (container: HTMLElement) =>
      container.querySelector<HTMLElement>('[style*="grid-template-rows"]')?.style.gridTemplateRows;
    const five = renderCalendar();
    expect(rowsOf(five.container)).toBe('auto repeat(5, minmax(88px, 1fr))');
    cleanup();
    // 2026년 8월은 6주(7월 26일 ~ 9월 5일).
    const six = renderCalendar({ focusDate: '2026-08-15' });
    expect(rowsOf(six.container)).toBe('auto repeat(6, minmax(88px, 1fr))');
    expect(screen.getAllByRole('button', { name: /^\d+월 \d+일(?:,|$)/ })).toHaveLength(42);
    await waitFor(() => expect(ranges).toContain('2026-07-26..2026-09-05'));
  });

  it('처음엔 마지막에 연 날짜(focusDate)가 든 달을 보인다', () => {
    renderCalendar({ focusDate: '2026-12-15' });
    expect(screen.getByRole('heading', { name: '2026년 12월' })).toBeTruthy();
  });

  it('머리줄 오른쪽에 이미 받은 그 달 작업으로 계산한 월간 요약(작업 N일 · 위험 N건 · 경고 N건)을 보인다', async () => {
    // 달 밖 날짜(12월 1일)에 작업이 있어도 11월 월간 요약에는 섞이지 않는다.
    works = [
      ...FIXTURE_WORKS,
      past('next-month', '2026-12-01', { event_counts: { CRITICAL: 9, HIGH: 9 } }),
    ];
    renderCalendar();
    const summary = await screen.findByLabelText('월간 요약');
    // 11월 8·9·10일 3일(9일은 작업 2건이어도 1일), 위험 3건, 경고 1건. 추가 요청 없음(범위 요청 1번뿐).
    expect(summary.textContent).toBe('작업 3일 · 위험 3건 · 경고 1건');
    expect(within(summary).getByText('위험 3건').className).toContain('text-sev-critical');
    expect(within(summary).getByText('경고 1건').className).toContain('text-sev-high');
    // 상단 바 오른쪽 GPU 호버 툴팁과 겹치지 않도록 월간 요약 줄은 오른쪽 끝(ml-auto)으로 밀지 않는다.
    expect(summary.parentElement?.className).not.toContain('ml-auto');
    expect(ranges).toEqual(['2026-11-01..2026-12-05']);
  });

  it('표시 범례 단추에 마우스를 올리거나 초점을 주면 완료 아이콘과 점 색깔 설명 툴팁을 보인다', async () => {
    renderCalendar();
    const trigger = await screen.findByRole('button', { name: '달력 표시 범례' });
    expect(screen.queryByRole('tooltip', { name: '달력 기호 안내' })).toBeNull();

    fireEvent.mouseEnter(trigger.parentElement!);
    const tooltip = screen.getByRole('tooltip', { name: '달력 기호 안내' });
    expect(tooltip.textContent).toContain('작업 완료');
    expect(tooltip.textContent).toContain('빨간 점 + 숫자: 위험 사건 수');
    expect(tooltip.textContent).toContain('주황 점 + 숫자: 경고 사건 수');

    fireEvent.mouseLeave(trigger.parentElement!);
    expect(screen.queryByRole('tooltip', { name: '달력 기호 안내' })).toBeNull();
  });

  it('오늘 칸에는 오늘 태그가 붙고, 작업이 없으면 오늘 작업 준비 주 단추 모양이 크게 들어간다', async () => {
    renderCalendar();
    const today = cellOf('11월 11일');
    expect(within(today).getByText('오늘')).toBeTruthy();
    const cta = within(today).getByText('오늘 작업 준비');
    expect(cta.className).toContain('w-full');
    expect(cta.className).toContain('h-9');
    expect(cta.className).toContain('bg-primary');
    // 오늘 태그·오늘 작업 준비 단추는 오늘 칸에만 있다.
    expect(screen.getAllByText('오늘 작업 준비')).toHaveLength(1);
    expect(screen.getAllByText('오늘', { selector: 'span' })).toHaveLength(1);
    await screen.findByText('작업 2건');
  });

  it('오늘 칸만 불투명한 주색 혼합 면과 2px 주색 테두리로 강조하고(격자 비침 없음), 어두운·밝은 테마 모두 대응한다', async () => {
    document.documentElement.classList.add('dark');
    renderCalendar();
    const today = cellOf('11월 11일');
    expect(today.className).toContain('border-2');
    expect(today.className).toContain('border-primary');
    // 반투명 bg-primary/10 대신 카드 바탕과 불투명하게 섞어 모눈이 비치지 않게 한다.
    expect(today.className).toContain('bg-[color-mix(in_oklab,var(--card),var(--primary)_14%)]');
    expect(today.className).toContain(
      'dark:bg-[color-mix(in_oklab,var(--card),var(--primary)_22%)]',
    );
    expect(today.className).not.toContain('bg-primary/10');
    const other = cellOf('11월 12일');
    expect(other.className).not.toContain('border-primary');
    await screen.findByText('작업 2건');

    // 다른 달에서 오늘이 달 밖 칸으로 보여도 투명도를 낮추지 않아 격자가 비치지 않는다.
    cleanup();
    document.documentElement.classList.remove('dark');
    renderCalendar({ todayKey: '2026-12-01', focusDate: '2026-11-15' });
    expect(cellOf('12월 1일').className).not.toContain('opacity-45');
  });

  it('지난 날 + 작업 있음: 작업 종료 글자 대신 작은 완료 아이콘, 작업 건수, 색 점 + 숫자를 보이고 날짜 옆 빨간 점은 없다(-677)', async () => {
    renderCalendar();
    await screen.findByText('작업 2건');
    const day = cellOf('11월 9일');
    expect(endedIconOf(day)).not.toBeNull();
    expect(endedIconOf(day)?.getAttribute('class')).toContain('text-muted-foreground');
    expect(screen.queryByText('작업 종료')).toBeNull();
    expect(within(day).getByText('작업 2건')).toBeTruthy();
    // 날짜 옆 빨간 점은 위험 수와 중복이라 그리지 않는다(-677).
    expect(topCriticalDotOf(day)).toBeNull();
    // 위험·경고는 작은 색 점 + 숫자로 보인다.
    expect(criticalBadgeOf(day)?.textContent).toBe('3');
    expect(criticalBadgeOf(day)?.className).toContain('text-sev-critical');
    expect(criticalBadgeOf(day)?.querySelector('.bg-sev-critical')).not.toBeNull();
    expect(highBadgeOf(day)?.textContent).toBe('1');
    expect(highBadgeOf(day)?.className).toContain('text-sev-high');
    expect(highBadgeOf(day)?.querySelector('.bg-sev-high')).not.toBeNull();
  });

  it('위험·경고가 둘 다 0 이거나 모르면 아무 문구도 그리지 않고(위험·경고 없음 제거), 경고만 있으면 경고만 보인다', async () => {
    renderCalendar();
    await screen.findByText('작업 2건');
    for (const label of ['11월 8일', '11월 10일']) {
      const day = cellOf(label);
      expect(within(day).getByText('작업 1건')).toBeTruthy();
      expect(criticalBadgeOf(day)).toBeNull();
      expect(highBadgeOf(day)).toBeNull();
      expect(topCriticalDotOf(day)).toBeNull();
    }
    expect(screen.queryByText('위험·경고 없음')).toBeNull();

    works = [past('p5', '2026-11-07', { event_counts: { HIGH: 2 } })];
    cleanup();
    renderCalendar();
    await screen.findByText('작업 1건');
    const highOnly = cellOf('11월 7일');
    expect(topCriticalDotOf(highOnly)).toBeNull();
    expect(criticalBadgeOf(highOnly)).toBeNull();
    expect(highBadgeOf(highOnly)?.textContent).toBe('2');
  });

  it('지난 날 완료 아이콘은 제출 여부와 상관없이 표시된다(종료·제출·진행 값 없는 옛 응답 모두)', async () => {
    works = [
      past('p1', '2026-11-09', { progress: 'ENDED' }),
      past('p2', '2026-11-08', { progress: 'SUBMITTED' }),
      past('p3', '2026-11-07', { progress: null, actual_ended_at: 1_000 }),
    ];
    renderCalendar();
    await waitFor(() => expect(endedIconOf(cellOf('11월 9일'))).not.toBeNull());
    expect(within(cellOf('11월 9일')).getByText('작업 1건')).toBeTruthy();
    expect(endedIconOf(cellOf('11월 8일'))).not.toBeNull();
    expect(endedIconOf(cellOf('11월 7일'))).not.toBeNull();
  });

  it('지난 날에 끝나지 않은 작업(보고서·세팅·세팅 완료·작업 중)만 있으면 빈칸이다', async () => {
    works = [
      daily('2026-11-10', { progress: 'REPORT' }),
      daily('2026-11-09', { progress: 'SETUP' }),
      daily('2026-11-08', { progress: 'SETUP_DONE' }),
      daily('2026-11-07', { progress: 'IN_PROGRESS' }),
      past('p5', '2026-11-06', { progress: null, actual_ended_at: null }),
      // 같은 날 끝난 작업이 있으면 끝난 작업만 센다.
      past('p6', '2026-11-05', { progress: 'SUBMITTED', event_counts: { CRITICAL: 1 } }),
      daily('2026-11-05', { progress: 'IN_PROGRESS', event_counts: { CRITICAL: 9, HIGH: 9 } }),
    ];
    renderCalendar();
    const counted = cellOf('11월 5일');
    expect(await within(counted).findByText('작업 1건')).toBeTruthy();
    expect(criticalBadgeOf(counted)?.textContent).toBe('1');
    expect(highBadgeOf(counted)).toBeNull();
    for (const day of [10, 9, 8, 7, 6]) {
      const empty = cellOf(`11월 ${day}일`);
      expect(empty.textContent).toBe(String(day));
      expect(endedIconOf(empty)).toBeNull();
    }
  });

  it('작업 목의 지난 이력은 제출한 날도 제출하지 않은 날도 완료 아이콘으로 보인다', async () => {
    server.use(...createWorkMock({ now: () => NOW }).handlers);
    renderCalendar();
    await waitFor(() => expect(endedIconOf(cellOf('11월 10일'))).not.toBeNull());
    expect(endedIconOf(cellOf('11월 9일'))).not.toBeNull();
  });

  it('작업이 없는 지난 날은 표시도 요약도 없고 누를 수 없다', async () => {
    const { onPick } = renderCalendar();
    await screen.findByText('작업 2건');
    const empty = cellOf('11월 5일') as HTMLButtonElement;
    expect(empty.textContent).toBe('5');
    expect(empty.disabled).toBe(true);
    fireEvent.click(empty);
    expect(onPick).not.toHaveBeenCalled();
    // 끝난 작업이 있는 지난 날·오늘·예정인 날은 누를 수 있다.
    for (const label of ['11월 9일', '11월 11일', '11월 20일']) {
      expect((cellOf(label) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('작업이 없는 지난 날은 차분하게 가라앉고, 예정인 날은 바탕에 맞춰 명도를 낮추되 점선 테두리로 구별된다', async () => {
    renderCalendar();
    await screen.findByText('작업 2건');
    const emptyPast = cellOf('11월 5일');
    const future = cellOf('11월 12일');
    const workedPast = cellOf('11월 9일');

    expect(emptyPast.textContent).toBe('5');
    expect(emptyPast.className).toContain('border-transparent');
    expect(emptyPast.className).toContain('bg-background/40');

    expect(future.className).toContain('border-dashed');
    expect(future.className).toContain(
      'bg-[color-mix(in_oklab,var(--background)_72%,var(--card))]',
    );
    expect(future.className).not.toBe(emptyPast.className);
    expect(future.className).not.toBe(workedPast.className);
  });

  it('작업이 끝난 지난 날 칸은 평소 히스토리 보기를 숨기고 마우스 올림·키보드 초점에 은은한 테두리와 함께 드러낸다', async () => {
    renderCalendar();
    await screen.findByText('작업 2건');
    const worked = cellOf('11월 9일');
    const hint = historyHintOf(worked);
    expect(worked.className).toContain('hover:border-point-soft/65');
    expect(worked.className).toContain('focus-visible:border-point-soft/75');
    expect(hint?.textContent).toBe('히스토리 보기');
    expect(hint?.className).toContain('opacity-0');
    expect(hint?.className).toContain('group-hover/cell:opacity-100');
    expect(hint?.className).toContain('group-focus-visible/cell:opacity-100');
  });

  it('접근성: aria-label 에 날짜와 요약(위험·경고 수, 오늘이면 할 일)을 담는다', async () => {
    renderCalendar();
    await screen.findByText('작업 2건');
    expect(cellOf('11월 11일').getAttribute('aria-label')).toBe('11월 11일, 오늘, 오늘 작업 준비');
    expect(cellOf('11월 9일').getAttribute('aria-label')).toBe(
      '11월 9일, 작업 2건 완료, 위험 3건, 경고 1건',
    );
    expect(cellOf('11월 8일').getAttribute('aria-label')).toBe(
      '11월 8일, 작업 1건 완료, 위험 0건, 경고 0건',
    );
    expect(cellOf('11월 5일').getAttribute('aria-label')).toBe('11월 5일');
    expect(cellOf('11월 12일').getAttribute('aria-label')).toBe('11월 12일');
  });

  it.each([
    ['REPORT', '오늘 작업 준비'],
    ['SETUP', '세팅 이어하기'],
    ['SETUP_DONE', '작업 전 확인'],
    ['IN_PROGRESS', '관제 중'],
    ['ENDED', '보고서 제출'],
  ] as const)('오늘 칸 단추 글: 진행 값 %s 이면 `%s`', async (progress, label) => {
    works = [daily(TODAY, { progress })];
    renderCalendar();
    const today = cellOf('11월 11일');
    const button = await within(today).findByText(label);
    // 칸 전체가 이미 단추라 안에 단추를 또 두지 않는다(주 단추 모양의 span).
    expect(button.tagName).toBe('SPAN');
    expect(button.className).toContain('bg-primary');
    expect(button.className).toContain('w-full');
    expect(today.querySelectorAll('button')).toHaveLength(0);
    expect(today.getAttribute('aria-label')).toBe(`11월 11일, 오늘, ${label}`);
  });

  it('오늘 작업을 제출했으면 단추 없이 완료 아이콘이고 aria-label 도 작업 완료다', async () => {
    works = [daily(TODAY, { progress: 'SUBMITTED' })];
    renderCalendar();
    const today = cellOf('11월 11일');
    await waitFor(() => expect(endedIconOf(today)).not.toBeNull());
    expect(within(today).queryByText('오늘 작업 준비')).toBeNull();
    expect(today.getAttribute('aria-label')).toBe('11월 11일, 오늘, 작업 완료');
  });

  it('오늘 칸의 단추 모양을 눌러도 칸처럼 그 날로 간다(바로 시작하지 않음)', async () => {
    const { onPick } = renderCalendar();
    fireEvent.click(within(cellOf('11월 11일')).getByText('오늘 작업 준비'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(TODAY);
    await screen.findByText('작업 2건');
  });

  it('예정인 날은 작업이 있어도 아무것도 그리지 않는다', async () => {
    works = [
      past('p1', '2026-11-09'),
      daily('2026-11-12', { progress: 'REPORT' }),
      daily('2026-11-13', { progress: 'SETUP_DONE' }),
      daily('2026-11-14', { progress: 'SUBMITTED' }),
    ];
    renderCalendar();
    // 작업 목록이 칸에 들어온 뒤에도(지난 날 칸에 작업 건수가 보인다) 예정인 칸은 날짜만 있다.
    await screen.findByText('작업 1건');
    for (const day of [12, 13, 14, 15]) {
      expect(cellOf(`11월 ${day}일`).textContent).toBe(String(day));
    }
  });

  it('이전·다음 달 단추로 달을 옮기고 그 달이 걸치는 칸 전체의 작업을 받는다', async () => {
    renderCalendar();
    await waitFor(() => expect(ranges).toEqual(['2026-11-01..2026-12-05']));

    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    expect(screen.getByRole('heading', { name: '2026년 12월' })).toBeTruthy();
    await waitFor(() => expect(ranges).toContain('2026-11-29..2027-01-02'));

    fireEvent.click(screen.getByRole('button', { name: '이전 달' }));
    fireEvent.click(screen.getByRole('button', { name: '이전 달' }));
    expect(screen.getByRole('heading', { name: '2026년 10월' })).toBeTruthy();
    await waitFor(() => expect(ranges).toContain('2026-09-27..2026-10-31'));
  });

  it('오늘 단추는 오늘이 든 달로 돌아온다', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    expect(screen.getByRole('heading', { name: '2027년 1월' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '오늘' }));
    expect(screen.getByRole('heading', { name: '2026년 11월' })).toBeTruthy();
  });

  it('칸을 누르면 그 날짜 키로 알린다(지난 날·오늘·예정인 날 모두)', async () => {
    const { onPick } = renderCalendar();
    await screen.findByText('작업 2건');
    fireEvent.click(cellOf('11월 9일'));
    fireEvent.click(cellOf('11월 11일'));
    fireEvent.click(cellOf('11월 20일'));
    expect(onPick.mock.calls.map((c) => c[0])).toEqual(['2026-11-09', '2026-11-11', '2026-11-20']);
  });

  it('달 밖 날짜는 흐리게 보이지만 눌린다', async () => {
    const { onPick } = renderCalendar();
    const outside = cellOf('12월 1일');
    expect(outside.className).toContain('opacity-45');
    expect(cellOf('11월 30일').className).not.toContain('opacity-45');
    fireEvent.click(outside);
    expect(onPick).toHaveBeenCalledWith('2026-12-01');
    await screen.findByText('작업 2건');
  });

  it('달 밖 날짜에도 그 날 작업의 완료 표시와 요약이 보인다', async () => {
    // 10월 달력의 첫 줄은 9월 27~30일(달 밖, 지난 날)이다.
    works = [past('p1', '2026-09-30', { progress: 'SUBMITTED' })];
    renderCalendar({ focusDate: '2026-10-15' });
    const outside = cellOf('9월 30일');
    expect(await within(outside).findByText('작업 1건')).toBeTruthy();
    expect(endedIconOf(outside)).not.toBeNull();
  });

  it('알림이 있으면 머리줄에 월간 요약과 함께 보인다', async () => {
    renderCalendar({ notice: '보고서를 보냈습니다' });
    expect(screen.getByRole('status').textContent).toBe('보고서를 보냈습니다');
    expect((await screen.findByLabelText('월간 요약')).textContent).toBe(
      '작업 3일 · 위험 3건 · 경고 1건',
    );
    await screen.findByText('작업 2건');
  });

  it('작업 목록을 못 받으면 월간 요약을 비운 채 알리고, 다시 시도하면 받아 온다', async () => {
    failList = true;
    renderCalendar();
    expect(await screen.findByText('작업 목록을 불러오지 못했습니다.')).toBeTruthy();
    expect(screen.queryByLabelText('월간 요약')).toBeNull();
    failList = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('작업 2건')).toBeTruthy();
    expect(screen.queryByText('작업 목록을 불러오지 못했습니다.')).toBeNull();
    expect(screen.getByLabelText('월간 요약').textContent).toBe('작업 3일 · 위험 3건 · 경고 1건');
  });
});
