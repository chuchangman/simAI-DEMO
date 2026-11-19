import type { ZonesResult } from '@/features/viewer3d/data/spatialSource';
import { readZoneApply, withZoneApply } from '@/features/viewer3d/dev-harness/harnessSource';
import { createMockSource, NOT_JSON_REASON } from '@/features/viewer3d/dev-harness/mockSource';
import { displayName, LEGACY_ROSTER } from '@/features/viewer3d/dev-harness/mockUi';
import { createSpatialMockApi } from '@/features/viewer3d/dev-harness/mswHandlers';
import { DEMO_ZONES_RESPONSE } from '@/features/viewer3d/dev-harness/scenarios';
import { afterEach, describe, expect, it, vi } from 'vitest';

const T0 = 1_760_342_400_000;

describe('개발 화면 구역 표시 주소', () => {
  it.each([
    ['', 'UNVERIFIED'],
    ['?zones=preview', 'DEMO_PREVIEW'],
    ['?zones=APPLIED', 'DEMO_ASSUMED_APPLIED'],
    ['?zones=active', 'UNVERIFIED'],
  ])('%s → %s', (search, state) => {
    expect(readZoneApply(search)).toBe(state);
  });

  it('바꾼 주소는 다른 매개변수를 두고 기본값이면 zones 를 지운다', () => {
    const base = 'http://127.0.0.1:5179/x/index.html?view=combined&source=normal';
    expect(withZoneApply(base, 'DEMO_PREVIEW')).toBe(`${base}&zones=preview`);
    expect(withZoneApply(`${base}&zones=preview`, 'UNVERIFIED')).toBe(base);
  });

  it('레거시 구역은 이름에 레거시를 밝히고, Provider 구역은 ID 로 부른다', () => {
    expect(LEGACY_ROSTER.zones.every((z) => z.legacy && z.name.includes('레거시'))).toBe(true);
    expect(displayName({ type: 'zone', id: 'zoneA' })).toBe('레거시 예시 구역 A');
    expect(displayName({ type: 'zone', id: 'z-01' })).toBe('구역 z-01');
  });
});

describe('MockSource 구역 REST', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const html = () =>
    new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } });

  function start(responses: (() => Response)[], maxTicks?: number) {
    const queue = [...responses];
    const calls: string[] = [];
    // 재활성 순서를 요청 기록에 함께 남겨 "다시 켠 뒤 다시 묻는다"를 확인한다.
    const reactivateMocks = vi.fn(async () => {
      calls.push('reactivate');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('/api/zones')) return queue.shift()!();
        return new Response(null, { status: 404 });
      }),
    );
    const zones: ZonesResult[] = [];
    const source = createMockSource({
      scenario: 'normal',
      t0: T0,
      restBase: '',
      now: () => T0,
      reactivateMocks,
      maxTicks,
    });
    const off = source.subscribe({
      onMessage: () => {},
      onConnectionChange: () => {},
      onZones: (result) => zones.push(result),
    });
    source.pause();
    return {
      source,
      zones,
      reactivateMocks,
      calls: () => calls.filter((u) => u.includes('/api/zones') || u === 'reactivate'),
      off,
    };
  }

  it('HTML 응답(MSW 미응답)은 JSON 으로 읽지 않고 Mock 을 다시 켠 뒤 다시 묻는다(R28)', async () => {
    vi.useFakeTimers();
    const run = start([html, html, () => Response.json(DEMO_ZONES_RESPONSE)]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.calls()).toEqual([
      '/api/zones',
      'reactivate',
      '/api/zones',
      'reactivate',
      '/api/zones',
    ]);
    expect(run.zones).toEqual([{ ok: true, raw: DEMO_ZONES_RESPONSE }]);
    run.off();
  });

  it('다시 켜도 계속 HTML 이면 이유를 남기고 거부한다(성공으로 꾸미지 않는다)', async () => {
    vi.useFakeTimers();
    const run = start(Array.from({ length: 5 }, () => html));
    await vi.advanceTimersByTimeAsync(5000);
    expect(run.calls().filter((c) => c === '/api/zones')).toHaveLength(4);
    expect(run.reactivateMocks).toHaveBeenCalledTimes(3);
    expect(run.zones).toEqual([{ ok: false, reason: NOT_JSON_REASON }]);
    run.off();
  });

  it('HTTP 503 은 Mock 을 다시 켜지 않고 그대로 알린다', async () => {
    vi.useFakeTimers();
    const run = start([() => Response.json({ message: 'x' }, { status: 503 })]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run.calls()).toHaveLength(1);
    expect(run.reactivateMocks).not.toHaveBeenCalled();
    expect(run.zones).toEqual([{ ok: false, reason: 'HTTP 503' }]);
    run.off();
  });

  it('구독이 풀리면 다시 묻지 않고, 늦게 끝난 응답도 전하지 않는다(이전 Source 경쟁)', async () => {
    vi.useFakeTimers();
    const run = start(Array.from({ length: 5 }, () => html));
    await vi.advanceTimersByTimeAsync(0);
    run.off();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run.calls().filter((c) => c === '/api/zones')).toHaveLength(1);
    expect(run.zones).toEqual([]);
  });

  it('재생 상한에 이르면 멈추고 capped 를 알린다', () => {
    const run = start([() => Response.json(DEMO_ZONES_RESPONSE)], 3);
    run.source.step(5);
    expect([run.source.tick, run.source.capped, run.source.halted]).toEqual([3, true, true]);
    run.off();
  });
});

describe('Spatial Mock 재활성', () => {
  it('동시에 여러 번 불러도 한 번만 다시 켜고 횟수를 센다', async () => {
    const api = createSpatialMockApi({ scenario: 'normal', t0: T0 });
    await api.reactivate(); // 수단이 없으면 아무것도 하지 않는다.
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    api.setReactivator(fn);
    const all = Promise.all([api.reactivate(), api.reactivate(), api.reactivate()]);
    release();
    await all;
    expect([fn.mock.calls.length, api.reactivations]).toEqual([1, 1]);
    api.setReactivator(async () => {});
    await api.reactivate();
    expect(api.reactivations).toBe(2);
  });
});
