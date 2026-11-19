import {
  createSpatialDataStore,
  selectActiveEvents,
  selectTracks,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataProvider, useSpatialData } from '@/features/viewer3d/data/SpatialDataProvider';
import { eventTargetsTrack, trackPlacement } from '@/features/viewer3d/data/spatialFrame';
import { createExternalSource } from '@/features/viewer3d/data/spatialSource';
import {
  DEMO_ZONES_RESPONSE,
  scenarioTick,
  scenarioWorld,
  TICK_MS,
} from '@/features/viewer3d/dev-harness/scenarios';
import { ViewerShell } from '@/features/viewer3d/ViewerShell';
import { worldBoxToThree, worldToThree } from '@/features/viewer3d/worldCoordinates';
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T0 = 1_760_342_400_000;

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('Viewer 데이터 입력 접점', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('StrictMode 에서도 구독은 하나이고, Source 를 바꾸면 데이터만 비우고 Canvas 는 그대로다', () => {
    const store = createSpatialDataStore();
    const a = createExternalSource('live:a');
    const b = createExternalSource('live:b');
    const view = (source: typeof a | null) => (
      <StrictMode>
        <ViewerShell source={source} dataStore={store} initialMode="PLANNED" />
      </StrictMode>
    );
    const { container, rerender, unmount } = render(view(a));
    const canvas = container.querySelector('canvas');
    expect(a.subscriberCount).toBe(1);

    act(() => {
      a.setConnection('OPEN');
      a.push(scenarioWorld('normal', 1, T0));
    });
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + TICK_MS);
    expect(store.getState().connection?.state).toBe('OPEN');

    rerender(view(b));
    expect([a.subscriberCount, b.subscriberCount]).toEqual([0, 1]);
    expect(store.getState().sourceId).toBe('live:b');
    expect(store.getState().world).toBeNull();
    expect(container.querySelector('canvas')).toBe(canvas);
    // 업무 모드는 데이터 입력과 무관하다.
    expect(container.querySelector('[data-viewer-mode]')!.getAttribute('data-viewer-mode')).toBe(
      'PLANNED',
    );

    // 해제 뒤 늦게 오는 이전 Source 의 메시지는 반영하지 않는다.
    act(() => a.push(scenarioWorld('normal', 9, T0)));
    expect(store.getState().world).toBeNull();

    rerender(view(null));
    expect(b.subscriberCount).toBe(0);
    expect(store.getState().sourceId).toBeNull();
    unmount();
  });

  it('같은 id 의 Source 로 다시 구독하면 받은 데이터를 지우지 않는다', () => {
    const store = createSpatialDataStore();
    const first = createExternalSource('live:same');
    const { rerender } = render(<ViewerShell source={first} dataStore={store} />);
    act(() => first.push(scenarioWorld('normal', 2, T0)));
    rerender(<ViewerShell source={createExternalSource('live:same')} dataStore={store} />);
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 2 * TICK_MS);
  });
});

// ---- 후속 렌더러(-44 사람·-47 구역·-185 강조)가 Provider 를 쓰는 예 ----
// 실제 3D 레이어는 각 티켓이 만든다. 여기서는 같은 API 로 Three 배치 값과 강조 대상을 얻을 수 있는지만 본다.

function PeopleProbe() {
  const tracks = useSpatialData(selectTracks);
  // 이벤트 Map 은 바뀔 때만 새 객체다. 출처 거르기는 렌더 안에서 한다.
  const events = useSpatialData((s) => s.events);
  const active = selectActiveEvents({ events } as Parameters<typeof selectActiveEvents>[0], 'LIVE');
  return (
    <ul>
      {tracks.map((track) => {
        const placement = trackPlacement(track);
        // World → Three 는 장면에 놓을 때 한 번만.
        const three = placement.basis === 'XY_ONLY' ? null : worldToThree(placement.world);
        const alarm = active.some((e) => eventTargetsTrack(e, track));
        return (
          <li
            key={track.worldId}
            data-id={track.worldId}
            data-state={track.observationState}
            data-basis={placement.basis}
            data-three={three ? three.join(',') : ''}
            data-alarm={alarm ? '1' : '0'}
          />
        );
      })}
    </ul>
  );
}

function ZonesProbe() {
  const zones = useSpatialData((s) => s.zones);
  return (
    <ol data-status={zones.status}>
      {zones.zones.map((zone) => (
        <li
          key={zone.zoneId}
          data-id={zone.zoneId}
          data-three={JSON.stringify(worldBoxToThree(zone.min, zone.max))}
        />
      ))}
    </ol>
  );
}

describe('Provider 소비 예', () => {
  afterEach(cleanup);

  it('사람 배치·관측 상태·이벤트 강조 대상과 구역 상자를 같은 API 로 얻는다', () => {
    const store = createSpatialDataStore();
    const source = createExternalSource('live:consumer');
    const { container } = render(
      <SpatialDataProvider store={store} source={source}>
        <PeopleProbe />
        <ZonesProbe />
      </SpatialDataProvider>,
    );
    act(() => {
      source.pushZones({ ok: true, raw: DEMO_ZONES_RESPONSE });
      for (let tick = 0; tick <= 31; tick++) {
        for (const out of scenarioTick('risk-lifecycle', tick, T0)) {
          if (out.type === 'message') source.push(JSON.parse(JSON.stringify(out.raw)));
        }
      }
    });
    const people = [...container.querySelectorAll('ul li')].map((li) => ({
      id: li.getAttribute('data-id'),
      basis: li.getAttribute('data-basis'),
      alarm: li.getAttribute('data-alarm'),
      three: li.getAttribute('data-three'),
    }));
    expect(people.map((p) => [p.id, p.basis, p.alarm])).toEqual([
      ['w-0001', 'GROUND_ANCHOR', '1'],
      ['w-0002', 'GROUND_ANCHOR', '1'],
      ['w-0003', 'GROUND_ANCHOR', '0'],
    ]);
    // World (x, y, 0) → Three (x, 0, -y).
    const [x, y] = (
      scenarioWorld('risk-lifecycle', 31, T0).payload.tracks[0] as { position_xy: number[] }
    ).position_xy;
    expect(people[0]!.three).toBe(`${x},0,${-y!}`);

    const zones = container.querySelector('ol')!;
    expect(zones.getAttribute('data-status')).toBe('READY');
    // 공중 구역 z-03(Z 1.2~2.4)은 바닥에 붙이지 않는다: 중심 Three Y = 1.8.
    const z3 = JSON.parse(zones.querySelector('[data-id="z-03"]')!.getAttribute('data-three')!);
    expect(z3.position[1]).toBeCloseTo(1.8, 9);
    expect(z3.size[1]).toBeCloseTo(1.2, 9);
  });
});
