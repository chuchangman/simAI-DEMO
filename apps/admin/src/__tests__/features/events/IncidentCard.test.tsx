import { ANY_CAMERA, useCamSplitStore } from '@/features/cctv/camSplit.store';
import { groupIncidents, mergeEvent, type EventEntry } from '@/features/events/events';
import { IncidentCard } from '@/features/events/IncidentCard';
import type { EventItem } from '@/features/events/types';
import { ZONES_KEY } from '@/features/zones/api';
import { MOCK_ZONES } from '@/mocks/zones';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import type { WorldStatePayload } from '@simai/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T = 1_760_342_400_000;

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

function item(change: Partial<EventItem> = {}): EventItem {
  return {
    event_id: 'e-1',
    event_sequence: 1,
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'CRITICAL',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-0015'],
    zone_id: 'z-04',
    metrics: { edge_distance_m: 0.82, height_diff_m: 2.1 },
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  };
}

const entry = (change: Partial<EventItem> = {}): EventEntry => mergeEvent(undefined, item(change));

function renderCard(
  entries: EventEntry[],
  props: Partial<React.ComponentProps<typeof IncidentCard>> = {},
) {
  const incident = groupIncidents(entries)[0]!;
  const onSelect = vi.fn();
  const onOpen = vi.fn();
  const client = new QueryClient();
  client.setQueryData(ZONES_KEY, MOCK_ZONES);
  render(
    <QueryClientProvider client={client}>
      <ul>
        <IncidentCard
          incident={incident}
          selected={false}
          onSelect={onSelect}
          onOpen={onOpen}
          {...props}
        />
      </ul>
    </QueryClientProvider>,
  );
  return { card: screen.getByRole('article'), onSelect, onOpen, incident };
}

beforeEach(() => {
  // 경과는 카드 안의 칸이 시계로 그린다. 발생(T) 12초 뒤로 맞춘다.
  vi.useFakeTimers();
  vi.setSystemTime(T + 12_000);
  navigate.mockReset();
  useCamSplitStore.getState().close();
  useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u', role: 'ADMIN' } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useSessionStore.setState(useSessionStore.getInitialState(), true);
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
});

