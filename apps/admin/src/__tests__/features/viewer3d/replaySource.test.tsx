import {
  createSpatialDataStore,
  selectActiveEvents,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { createExternalSource } from '@/features/viewer3d/data/spatialSource';
import { exampleReplayLog } from '@/features/viewer3d/dev-harness/harnessSource';
import { scenarioWorld, TICK_MS } from '@/features/viewer3d/dev-harness/scenarios';
import { parseReplayLog } from '@/features/viewer3d/replay/replayLog';
import {
  createReplaySource,
  REPLAY_BEFORE_REASON,
  REPLAY_EMPTY_REASON,
  REPLAY_GAP_REASON,
  type ReplaySpatialSource,
} from '@/features/viewer3d/replay/replaySource';
import { riskPresentation, riskStyle } from '@/features/viewer3d/risk/riskPresentation';
import type { ViewerMode } from '@/features/viewer3d/types';
import { ViewerShell } from '@/features/viewer3d/ViewerShell';
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 녹화 재생 Source(-187). Store·위험 강조 계산까지 실제 코드로 잇고, 장면 트리는 replayScene.test 가 본다.
const T0 = 1_760_342_400_100;
const EVENT = '0192a6f0-7c1e-7b3a-9f2d-3c4b5a6d7e90';
const log = exampleReplayLog();

/** 기록에서 그 시각 이하의 마지막 World 원문. 시험이 기대값을 기록에서 바로 읽는다. */
function recordAt(t: number) {
  const entry = [...log.worlds].reverse().find((w) => w.t <= t)!;
  return {
    entry,
    message: JSON.parse(entry.text) as {
      payload: { tracks: { world_id: string; pelvis_xyz: number[] | null }[] };
    },
  };
}

function connect(source: ReplaySpatialSource, store: SpatialDataStore = createSpatialDataStore()) {
  store.getState().reset(source.id);
  const off = source.subscribe({
    onMessage: (raw, at) => store.getState().ingest(raw, at),
    onConnectionChange: (change) => store.getState().setConnection(change),
    onReset: () => store.getState().reset(source.id),
  });
  return { store, off };
}

const risk = (store: SpatialDataStore, mode: ViewerMode) => {
  const s = store.getState();
  return riskPresentation({
    events: s.events.values(),
    tracks: s.world?.tracks ?? [],
    worldSceneVersion: s.world?.sceneVersion ?? null,
    zoneIds: [],
    mode,
    connectionOpen: s.connection?.state === 'OPEN',
  });
};

describe('녹화 재생 Source', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('구독하면 기록 처음 상태를 보내고 연결을 OPEN 으로 알린다', () => {
    const source = createReplaySource(log, { now: () => 5 });
    const { store, off } = connect(source);
    expect(source.kind).toBe('REPLAY');
    expect(store.getState().world?.tLatestGlobal).toBe(T0);
    expect(store.getState().world?.meta.receivedAt).toBe(5);
    expect(store.getState().connection?.state).toBe('OPEN');
    expect(store.getState().events.size).toBe(0);
    expect(source.subscriberCount).toBe(1);
    off();
    expect(source.subscriberCount).toBe(0);
  });

  it('seek 한 시각에는 그 시각 이하의 마지막 기록을 값 그대로 보이고 보간하지 않는다', () => {
    const source = createReplaySource(log);
    const { store } = connect(source);
    for (const t of [T0 + 50, T0 + 1234, T0 + 2900, T0 + 4500, T0 + 5900]) {
      source.seek(t);
      const { entry, message } = recordAt(t);
      const world = store.getState().world!;
      expect(world.tLatestGlobal).toBe(entry.t);
      expect(world.meta.msgId).toBe(entry.msgId);
      // 장면 버전·구성 버전·World ID 를 기록 그대로 옮긴다.
      expect([world.sceneVersion, world.configVersion, world.calibrationVersion]).toEqual([
        'scene-3',
        'cfg-12',
        'cal-7',
      ]);
      expect(world.tracks.map((tr) => [tr.worldId, tr.pelvis])).toEqual(
        message.payload.tracks.map((tr) => [tr.world_id, tr.pelvis_xyz]),
      );
      expect(source.getStatus()).toMatchObject({ playhead: t, worldT: entry.t, gap: false });
      expect(store.getState().connection?.state).toBe('OPEN');
    }
  });

  it('기록 없는 구간은 마지막 기록을 연령과 함께 두고 연결을 CLOSED 로 알린다', () => {
    const source = createReplaySource(log);
    const { store } = connect(source);
    source.seek(T0 + 3700);
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 2900);
    expect(store.getState().connection).toMatchObject({
      state: 'CLOSED',
      reason: REPLAY_GAP_REASON,
    });
    expect(source.getStatus()).toMatchObject({ gap: true, recordAgeMs: 800, worldT: T0 + 2900 });
    // 활성 이벤트는 해소로 보지 않고 마지막 수신 상태로 남긴다.
    const people = risk(store, 'REPLAY').people;
    expect(people.get('w-0012')).toMatchObject({ level: 'CRITICAL', lastReceived: true });

    // 빈 구간 안이라도 기준(500ms) 안이면 기록이 덮는 것으로 본다.
    source.seek(T0 + 3300);
    expect(store.getState().connection?.state).toBe('OPEN');
    source.seek(T0 + 4500);
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 4500);
    expect(store.getState().connection?.state).toBe('OPEN');
  });

  it('앞뒤로 seek 을 반복해도 역전 거부 없이 시각별 이벤트 상태가 기록과 같다', () => {
    const source = createReplaySource(log);
    const { store } = connect(source);
    const expected: [number, string | null][] = [
      [T0 + 2500, 'UPDATED CRITICAL'],
      [T0 + 500, null],
      [T0 + 5500, 'RESOLVED CRITICAL'],
      [T0 + 1500, 'RAISED HIGH'],
      [T0 + 1000, 'RAISED HIGH'],
      [T0 + 999, null],
      [T0 + 5900, 'RESOLVED CRITICAL'],
      [T0 + 2000, 'UPDATED CRITICAL'],
      [T0, null],
    ];
    for (const [t, state] of expected) {
      source.seek(t);
      const event = store.getState().events.get('REPLAY:' + EVENT);
      expect([t - T0, event ? event.lifecycle + ' ' + event.severity : null]).toEqual([
        t - T0,
        state,
      ]);
      expect(store.getState().world?.tLatestGlobal).toBe(recordAt(t).entry.t);
    }
    const { counts } = store.getState();
    expect([counts.outOfOrder, counts.duplicate, counts.rejected]).toEqual([0, 0, 0]);
  });

  it('재생 이벤트는 REPLAY 키에만 들어가고 LIVE 모드·LIVE 경보 대상에 섞이지 않는다', () => {
    const source = createReplaySource(log);
    const { store } = connect(source);
    source.seek(T0 + 2500);
    expect([...store.getState().events.keys()]).toEqual(['REPLAY:' + EVENT]);
    expect(selectActiveEvents(store.getState(), 'LIVE')).toEqual([]);
    expect(risk(store, 'LIVE').people.size).toBe(0);
    const replay = risk(store, 'REPLAY').people.get('w-0012')!;
    expect(replay).toMatchObject({ level: 'CRITICAL', source: 'REPLAY', lastReceived: false });
    // 실시간 관측이 아니라 점선이다.
    expect(riskStyle(replay).dashed).toBe(true);
    // 기록에 없는 구역(z-04)은 상자를 지어내지 않고 미연결로 둔다.
    expect(risk(store, 'REPLAY').unlinked).toEqual([
      { eventId: EVENT, target: 'z-04', reason: 'ZONE_NOT_IN_SCENE' },
    ]);
  });

  it('재생은 시계대로 진행하고 끝에서 멈추며, 다시 재생하면 처음부터다', () => {
    vi.useFakeTimers({ now: 0 });
    const source = createReplaySource(log, { autoplay: true });
    const { store } = connect(source);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(source.getStatus().playhead).toBe(T0 + 1000);
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 1000);
    expect(store.getState().events.get('REPLAY:' + EVENT)?.lifecycle).toBe('RAISED');

    source.setSpeed(2);
    act(() => vi.advanceTimersByTime(1000));
    expect(source.getStatus().playhead).toBe(T0 + 3000);
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 2900);

    act(() => vi.advanceTimersByTime(10_000));
    expect(source.getStatus()).toMatchObject({ playhead: T0 + 5900, playing: false, ended: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 5900);

    source.play();
    expect(source.getStatus()).toMatchObject({ playhead: T0, playing: true, ended: false });
    expect(store.getState().world?.tLatestGlobal).toBe(T0);
    expect(store.getState().events.size).toBe(0);
    source.pause();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('구독이 모두 풀리면 시계를 멈추고, 다시 구독하면 그 시각부터 다시 보낸다', () => {
    vi.useFakeTimers({ now: 0 });
    const source = createReplaySource(log, { autoplay: true });
    const first = connect(source);
    act(() => vi.advanceTimersByTime(500));
    first.off();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(source.getStatus().playhead).toBe(T0 + 500);
    const second = connect(source);
    expect(second.store.getState().world?.tLatestGlobal).toBe(T0 + 500);
    expect(vi.getTimerCount()).toBe(1);
    second.off();
  });

  it('프레임 이동은 기록된 World 시각만 밟고 빈 구간을 건너뛴다', () => {
    const source = createReplaySource(log, { autoplay: true });
    connect(source);
    source.seek(T0 + 2900);
    expect(source.stepFrame(1)).toBe(true);
    expect(source.getStatus()).toMatchObject({ playhead: T0 + 4500, playing: false });
    expect(source.stepFrame(-1)).toBe(true);
    expect(source.getStatus().playhead).toBe(T0 + 2900);
    source.seek(T0 + 3700);
    expect(source.stepFrame(-1)).toBe(true);
    expect(source.getStatus().playhead).toBe(T0 + 2900);
    source.seek(T0);
    expect(source.stepFrame(-1)).toBe(false);
    source.seek(T0 + 5900);
    expect(source.stepFrame(1)).toBe(false);
  });

  it('범위 밖 seek 은 처음·끝으로 맞추고, 유한하지 않은 값·잘못된 배속은 받지 않는다', () => {
    const source = createReplaySource(log);
    connect(source);
    expect(source.seek(T0 - 10_000)).toBe(true);
    expect(source.getStatus().playhead).toBe(T0);
    expect(source.seek(T0 + 99_999)).toBe(true);
    expect(source.getStatus()).toMatchObject({ playhead: T0 + 5900, ended: true });
    expect(source.seek(Number.NaN)).toBe(false);
    expect(source.seek(Number.POSITIVE_INFINITY)).toBe(false);
    expect(source.setSpeed(0)).toBe(false);
    expect(source.setSpeed(Number.NaN)).toBe(false);
    expect(source.getStatus().speed).toBe(1);
  });

  it('World 보다 이벤트가 먼저인 기록은 World 가 올 때까지 비워 두고 그 이유를 알린다', () => {
    const [world] = log.worlds;
    const [raised] = log.events;
    const early = raised!.text.replace(/"updated_at":\d+/, '"updated_at":' + (T0 - 500));
    const custom = parseReplayLog([
      { name: 'e', text: early },
      { name: 'w', text: world!.text },
    ]);
    const source = createReplaySource(custom);
    const { store } = connect(source);
    expect(source.getStatus()).toMatchObject({ playhead: T0 - 500, worldT: null, gap: true });
    expect(store.getState().world).toBeNull();
    expect(store.getState().connection).toMatchObject({
      state: 'CLOSED',
      reason: REPLAY_BEFORE_REASON,
    });
  });

  it('기록을 갱신하면 재생 시각·배속을 지키고 구독에 새 기록의 지금 상태를 다시 보낸다', () => {
    // 앞 World 둘과 이벤트 없음만 받은 기록. 받은 기록 끝보다 뒤 시각에서 시작해 갱신 전에는 기록 없는 구간이다.
    const partial = { ...log, worlds: log.worlds.slice(0, 2), events: [] };
    const source = createReplaySource(partial);
    const { store } = connect(source);
    const listener = vi.fn();
    source.subscribeStatus(listener);
    source.seek(T0 + 4500);
    source.setSpeed(2);
    expect(source.getStatus()).toMatchObject({ gap: true, worldT: partial.worlds[1]!.t });
    expect(store.getState().world?.tLatestGlobal).toBe(partial.worlds[1]!.t);
    expect(store.getState().events.size).toBe(0);
    listener.mockClear();

    expect(source.updateLog(log)).toBe(true);

    const { entry } = recordAt(T0 + 4500);
    expect(source.log).toBe(log);
    expect(source.getStatus()).toMatchObject({
      playhead: T0 + 4500,
      speed: 2,
      worldT: entry.t,
      playing: false,
    });
    expect(store.getState().world?.tLatestGlobal).toBe(entry.t);
    expect(store.getState().events.get('REPLAY:' + EVENT)?.lifecycle).toBe('UPDATED');
    expect(source.subscriberCount).toBe(1);
    expect(listener).toHaveBeenCalled();
    const { counts } = store.getState();
    expect([counts.outOfOrder, counts.duplicate, counts.rejected]).toEqual([0, 0, 0]);
  });

  it('재생 중에 기록을 갱신해도 시계가 이어서 진행한다', () => {
    vi.useFakeTimers({ now: 0 });
    const partial = { ...log, worlds: log.worlds.slice(0, 2), events: [] };
    const source = createReplaySource(partial, { autoplay: true });
    const { store } = connect(source);
    act(() => vi.advanceTimersByTime(1000));
    expect(source.getStatus().playhead).toBe(T0 + 1000);

    source.updateLog(log);
    expect(source.getStatus()).toMatchObject({ playhead: T0 + 1000, playing: true });
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 1000);
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(source.getStatus().playhead).toBe(T0 + 2000);
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 2000);
    source.pause();
  });

  it('시각 범위가 다른 기록으로는 바꾸지 않는다', () => {
    const source = createReplaySource(log);
    expect(source.updateLog({ ...log, end: log.end! + 1 })).toBe(false);
    expect(source.updateLog({ ...log, start: log.start! - 1 })).toBe(false);
    expect(source.log).toBe(log);
  });

  it('빈 기록은 아무것도 지어내지 않고 기록 없음만 알린다', () => {
    const source = createReplaySource(parseReplayLog([{ name: 'x', text: '' }]));
    const { store } = connect(source);
    expect(store.getState().connection).toMatchObject({
      state: 'CLOSED',
      reason: REPLAY_EMPTY_REASON,
    });
    expect(store.getState().world).toBeNull();
    expect(source.seek(T0)).toBe(false);
    source.play();
    expect(source.getStatus()).toMatchObject({ playhead: null, playing: false });
  });
});

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('Viewer 에 재생 Source 연결', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('StrictMode 에서 구독은 하나이고, 뒤로 seek 해도 같은 Source·Canvas 로 기록을 다시 채운다', () => {
    const store = createSpatialDataStore();
    const replay = createReplaySource(log);
    const view = (source: ReplaySpatialSource | ReturnType<typeof createExternalSource>) => (
      <StrictMode>
        <ViewerShell source={source} dataStore={store} initialMode="REPLAY" />
      </StrictMode>
    );
    const { container, rerender } = render(view(replay));
    const canvas = container.querySelector('canvas');
    expect(replay.subscriberCount).toBe(1);
    expect(container.querySelector('[data-viewer-mode]')!.getAttribute('data-viewer-mode')).toBe(
      'REPLAY',
    );
    act(() => {
      replay.seek(T0 + 5500);
    });
    expect(store.getState().events.get('REPLAY:' + EVENT)?.lifecycle).toBe('RESOLVED');
    act(() => {
      replay.seek(T0 + 1500);
    });
    expect(store.getState().sourceId).toBe(replay.id);
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 1500);
    expect(store.getState().events.get('REPLAY:' + EVENT)?.lifecycle).toBe('RAISED');
    expect(store.getState().counts.outOfOrder).toBe(0);
    expect(container.querySelector('canvas')).toBe(canvas);

    // LIVE 입력으로 돌아가면 재생 데이터를 비우고 LIVE 순서 검사는 예전 그대로다.
    const live = createExternalSource('live:a');
    rerender(view(live));
    expect(replay.subscriberCount).toBe(0);
    expect(store.getState().sourceId).toBe('live:a');
    expect(store.getState().world).toBeNull();
    expect(store.getState().events.size).toBe(0);
    act(() => {
      live.setConnection('OPEN');
      live.push(scenarioWorld('normal', 2, T0));
      live.push(scenarioWorld('normal', 1, T0));
    });
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 2 * TICK_MS);
    expect(store.getState().counts.outOfOrder).toBe(1);
    // 해제된 재생 Source 를 움직여도 반영하지 않는다.
    act(() => {
      replay.seek(T0);
    });
    expect(store.getState().world?.tLatestGlobal).toBe(T0 + 2 * TICK_MS);
    expect(container.querySelector('canvas')).toBe(canvas);
  });
});
