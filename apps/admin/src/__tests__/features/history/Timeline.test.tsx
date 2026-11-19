import type { EventRow } from '@/features/history/replayIndex';
import { SPEEDS, Timeline, type TimelineProps } from '@/features/history/Timeline';
import type { ReplayStatus } from '@/features/viewer3d';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 작업 10:00–11:30(90분). 슬라이더 한 칸은 1.9초(chooseStep 이 T2 에 주는 값)다.
const at = (h: number, m: number, s = 0) => new Date(2026, 9, 28, h, m, s).getTime();
const FROM = at(10, 0);
const TO = at(11, 30);
const STEP = 1_900;

const status = (patch: Partial<ReplayStatus> = {}): ReplayStatus => ({
  playhead: at(10, 20),
  start: FROM,
  end: TO,
  playing: false,
  ended: false,
  speed: 1,
  worldT: at(10, 20),
  recordAgeMs: 0,
  gap: false,
  ...patch,
});

const event = (patch: Partial<EventRow> = {}): EventRow => ({
  eventId: 'e-1',
  ruleId: 'R2',
  severity: 'CRITICAL',
  worldIds: ['w-0015'],
  zoneId: 'z-04',
  raisedAt: at(10, 20, 5),
  resolvedAt: null,
  ...patch,
});