describe('IncidentCard', () => {
  it('첫 줄은 등급 배지·규칙 이름·구역과 미확인 칩이고, 둘째 줄은 사람 끝번호와 오른쪽 끝의 경과다', () => {
    const { card } = renderCard([entry()]);

    expect(within(card).getByText('위험')).toBeTruthy();
    expect(within(card).getByText('추락 위험(가장자리) · 개구부 구역')).toBeTruthy();
    expect(card.textContent).not.toMatch(/z-\d/);
    const chip = card.querySelector('[data-chip]');
    expect(chip?.getAttribute('data-chip')).toBe('unacked');
    expect(chip?.textContent).toBe('미확인');
    expect(chip?.className).toContain('border-sev-critical');
    // 사람은 끝번호만 보인다(전체 ID 는 올려 보면 나오고 카드 이름에 있다). 등급색 알약·굵은 글씨·고정폭이 아니다.
    const person = within(card).getByText('작업자 #0015');
    expect(card.textContent).not.toContain('w-0015');
    expect(person.getAttribute('title')).toBe('w-0015');
    expect(card.getAttribute('aria-label')).toBe('w-0015 이벤트');
    expect(person.className).toBe('text-sm');
    // 경과는 같은 줄(둘째 줄) 오른쪽 끝에 있다.
    const row = person.parentElement!.parentElement!;
    expect(within(row).getByText('12초 전')).toBeTruthy();
    expect(row.lastElementChild?.textContent).toBe('12초 전');
    expect(within(card).queryByText(/회 발생/)).toBeNull();
  });

  it('지난 관제 카드도 같은 세 줄이고, 지난 관제 칩과 흐린 모양에 등급 테두리·카메라 버튼은 없다', () => {
    const { card } = renderCard([entry({ held_by_tier0: false, severity: 'HIGH' })]);

    expect(card.querySelector('[data-chip]')?.textContent).toBe('지난 관제');
    expect(within(card).getByText('작업자 #0015').className).toBe('text-sm');
    expect(within(card).getByText('12초 전')).toBeTruthy();
    expect(card.className).toContain('opacity-75');
    expect(card.className).not.toContain('ring-sev-high');
    expect(within(card).queryByRole('button', { name: /로 확인/ })).toBeNull();
  });

  it('긴 사람 ID 는 끝번호만 보인다', () => {
    const { card } = renderCard([entry({ world_ids: ['w-mw8y3hai-0722'] })]);

    expect(within(card).getByText('작업자 #0722').getAttribute('title')).toBe('w-mw8y3hai-0722');
    expect(card.textContent).not.toContain('mw8y3hai');
  });

  it('R1 주의 묶음은 규칙 이름을 위험구역 진입으로 보인다', () => {
    const { card } = renderCard([entry({ rule_id: 'R1', severity: 'CAUTION', zone_id: 'z-04' })]);

    expect(within(card).getByText('위험구역 진입 · 개구부 구역')).toBeTruthy();
    expect(card.textContent).not.toContain('위험 구역 근접');
  });

  it('개구부 수치와 나머지 규칙·구역은 카드에 없다(상세에만 있다)', () => {
    const { card } = renderCard([
      entry(),
      entry({ event_id: 'e-2', rule_id: 'R1', severity: 'HIGH', zone_id: 'z-02' }),
    ]);

    expect(card.textContent).not.toContain('0.82');
    expect(card.textContent).not.toContain('높이 차');
    // 대표 규칙(가장 높은 등급)과 그 구역만 보이고 나머지 규칙 이름·구역은 없다.
    expect(within(card).queryByText('위험구역 진입')).toBeNull();
    expect(card.textContent).not.toContain('단상 구역');
    expect(card.textContent).not.toMatch(/z-\d/);
    expect(card.querySelectorAll('li')).toHaveLength(0);
  });

  it('구역이 대상인 카드는 둘째 줄이 구역 이름이고 제목에서 되풀이하지 않는다. 이름을 모르면 `구역`이다', () => {
    const { card } = renderCard([entry({ world_ids: [], zone_id: 'z-04' })]);
    const name = within(card).getByText('개구부 구역');
    expect(name.className).toBe('text-sm');
    expect(name.getAttribute('title')).toBeNull();
    expect(within(card).getByText('추락 위험(가장자리)')).toBeTruthy();
    expect(card.textContent).not.toMatch(/z-\d/);
    cleanup();

    const unknown = renderCard([entry({ world_ids: [], zone_id: 'z-99' })]).card;
    expect(within(unknown).getByText('구역')).toBeTruthy();
    expect(unknown.textContent).not.toContain('z-99');
  });

  it('위험구역 접근만 셋째 줄에 N초 뒤 진입 예상을 보인다', () => {
    const { card } = renderCard([
      entry({
        rule_id: 'R5',
        severity: 'CAUTION',
        metrics: { time_to_entry_s: 1.6 },
        zone_id: 'z-02',
      }),
    ]);

    expect(within(card).getByText('1.6초 뒤 진입 예상')).toBeTruthy();
    // 주의 등급은 확인할 경보가 없어 처리 칩이 없다.
    expect(card.querySelector('[data-chip]')).toBeNull();
  });

  it('안전모 미착용(R9)은 구역 없이 주의 배지와 규칙 이름으로 보이고 처리 칩이 없다', () => {
    // R9 는 사람 단위라 zone_id 가 없다(-519).
    const { card } = renderCard([
      entry({ rule_id: 'R9', severity: 'CAUTION', metrics: {}, zone_id: null }),
    ]);

    expect(within(card).getByText('주의')).toBeTruthy();
    expect(within(card).getByText('안전모 미착용')).toBeTruthy();
    expect(card.textContent).not.toMatch(/구역/);
    expect(card.querySelector('[data-chip]')).toBeNull();
  });

  it('확인하면 확인 시각 칩이다', () => {
    const acked = entry({
      acks: [
        {
          ack_id: 'a-1',
          channel: 'CONTROL_ROOM',
          actor_role: 'ADMIN',
          actor_id: 'admin',
          acked_at: T + 3_000,
        },
      ],
      updated_at: T + 3_000,
    });
    renderCard([acked]);
    expect(screen.getByRole('article').querySelector('[data-chip]')?.textContent).toMatch(
      /^확인 \d{2}:\d{2}:\d{2}$/,
    );
  });

  it('해소된 묶음은 해소 시각 칩만 있고 경과는 없으며, 카드가 흐려진다', () => {
    const { card } = renderCard([
      entry({ lifecycle: 'RESOLVED', resolved_at: T + 5_000, updated_at: T + 5_000 }),
    ]);

    expect(card.querySelector('[data-chip]')?.textContent).toMatch(/^해소 \d{2}:\d{2}:\d{2}$/);
    expect(card.textContent).not.toContain('초 전');
    expect(within(card).getByText('작업자 #0015')).toBeTruthy();
    expect(card.className).toContain('opacity-55');
    expect(card.className).not.toContain('ring-sev-critical');
  });

  it('해소 카드는 두 번 이상 발생했을 때만 N회를 보인다', () => {
    const resolved = entry({
      lifecycle: 'RESOLVED',
      resolved_at: T + 5_000,
      updated_at: T + 5_000,
    });
    const twice = renderCard([resolved], { occurrences: 2 });
    expect(within(twice.card).getByText('2회')).toBeTruthy();
    expect(within(twice.card).getByText('2회').getAttribute('title')).toBe(
      '같은 위험·같은 구역에서 2번 발생했습니다.',
    );
    // 경과가 없는 해소 카드는 둘째 줄 오른쪽 끝에 발생 횟수가 선다.
    expect(within(twice.card).getByText('2회').parentElement?.previousElementSibling).toBe(
      within(twice.card).getByText('작업자 #0015').parentElement,
    );
    cleanup();

    const once = renderCard([resolved], { occurrences: 1 });
    expect(within(once.card).queryByText(/\d회$/)).toBeNull();
  });

  it('트랙 번호가 바뀌며 이어진 경보를 묶은 진행 중 카드는 경과 앞에 N회와 묶은 까닭을 보인다(S15P31A101-731)', () => {
    const { card } = renderCard([entry()], { occurrences: 3, people: 3 });
    const count = within(card).getByText('3회');
    expect(count.getAttribute('title')).toContain(
      '트랙 번호(작업자 번호)가 바뀌며 이어진 경보 3건(번호 3개)',
    );
    expect(count.nextElementSibling?.textContent).toBe('12초 전');
  });

  it('복원 이벤트는 확인 필요와 첫 이유를 꼬리표로 보인다', () => {
    const { card } = renderCard([
      entry({
        verification: 'UNVERIFIABLE',
        needs_check: true,
        confidence_reasons: ['Z_UNKNOWN', 'PREDICTED'],
      }),
    ]);

    // 카드 꼬리표는 "확인 필요"만 적고 이유는 올려 보면 나온다.
    expect(within(card).getByText('확인 필요').getAttribute('title')).toBe('확인 필요 · 높이 모름');
    expect(card.textContent).not.toContain('높이 모름');
    expect(card.textContent).not.toContain('예측 위치');
  });

  it('확인 필요는 운영자가 확인하기 전에만 보인다. 확인하면 확인 시각 칩만 남고 꼬리표는 사라진다', () => {
    const needsCheck = { verification: 'UNVERIFIABLE', needs_check: true } as const;
    const before = renderCard([entry(needsCheck)]).card;
    expect(within(before).getByText('확인 필요')).toBeTruthy();
    cleanup();

    const acked = renderCard([
      entry({
        ...needsCheck,
        acks: [
          {
            ack_id: 'a-1',
            channel: 'CONTROL_ROOM',
            actor_role: 'ADMIN',
            actor_id: 'admin',
            acked_at: T + 3_000,
          },
        ],
        updated_at: T + 3_000,
      }),
    ]).card;
    expect(acked.querySelector('[data-chip]')?.textContent).toMatch(/^확인 \d{2}:\d{2}:\d{2}$/);
    expect(within(acked).queryByText('확인 필요')).toBeNull();
  });

  it('둘째 줄 꼬리표는 사람 번호 옆에 있고, 경과는 맨 오른쪽 끝이다', () => {
    const { card } = renderCard(
      [entry({ delivery: 'DELAYED_ACTIVE', verification: 'UNVERIFIABLE', needs_check: true })],
      { outsideWork: 'OUTSIDE_ZONE' },
    );

    const row = within(card).getByText('작업자 #0015').parentElement!.parentElement!;
    expect(within(row).getByText('확인 필요')).toBeTruthy();
    expect(within(row).getByText('지연 알림')).toBeTruthy();
    expect(within(row).getByText('작업 구역 밖').getAttribute('title')).toBe(
      '작업 중이었지만 그 작업의 구역 밖에서 난 이벤트입니다.',
    );
    expect(row.lastElementChild?.textContent).toBe('12초 전');
  });

  it('지연 알림 꼬리표를 보인다', () => {
    const { card } = renderCard([entry({ delivery: 'DELAYED_ACTIVE' })]);
    expect(within(card).getByText('지연 알림')).toBeTruthy();
  });

  it('머리줄: 처음 누르면 선택, 이미 선택된 카드를 다시 누르면 상세를 연다', () => {
    const first = renderCard([entry()]);
    fireEvent.click(within(first.card).getByRole('button', { pressed: false }));
    expect(first.onSelect).toHaveBeenCalledWith(first.incident);
    expect(first.onOpen).not.toHaveBeenCalled();
    cleanup();

    const second = renderCard([entry()], { selected: true });
    fireEvent.click(within(second.card).getByRole('button', { pressed: true }));
    expect(second.onOpen).toHaveBeenCalledWith('e-1');
    expect(second.onSelect).not.toHaveBeenCalled();
  });

  it('선택되면 카드가 보이는 자리로 스크롤한다', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderCard([entry()], { selected: true });
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('미확인 경보는 왼쪽 가장자리만 깜빡이고, 움직임 줄이기 설정이면 멈춘다', () => {
    const { card } = renderCard([entry()]);
    // 카메라 버튼의 아이콘(svg)도 aria-hidden 이라 className 문자열이 아닌 class 속성으로 가린다.
    const blink = [...card.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].filter((el) =>
      el.getAttribute('class')?.includes('animate-alarm-blink'),
    );
    expect(blink).toHaveLength(1);
    expect(blink[0]!.className).toContain('motion-safe:animate-alarm-blink');
    expect(blink[0]!.className).toContain('w-1');
  });

  it('등급마다 띠 색이 다르고, 깜빡이는 것은 미확인 경보뿐이다', () => {
    const barOf = (card: HTMLElement) =>
      card.querySelector<HTMLElement>('[aria-hidden="true"].w-1')!.className;

    const caution = renderCard([entry({ severity: 'CAUTION' })]);
    expect(barOf(caution.card)).toContain('bg-sev-caution');
    expect(barOf(caution.card)).not.toContain('animate-alarm-blink');
    cleanup();

    const info = renderCard([entry({ severity: 'INFO' })]);
    expect(barOf(info.card)).toContain('bg-faint');
  });

  it('경고는 주황이고, 미확인 칩도 그 묶음의 등급 색을 따른다', () => {
    const { card } = renderCard([entry({ severity: 'HIGH' })]);
    const bar = card.querySelector<HTMLElement>('[aria-hidden="true"].w-1')!.className;
    expect(bar).toContain('bg-sev-high');
    expect(bar).not.toContain('bg-sev-critical');
    expect(card.className).toContain('ring-sev-high');
    const chip = card.querySelector('[data-chip="unacked"]');
    expect(chip?.className).toContain('border-sev-high');
    expect(chip?.className).toContain('text-sev-high');
    expect(chip?.className).not.toContain('sev-critical');
  });

  it('사람을 담은 카메라가 있어도 CCTV 버튼은 이름 없이 오른쪽 카메라 미리보기를 연다', () => {
    useRealtimeStore.setState({
      world: {
        receivedAt: T,
        payload: {
          tracks: [{ world_id: 'w-0015', cameras: ['cam_B', 'cam_A'] }],
        } as unknown as WorldStatePayload,
      },
    });
    const { card } = renderCard([entry()]);

    fireEvent.click(within(card).getByRole('button', { name: 'CCTV로 확인' }));
    // CCTV 화면으로 옮기지 않고 실시간 관제 오른쪽 칸을 연다.
    expect(navigate).not.toHaveBeenCalled();
    expect(useCamSplitStore.getState().split).toEqual({
      cam: ANY_CAMERA,
      target: { type: 'person', id: 'w-0015' },
    });
  });

  it('해소된 묶음에는 카메라 버튼이 없다', () => {
    const { card } = renderCard([entry({ lifecycle: 'RESOLVED', resolved_at: T })]);
    expect(within(card).queryByRole('button', { name: /로 확인/ })).toBeNull();
  });

  it('해석된 사람 표시 이름이 있으면 끝번호 대신 이름을 보이고 동명이인은 끝번호로 구분한다(-658)', () => {
    useRealtimeStore.setState({
      health: {
        receivedAt: T,
        clockOffsetMs: 0,
        payload: {
          person_names: [
            { world_id: 'w-0012', display_name: '김철수', name_source: 'WATCH_DEVICE' },
            { world_id: 'w-0015', display_name: '김철수', name_source: 'WORLD_MANUAL' },
          ],
        } as never,
      },
    });
    const { card } = renderCard([entry({ world_ids: ['w-0015'] })]);
    const person = within(card).getByText('김철수 (0015)');
    expect(person.getAttribute('title')).toBe('김철수 (w-0015)');
    expect(card.getAttribute('aria-label')).toBe('김철수 (w-0015) 이벤트');
  });
});
