import type { WatchBinding } from '@/features/watch/api';
import {
  linkKeyOf,
  watchBadges,
  watchesOfLinkKey,
  watchRows,
  type HealthWatches,
} from '@/features/watch/watchStatus';
import { describe, expect, it } from 'vitest';

const binding = (
  device: string,
  world: string,
  state: 'BOUND' | 'LOST' = 'BOUND',
): WatchBinding => ({
  binding_id: 1,
  device_id: device,
  world_id: world,
  method: 'MANUAL',
  bound_at: 0,
  channel_state: state,
});

const health = (
  items: { id: string; link: 'CONNECTED' | 'LOST'; battery: number | null }[],
): HealthWatches => ({
  registered: items.length,
  connected: items.filter((i) => i.link === 'CONNECTED').length,
  items: items.map((i) => ({
    device_id: i.id,
    link: i.link,
    last_heartbeat_at: 0,
    battery_pct: i.battery,
    transport: i.link === 'CONNECTED' ? 'WIFI' : null,
  })),
});

describe('워치 상태(-342)', () => {
  it('health 의 연결과 REST 배정을 기기마다 합치고 health 에 없는 배정도 보인다', () => {
    const rows = watchRows(
      health([
        { id: 'watch-02', link: 'LOST', battery: null },
        { id: 'watch-01', link: 'CONNECTED', battery: 80 },
      ]),
      [binding('watch-01', 'w-17'), binding('watch-09', 'w-3', 'LOST')],
    );
    expect(rows.map((r) => [r.deviceId, r.connected, r.worldId])).toEqual([
      ['watch-01', true, 'w-17'],
      ['watch-02', false, null],
      ['watch-09', false, 'w-3'],
    ]);
  });

  it('연결 문자열은 배터리·시각이 바뀌어도 같고 되돌려 이름표를 만들 수 있다', () => {
    const a = health([
      { id: 'watch-02', link: 'LOST', battery: 10 },
      { id: 'watch-01', link: 'CONNECTED', battery: 80 },
    ]);
    const b = health([
      { id: 'watch-01', link: 'CONNECTED', battery: 79 },
      { id: 'watch-02', link: 'LOST', battery: null },
    ]);
    expect(linkKeyOf(a)).toBe('watch-01=CONNECTED|watch-02=LOST');
    expect(linkKeyOf(b)).toBe(linkKeyOf(a));
    expect(linkKeyOf(undefined)).toBe('');
    expect(watchesOfLinkKey('')).toBeUndefined();
    expect(
      watchBadges(watchRows(watchesOfLinkKey(linkKeyOf(a)), [binding('watch-02', 'w-9')])),
    ).toEqual({
      'w-9': '워치 끊김 watch-02',
    });
  });

  it('이름표 글은 배정된 사람만, 끊기면 끊김을 적고 미착용으로 단정하지 않는다', () => {
    const rows = watchRows(health([{ id: 'watch-01', link: 'LOST', battery: 40 }]), [
      binding('watch-01', 'w-17'),
    ]);
    expect(watchBadges(rows)).toEqual({ 'w-17': '워치 끊김 watch-01' });
    const connected = watchRows(health([{ id: 'watch-01', link: 'CONNECTED', battery: 40 }]), [
      binding('watch-01', 'w-17'),
    ]);
    expect(watchBadges(connected)).toEqual({ 'w-17': '워치 watch-01' });
    expect(watchBadges(watchRows(undefined, []))).toEqual({});
    expect(JSON.stringify(watchBadges(rows))).not.toContain('미착용');
  });
});
