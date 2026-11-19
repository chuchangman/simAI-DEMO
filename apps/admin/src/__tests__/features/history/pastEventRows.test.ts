import { isRowActiveAt, pastEventRows } from '@/features/history/pastEventRows';
import type { EventRow } from '@/features/history/replayIndex';
import { describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;
const row = (change: Partial<EventRow>): EventRow => ({
  eventId: 'e-1',
  ruleId: 'R7',
  severity: 'HIGH',
  worldIds: [],
  zoneId: 'z-1',
  raisedAt: T,
  resolvedAt: null,
  ...change,
});

describe('pastEventRows (관제 카드와 같은 묶음 함수, S15P31A101-751)', () => {
  it('같은 위험·구역의 트랙 번호가 바뀐 경보는 60초 안이면 한 줄이고 발생 수를 더한다', () => {
    const rows = pastEventRows([
      row({ eventId: 'a', worldIds: ['w-1'], resolvedAt: T + 10_000 }),
      row({ eventId: 'b', worldIds: ['w-2'], raisedAt: T + 30_000, resumeCount: 2 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurrences).toBe(4);
    expect(rows[0]!.people).toEqual(['w-1', 'w-2']);
    expect(rows[0]!.first.eventId).toBe('a');
  });

  it('간격이 길어도 같은 사람이면 한 줄이고, 다른 위험·구역·간격은 따로다', () => {
    const groups = pastEventRows([
      row({ eventId: 'a', worldIds: ['w-1'] }),
      row({ eventId: 'b', worldIds: ['w-1'], raisedAt: T + 3_600_000 }),
      row({ eventId: 'c', worldIds: ['w-2'], raisedAt: T + 7_200_000 }),
      row({ eventId: 'd', worldIds: ['w-1'], ruleId: 'R2' }),
      row({ eventId: 'e', worldIds: ['w-1'], zoneId: 'z-2' }),
    ]).map((r) => r.members.map((m) => m.eventId));
    expect(groups).toHaveLength(4);
    expect(groups).toContainEqual(['a', 'b']);
    expect(groups).toContainEqual(['c']);
  });

  it('줄의 등급은 든 경보 중 가장 높은 등급이고, 재생 시각에 하나라도 활성이면 활성이다', () => {
    const [only] = pastEventRows([
      row({ eventId: 'a', severity: 'HIGH', resolvedAt: T + 5_000 }),
      row({ eventId: 'b', severity: 'CRITICAL', raisedAt: T + 20_000 }),
    ]);
    expect(only!.severity).toBe('CRITICAL');
    expect(isRowActiveAt(only!, T + 1_000)).toBe(true);
    expect(isRowActiveAt(only!, T + 10_000)).toBe(false);
    expect(isRowActiveAt(only!, T + 25_000)).toBe(true);
  });
});