function renderTimeline(props: Partial<TimelineProps> = {}) {
  const handlers = {
    onSeek: vi.fn(),
    onJump: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onSpeed: vi.fn(),
  };
  render(
    <Timeline
      from={FROM}
      to={TO}
      stepMs={STEP}
      status={status()}
      events={[]}
      gaps={[]}
      noData={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const region = () => screen.getByRole('region', { name: '타임라인' });
const slider = () => screen.getByRole('slider', { name: '재생 시각' }) as HTMLInputElement;
const speedButton = (label: string) =>
  within(screen.getByRole('group', { name: '배속' })).getByRole('button', { name: label });

afterEach(cleanup);

describe('타임라인: 시각과 슬라이더', () => {
  it('재생 시각과 작업 처음·끝을 보이고, 슬라이더 범위는 작업 구간이다', () => {
    renderTimeline();
    expect(within(region()).getByText('10:20:00')).toBeTruthy();
    expect(within(region()).getByText('10:00')).toBeTruthy();
    expect(within(region()).getByText('11:30')).toBeTruthy();

    expect(slider().min).toBe(String(FROM));
    expect(slider().max).toBe(String(TO));
    expect(slider().step).toBe(String(STEP));
    expect(slider().value).toBe(String(at(10, 20)));
    expect(slider().getAttribute('aria-valuetext')).toBe('10:20:00');
  });

  it('재생 시각을 모르면 —로 두고 슬라이더는 처음에 둔다', () => {
    renderTimeline({ status: status({ playhead: null }) });
    expect(within(region()).getByText('—')).toBeTruthy();
    expect(slider().value).toBe(String(FROM));
  });

  it('슬라이더를 옮기면 그 시각으로 옮기라고 알린다', () => {
    const { onSeek } = renderTimeline();
    const t = FROM + 100 * STEP;
    fireEvent.change(slider(), { target: { value: String(t) } });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(t);
  });

  it('맨 끝 칸은 구간 끝으로 본다(구간 끝이 간격의 배수가 아니어도 끝에 닿는다)', () => {
    // 5,400,000 / 1,900 = 2,842.1 칸이라 마지막 칸은 끝보다 200ms 앞이다.
    const lastStep = FROM + Math.floor((TO - FROM) / STEP) * STEP;
    expect(lastStep).toBeLessThan(TO);
    const { onSeek } = renderTimeline();
    fireEvent.change(slider(), { target: { value: String(lastStep) } });
    expect(onSeek).toHaveBeenLastCalledWith(TO);

    // 그 바로 앞 칸은 그대로 그 시각이다.
    fireEvent.change(slider(), { target: { value: String(lastStep - STEP) } });
    expect(onSeek).toHaveBeenLastCalledWith(lastStep - STEP);

    // 끝 시각 자체를 넣어도 끝이다.
    fireEvent.change(slider(), { target: { value: String(TO) } });
    expect(onSeek).toHaveBeenLastCalledWith(TO);
  });

  it('구간 끝이 간격의 배수이면 그 칸이 끝이다', () => {
    const to = FROM + 3_000 * 1_000;
    const { onSeek } = renderTimeline({ to, stepMs: 1_000 });
    fireEvent.change(slider(), { target: { value: String(to) } });
    expect(onSeek).toHaveBeenLastCalledWith(to);
  });
});

describe('타임라인: 재생·일시정지·배속', () => {
  it('멈춰 있으면 재생 버튼이고, 누르면 재생하라고 알린다', () => {
    const { onPlay, onPause } = renderTimeline({ status: status({ playing: false }) });
    expect(screen.queryByRole('button', { name: '일시정지' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
  });

  it('재생 중이면 일시정지 버튼이고, 누르면 멈추라고 알린다', () => {
    const { onPlay, onPause } = renderTimeline({ status: status({ playing: true }) });
    expect(screen.queryByRole('button', { name: '재생' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('끝에 닿았으면 재생 의도가 남아 있어도 재생 버튼이다(재생 중으로 남지 않는다)', () => {
    const { onPlay, onPause } = renderTimeline({
      status: status({ playhead: TO, playing: true, ended: true }),
    });
    expect(screen.queryByRole('button', { name: '일시정지' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
    expect(within(region()).getByText('11:30:00')).toBeTruthy();
  });

  it('배속은 0.5·1·2·4 배이고 고른 배속만 눌린 상태다', () => {
    expect([...SPEEDS]).toEqual([0.5, 1, 2, 4]);
    renderTimeline({ status: status({ speed: 2 }) });
    const group = within(screen.getByRole('group', { name: '배속' }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '0.5×',
      '1×',
      '2×',
      '4×',
    ]);
    expect(speedButton('2×').getAttribute('aria-pressed')).toBe('true');
    for (const other of ['0.5×', '1×', '4×'])
      expect(speedButton(other).getAttribute('aria-pressed')).toBe('false');
  });

  it.each(SPEEDS)('%s 배속을 누르면 그 배속을 알린다', (speed) => {
    const { onSpeed } = renderTimeline();
    fireEvent.click(speedButton(`${speed}×`));
    expect(onSpeed).toHaveBeenCalledTimes(1);
    expect(onSpeed).toHaveBeenCalledWith(speed);
  });
});

describe('타임라인: 이벤트 표시', () => {
  const first = event();
  const second = event({
    eventId: 'e-2',
    ruleId: 'R5',
    severity: 'CAUTION',
    worldIds: ['w-0012'],
    zoneId: 'z-02',
    raisedAt: at(10, 45),
  });

  it('이벤트마다 시각·규칙 이름이 이름인 버튼이 타임라인 안에 있다', () => {
    renderTimeline({ events: [first, second] });
    const markers = within(region()).getAllByRole('button', { name: /^이벤트 / });
    expect(markers.map((m) => m.getAttribute('aria-label'))).toEqual([
      '이벤트 10:20:05 추락 위험(가장자리)',
      '이벤트 10:45:00 위험구역 접근',
    ]);
  });

  it('이벤트 표시를 누르면 그 이벤트를 알린다', () => {
    const { onJump, onSeek } = renderTimeline({ events: [first, second] });
    fireEvent.click(screen.getByRole('button', { name: '이벤트 10:45:00 위험구역 접근' }));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(second);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('이벤트 표시는 발생 시각의 자리에 있다(구간 밖이면 가장자리에 붙는다)', () => {
    renderTimeline({ events: [second, event({ eventId: 'e-0', raisedAt: at(9, 50) })] });
    const left = (name: RegExp) =>
      parseFloat(screen.getByRole('button', { name }).style.left.replace('%', ''));
    expect(left(/10:45:00/)).toBeCloseTo(50, 5); // 90분 중 45분
    expect(left(/09:50:00/)).toBe(0);
  });

  it.each([
    ['CRITICAL', 'bg-sev-critical'],
    ['HIGH', 'bg-sev-high'],
    ['CAUTION', 'bg-sev-caution'],
    ['INFO', 'bg-muted-foreground'],
  ] as const)('%s 이벤트 표시는 등급색(%s)이다', (severity, tone) => {
    renderTimeline({ events: [event({ severity })] });
    const mark = screen.getByRole('button', { name: /^이벤트 / }).querySelector('span')!;
    expect(mark.classList.contains(tone)).toBe(true);
  });

  it('이벤트가 없으면 이벤트 버튼이 없다', () => {
    renderTimeline({ events: [] });
    expect(screen.queryAllByRole('button', { name: /^이벤트 / })).toHaveLength(0);
  });
});

describe('타임라인: 데이터 없음', () => {
  it('서버가 준 기록 없는 구간마다 줄무늬 칸이 있고 이름은 그 시간대다', () => {
    renderTimeline({
      gaps: [
        { from: at(10, 36), to: at(10, 38) },
        { from: at(11, 0), to: at(11, 5) },
      ],
    });
    const gaps = within(region()).getAllByRole('img', { name: /^데이터 없음 / });
    expect(gaps.map((g) => g.getAttribute('aria-label'))).toEqual([
      '데이터 없음 10:36–10:38',
      '데이터 없음 11:00–11:05',
    ]);
    // 줄무늬로 그려 진행 막대처럼 채우지 않는다(보간하지 않는다).
    for (const gap of gaps) expect(gap.classList.contains('bg-stripes')).toBe(true);
    expect(parseFloat(gaps[0]!.style.left)).toBeCloseTo(40, 5); // 90분 중 36분
  });

  it('구간 밖으로 걸친 기록 없는 구간은 작업 구간 안으로 잘라 그린다', () => {
    renderTimeline({ gaps: [{ from: at(9, 0), to: at(18, 0) }] });
    const gap = screen.getByRole('img', { name: '데이터 없음 09:00–18:00' });
    expect(gap.style.left).toBe('0%');
    expect(gap.style.width).toBe('calc(100%)');
  });

  it('기록 없는 구간이 없으면 칸이 없다', () => {
    renderTimeline({ gaps: [] });
    expect(screen.queryAllByRole('img', { name: /데이터 없음/ })).toHaveLength(0);
  });

  it('지금이 데이터 없음이면 시각 아래에 글로 알린다', () => {
    renderTimeline({ noData: true });
    expect(within(region()).getByText('데이터 없음')).toBeTruthy();
  });

  it('지금이 데이터 없음이 아니면 글이 없다(기록 없는 구간 칸의 이름은 글이 아니다)', () => {
    renderTimeline({ noData: false, gaps: [{ from: at(10, 36), to: at(10, 38) }] });
    expect(within(region()).queryByText('데이터 없음')).toBeNull();
    expect(screen.getByRole('img', { name: '데이터 없음 10:36–10:38' })).toBeTruthy();
  });
});

describe('타임라인: 쓸 수 없는 상태', () => {
  it('disabled 이면 재생·슬라이더·배속·이벤트 표시를 누를 수 없다', () => {
    const handlers = renderTimeline({ disabled: true, events: [event()] });
    const play = screen.getByRole('button', { name: '재생' }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(slider().disabled).toBe(true);
    for (const speed of SPEEDS)
      expect((speedButton(`${speed}×`) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /^이벤트 / }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(play);
    fireEvent.click(screen.getByRole('button', { name: /^이벤트 / }));
    fireEvent.click(speedButton('2×'));
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('disabled 이면 데이터 없음 글을 쓰지 않는다(기록이 없어 쓸 수 없는 것이지 끊긴 것이 아니다)', () => {
    renderTimeline({ disabled: true, noData: true });
    expect(within(region()).queryByText('데이터 없음')).toBeNull();
  });

  it('disabled 가 아니면 누를 수 있다', () => {
    renderTimeline({ events: [event()] });
    expect((screen.getByRole('button', { name: '재생' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(slider().disabled).toBe(false);
    expect((screen.getByRole('button', { name: /^이벤트 / }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
