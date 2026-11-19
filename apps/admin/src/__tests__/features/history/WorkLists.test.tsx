import { EventLog } from '@/features/history/WorkLists';
import type { EventRow } from '@/features/history/replayIndex';
import { ZONES_KEY } from '@/features/zones/api';
import { MOCK_ZONES } from '@/mocks/zones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

const row = (change: Partial<EventRow>): EventRow => ({
  eventId: 'e-1',
  ruleId: 'R2',
  severity: 'HIGH',
  worldIds: [],
  zoneId: null,
  raisedAt: 1_760_342_400_000,
  resolvedAt: null,
  ...change,
});

function renderLog(events: EventRow[]) {
  const client = new QueryClient();
  client.setQueryData(ZONES_KEY, MOCK_ZONES);
  render(
    <QueryClientProvider client={client}>
      <EventLog events={events} playhead={null} onPick={vi.fn()} />
    </QueryClientProvider>,
  );
  const button = within(screen.getByRole('list', { name: '이벤트 로그' })).getByRole('button');
  return button.lastElementChild!.textContent;
}

afterEach(cleanup);

const T = 1_760_342_400_000;

function renderRows(events: EventRow[]) {
  const client = new QueryClient();
  client.setQueryData(ZONES_KEY, MOCK_ZONES);
  render(
    <QueryClientProvider client={client}>
      <EventLog events={events} playhead={null} onPick={vi.fn()} />
    </QueryClientProvider>,
  );
  return within(screen.getByRole('list', { name: '이벤트 로그' })).queryAllByRole('button');
}

describe('이벤트 로그의 묶음(S15P31A101-751)', () => {
  it('같은 초에 트랙 번호만 다른 같은 위험·구역은 「×n」 한 줄이고, 원래 ID 는 hover 로 보인다', () => {
    const buttons = renderRows([
      row({
        eventId: 'a',
        ruleId: 'R7',
        worldIds: ['w-mwhubgp0-0010'],
        zoneId: 'z-04',
        raisedAt: T,
      }),
      row({
        eventId: 'b',
        ruleId: 'R7',
        worldIds: ['w-mwhubgp0-0011'],
        zoneId: 'z-04',
        raisedAt: T,
      }),
      row({
        eventId: 'c',
        ruleId: 'R7',
        worldIds: ['w-mwhubgp0-0012'],
        zoneId: 'z-04',
        raisedAt: T,
      }),
      row({
        eventId: 'd',
        ruleId: 'R7',
        worldIds: ['w-mwhubgp0-0013'],
        zoneId: 'z-04',
        raisedAt: T,
      }),
    ]);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toContain('×4');
    expect(buttons[0]!.textContent).toContain('작업자 #0010 외 3명');
    expect(buttons[0]!.textContent).not.toContain('w-mwhubgp0');
    expect(buttons[0]!.querySelector('[title*="w-mwhubgp0-0010"]')).not.toBeNull();
    expect(screen.getByTitle(/관제 카드와 같은 기준으로 묶은 사건 수/).textContent).toBe(
      '사건 1 (경보 4)',
    );
  });

  it('위험이나 구역이 다르거나 간격이 길면 따로 둔다', () => {
    const buttons = renderRows([
      row({ eventId: 'a', ruleId: 'R7', worldIds: ['w-0001'], zoneId: 'z-04', raisedAt: T }),
      row({ eventId: 'b', ruleId: 'R2', worldIds: ['w-0002'], zoneId: 'z-04', raisedAt: T }),
      row({ eventId: 'c', ruleId: 'R7', worldIds: ['w-0003'], zoneId: 'z-05', raisedAt: T }),
      row({
        eventId: 'd',
        ruleId: 'R7',
        worldIds: ['w-0004'],
        zoneId: 'z-04',
        raisedAt: T + 600_000,
      }),
    ]);
    expect(buttons).toHaveLength(4);
  });
});

describe('이벤트 로그의 대상', () => {
  it('작업자 뒤에 구역 이름을 붙이고, 이름을 모르는 구역은 뺀다(구역 번호는 보이지 않는다)', () => {
    expect(renderLog([row({ worldIds: ['w-0015'], zoneId: 'z-04' })])).toBe(
      '작업자 #0015 · 개구부 구역',
    );
    cleanup();

    expect(renderLog([row({ worldIds: ['w-0015'], zoneId: 'z-99' })])).toBe('작업자 #0015');
  });

  it('작업자가 없으면 구역이 대상이라 이름을 모르면 `구역` 이다', () => {
    expect(renderLog([row({ zoneId: 'z-04' })])).toBe('개구부 구역');
    cleanup();

    expect(renderLog([row({ zoneId: 'z-99' })])).toBe('구역');
  });
});
