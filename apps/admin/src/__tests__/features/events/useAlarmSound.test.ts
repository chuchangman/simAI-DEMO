import { createAlarmPolicy } from '@/features/events/alarmPolicy';
import { AlarmSoundLoop } from '@/features/events/AlarmSoundLoop';
import { useEventClearStore } from '@/features/events/eventClear.store';
import { mergeEvent, type EventEntry } from '@/features/events/events';
import type { EventItem } from '@/features/events/types';
import { ringingSeverity, useAlarmSound } from '@/features/events/useAlarmSound';
import { alarmSound } from '@/lib/alarmSound';
import { useSessionStore } from '@/store/session.store';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const link = vi.hoisted(() => ({ alive: true, canAck: true }));
const live = vi.hoisted(() => ({ entries: [] as EventEntry[] }));
// 소리는 EC2 연결과 상관없이 확인까지 이어진다. 끊김을 흉내 내도 훅이 연결을 보지 않음을 확인한다.
vi.mock('@/hooks/useLinkAlive', () => ({ useLinkAlive: () => link.alive }));
vi.mock('@/features/events/ack', () => ({ useCanAck: () => link.canAck }));
vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: live.entries, loaded: true, failed: false }),
}));

const T = 1_760_342_400_000;

function entry(change: Partial<EventItem> = {}): EventEntry {
  return mergeEvent(undefined, {
    event_id: 'e-1',
    event_sequence: 1,
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'CRITICAL',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-1'],
    zone_id: 'z-04',
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  });
}

const ack = [
  {
    ack_id: 'a-1',
    channel: 'CONTROL_ROOM' as const,
    actor_role: 'ADMIN' as const,
    actor_id: 'admin',
    acked_at: T + 1000,
  },
];

const acked = (change: Partial<EventItem> = {}) =>
  entry({ event_sequence: 2, lifecycle: 'UPDATED', updated_at: T + 1000, acks: ack, ...change });

describe('ringingSeverity', () => {
  it('지금 Tier 0 가 들고 있지 않은 지난 관제 경보는 울리지 않는다(S15P31A101-595)', () => {
    expect(ringingSeverity([entry({ held_by_tier0: false })], true)).toBeNull();
    expect(
      ringingSeverity(
        [
          entry({ held_by_tier0: false }),
          entry({ event_id: 'e-2', severity: 'HIGH', held_by_tier0: true }),
        ],
        true,
      ),
    ).toBe('HIGH');
  });

  it('확인 대기 위험·경고 경보가 없으면 null 이다', () => {
    expect(ringingSeverity([], true)).toBeNull();
  });

  it('확인 대기 경보 중 가장 높은 등급 하나를 고른다', () => {
    const high = entry({ event_id: 'e-h', severity: 'HIGH' });
    const critical = entry({ event_id: 'e-c', severity: 'CRITICAL' });
    expect(ringingSeverity([entry()], true)).toBe('CRITICAL');
    expect(ringingSeverity([high], true)).toBe('HIGH');
    expect(ringingSeverity([high, critical], true)).toBe('CRITICAL');
    expect(ringingSeverity([critical, high], true)).toBe('CRITICAL');
  });

  it('높은 등급을 확인해도 같은 사람의 낮은 경보를 다시 울리지 않는다', () => {
    const high = entry({ event_id: 'e-h', severity: 'HIGH' });
    const criticalAcked = acked({ event_id: 'e-c' });
    expect(ringingSeverity([high, criticalAcked], true)).toBeNull();
    expect(
      ringingSeverity([acked({ event_id: 'e-h', severity: 'HIGH' }), criticalAcked], true),
    ).toBeNull();
  });

  it('주의·안내 등급과 해소된 경보는 소리가 없다', () => {
    expect(ringingSeverity([entry({ severity: 'CAUTION' })], true)).toBeNull();
    expect(ringingSeverity([entry({ severity: 'INFO' })], true)).toBeNull();
    expect(ringingSeverity([entry({ lifecycle: 'RESOLVED', resolved_at: T })], true)).toBeNull();
  });

  it('시험(비 LIVE) 경보는 울리지 않는다', () => {
    expect(ringingSeverity([entry({ source: 'REPLAY' })], true)).toBeNull();
  });

  it('확인 권한이 없는 열람 계정은 끌 수 없으므로 울리지 않는다', () => {
    expect(ringingSeverity([entry()], false)).toBeNull();
  });
});

describe('useAlarmSound', () => {
  beforeEach(() => {
    link.alive = true;
    link.canAck = true;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('가장 높은 등급을 울리고, 확인하면 멈춘다', () => {
    const ring = vi.spyOn(alarmSound, 'ring').mockImplementation(() => undefined);
    const { rerender } = renderHook(({ entries }) => useAlarmSound(entries), {
      initialProps: { entries: [entry()] },
    });
    expect(ring).toHaveBeenLastCalledWith('CRITICAL');

    rerender({ entries: [acked()] });
    expect(ring).toHaveBeenLastCalledWith(null);
  });

  it('등급이 바뀌면 곧바로 새 등급으로 넘기고, 그대로면 다시 부르지 않는다', () => {
    const ring = vi.spyOn(alarmSound, 'ring').mockImplementation(() => undefined);
    const high = entry({ event_id: 'e-h', severity: 'HIGH' });
    const critical = entry({ event_id: 'e-c' });
    const { rerender } = renderHook(({ entries }) => useAlarmSound(entries), {
      initialProps: { entries: [high] },
    });
    expect(ring).toHaveBeenLastCalledWith('HIGH');

    rerender({ entries: [high, critical] });
    expect(ring).toHaveBeenLastCalledWith('CRITICAL');
    const calls = ring.mock.calls.length;
    // 같은 등급인 새 목록은 소리를 다시 시작하지 않는다.
    rerender({ entries: [critical, high] });
    expect(ring.mock.calls.length).toBe(calls);

    rerender({ entries: [high, acked({ event_id: 'e-c' })] });
    expect(ring).toHaveBeenLastCalledWith(null);
  });

  it('연결이 끊겨도 확인(ACK)될 때까지 멈추지 않는다', () => {
    const ring = vi.spyOn(alarmSound, 'ring').mockImplementation(() => undefined);
    const entries = [entry()];
    const { rerender } = renderHook(({ list }) => useAlarmSound(list), {
      initialProps: { list: entries },
    });
    expect(ring).toHaveBeenLastCalledWith('CRITICAL');

    link.alive = false;
    rerender({ list: entries });
    expect(ring).toHaveBeenLastCalledWith('CRITICAL');
    expect(ring).not.toHaveBeenCalledWith(null);

    // 끊긴 화면에서 확인한 것이 얼어 있는 목록에 쓰이면 그때 멈춘다.
    rerender({ list: [acked()] });
    expect(ring).toHaveBeenLastCalledWith(null);
  });

  it('확인 권한이 없는 계정은 울리지 않는다', () => {
    link.canAck = false;
    const ring = vi.spyOn(alarmSound, 'ring').mockImplementation(() => undefined);
    renderHook(() => useAlarmSound([entry()]));
    expect(ring).toHaveBeenLastCalledWith(null);
    expect(ring).not.toHaveBeenCalledWith('CRITICAL');
  });

  it('화면이 사라지면 멈춘다', () => {
    const ring = vi.spyOn(alarmSound, 'ring').mockImplementation(() => undefined);
    const { unmount } = renderHook(() => useAlarmSound([entry()]));
    expect(ring).toHaveBeenLastCalledWith('CRITICAL');
    unmount();
    expect(ring).toHaveBeenLastCalledWith(null);
  });
});

describe('AlarmSoundLoop 모두 지우기', () => {
  beforeEach(() => {
    link.canAck = true;
    live.entries = [entry()];
    useEventClearStore.setState({ clearedAt: null, clearedBy: null });
    useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u', role: 'ADMIN' } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useEventClearStore.setState({ clearedAt: null, clearedBy: null });
    useSessionStore.setState(useSessionStore.getInitialState(), true);
  });

  it('모두 지우면 확인 대기 경보의 소리가 멈춘다', () => {
    const ring = vi.spyOn(alarmSound, 'ring').mockImplementation(() => undefined);
    render(createElement(AlarmSoundLoop));
    expect(ring).toHaveBeenLastCalledWith('CRITICAL');

    act(() => useEventClearStore.getState().clearAll(T));
    expect(ring).toHaveBeenLastCalledWith(null);
  });

  it('지운 뒤에 새로 생긴 경보는 다시 울린다', () => {
    const ring = vi.spyOn(alarmSound, 'ring').mockImplementation(() => undefined);
    const view = render(createElement(AlarmSoundLoop));
    act(() => useEventClearStore.getState().clearAll(T));
    expect(ring).toHaveBeenLastCalledWith(null);

    live.entries = [
      entry(),
      entry({
        event_id: 'e-2',
        severity: 'HIGH',
        world_ids: ['other'],
        raised_at: T + 1_000,
        updated_at: T + 1_000,
      }),
    ];
    view.rerender(createElement(AlarmSoundLoop));
    expect(ring).toHaveBeenLastCalledWith('HIGH');
  });

  it('이미 지운 경보가 있는 채로 열어도 울리지 않는다', () => {
    useEventClearStore.getState().clearAll(T);
    const ring = vi.spyOn(alarmSound, 'ring').mockImplementation(() => undefined);
    render(createElement(AlarmSoundLoop));
    expect(ring).toHaveBeenLastCalledWith(null);
    expect(ring).not.toHaveBeenCalledWith('CRITICAL');
  });
});

describe('소리 사다리 정책', () => {
  it('R3는 1회이며 같은 사람의 같거나 낮은 등급은 억제하고 상향은 알린다', () => {
    const decide = createAlarmPolicy();
    const r3 = entry({ rule_id: 'R3', severity: 'HIGH' });
    expect(decide([r3], true)).toMatchObject({ severity: 'HIGH', once: true });
    const lower = entry({ event_id: 'e-2', severity: 'HIGH' });
    expect(decide([r3, lower], true)?.once).toBe(true);
    const critical = entry({ event_id: 'e-3', raised_at: T + 2000 });
    expect(decide([r3, lower, critical], true)).toMatchObject({
      severity: 'CRITICAL',
      once: false,
    });
    expect(
      decide(
        [
          r3,
          lower,
          acked({
            event_id: 'e-3',
            raised_at: T + 2000,
            updated_at: T + 3000,
            acks: [{ ...ack[0]!, acked_at: T + 3000 }],
          }),
        ],
        true,
      ),
    ).toBeNull();
  });

  it('ACK 30초 안의 같은 사람·구역 재발생만 억제하며 상향과 30초 경계는 울린다', () => {
    const decide = createAlarmPolicy();
    const resolved = acked({ severity: 'HIGH', lifecycle: 'RESOLVED', resolved_at: T + 2000 });
    expect(decide([resolved], true)).toBeNull();
    const again = (at: number, change: Partial<EventItem> = {}) =>
      entry({ event_id: 'again', severity: 'HIGH', raised_at: at, updated_at: at, ...change });
    expect(decide([resolved, again(T + 30_999)], true)).toBeNull();
    expect(decide([resolved, again(T + 30_999, { severity: 'CRITICAL' })], true)?.severity).toBe(
      'CRITICAL',
    );
    const other = createAlarmPolicy();
    expect(other([resolved, again(T + 2000, { zone_id: 'else' })], true)?.severity).toBe('HIGH');
    const boundary = createAlarmPolicy();
    expect(boundary([resolved, again(T + 31_000)], true)?.severity).toBe('HIGH');
  });

  it('같은 사람·구역·규칙은 소리 낸 뒤 60초 동안 화면만, 상향·다른 규칙·위험(CRITICAL)은 울린다', () => {
    const decide = createAlarmPolicy();
    const first = entry({
      event_id: 'c-1',
      rule_id: 'R1',
      severity: 'HIGH',
      raised_at: T,
      updated_at: T,
    });
    expect(decide([first], true)?.severity).toBe('HIGH');
    const gone = {
      ...first,
      event: { ...first.event, lifecycle: 'RESOLVED' as const, resolved_at: T + 1000 },
    };
    const again = (id: string, at: number, change: Partial<EventItem> = {}) =>
      entry({
        event_id: id,
        rule_id: 'R1',
        severity: 'HIGH',
        raised_at: at,
        updated_at: at,
        ...change,
      });
    expect(decide([gone, again('c-2', T + 59_999)], true)).toBeNull();
    expect(decide([gone, again('c-3', T + 59_999, { rule_id: 'R3' })], true)?.severity).toBe(
      'HIGH',
    );
    expect(decide([gone, again('c-4', T + 60_000)], true)?.severity).toBe('HIGH');

    const critical = createAlarmPolicy();
    const c1 = entry({
      event_id: 'k-1',
      rule_id: 'R2',
      severity: 'CRITICAL',
      raised_at: T,
      updated_at: T,
    });
    expect(critical([c1], true)?.severity).toBe('CRITICAL');
    const c1Gone = {
      ...c1,
      event: { ...c1.event, lifecycle: 'RESOLVED' as const, resolved_at: T + 1000 },
    };
    const c2 = entry({
      event_id: 'k-2',
      rule_id: 'R2',
      severity: 'CRITICAL',
      raised_at: T + 2000,
      updated_at: T + 2000,
    });
    expect(critical([c1Gone, c2], true)?.severity).toBe('CRITICAL');
  });

  it('다른 사람은 독립적이며 재개·메트릭 갱신으로 R3 1회 키가 바뀌지 않는다', () => {
    const decide = createAlarmPolicy();
    const r3 = entry({ rule_id: 'R3', severity: 'HIGH' });
    const initial = decide([r3], true);
    const updated = mergeEvent(r3, { ...r3.event, event_sequence: 2, updated_at: T + 1000 });
    expect(decide([updated], true)?.key).toBe(initial?.key);
    expect(decide([r3, entry({ event_id: 'else', world_ids: ['other'] })], true)?.severity).toBe(
      'CRITICAL',
    );
    expect(createAlarmPolicy()([entry({ source: 'REPLAY' })], true)).toBeNull();
  });
});
