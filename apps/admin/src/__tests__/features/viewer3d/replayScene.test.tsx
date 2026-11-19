import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataProvider } from '@/features/viewer3d/data/SpatialDataProvider';
import { exampleReplayLog } from '@/features/viewer3d/dev-harness/harnessSource';
import { PersonLayer } from '@/features/viewer3d/people/PersonLayer';
import {
  createReplaySource,
  type ReplaySpatialSource,
} from '@/features/viewer3d/replay/replaySource';
import { RiskScope } from '@/features/viewer3d/risk/RiskScope';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint, worldToThree } from '@/features/viewer3d/worldCoordinates';
import { ZoneLayer } from '@/features/viewer3d/zones/ZoneLayer';
import { advance, createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { act, StrictMode, useEffect } from 'react';
import type { Scene } from 'three';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 녹화 재생(-187)을 LIVE 와 같은 장면 렌더러(PersonLayer·RiskScope·ZoneLayer)에 Provider 로 넣는다.
// jsdom 에는 WebGL 이 없어 그리기만 하는 가짜 renderer 로 장면 트리·위치·위험 표식을 본다(픽셀은 브라우저에서).
extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

function fakeRenderer(canvas: HTMLCanvasElement) {
  return {
    render: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
    dispose: () => {},
    forceContextLoss: () => {},
    domElement: canvas,
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    xr: {
      enabled: false,
      isPresenting: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      setAnimationLoop: () => {},
    },
    renderLists: { dispose: () => {} },
    outputColorSpace: '',
    toneMapping: 0,
  };
}

const T0 = 1_760_342_400_100;
const log = exampleReplayLog();

let scene: Scene | null = null;
function SceneProbe() {
  const current = useThree((s) => s.scene);
  useEffect(() => {
    scene = current;
  }, [current]);
  return null;
}

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let viewer: ViewerStore;
let data: SpatialDataStore;
let replay: ReplaySpatialSource;

async function mount() {
  const canvas = document.createElement('canvas');
  root ??= createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  await act(async () =>
    root!.render(
      <StrictMode>
        <ViewerStoreContext value={viewer}>
          <SpatialDataProvider store={data} source={replay}>
            <SceneProbe />
            <RiskScope>
              <ZoneLayer />
              <PersonLayer />
            </RiskScope>
          </SpatialDataProvider>
        </ViewerStoreContext>
      </StrictMode>,
    ),
  );
  await frames();
}

async function frames(n = 3) {
  for (let i = 0; i < n; i++) await act(async () => advance(performance.now() + i * 16));
}

async function seek(t: number) {
  await act(async () => {
    replay.seek(t);
  });
  await frames();
}

const named = (name: string) => scene!.getObjectByName(name);
const marks = () => {
  const names: string[] = [];
  scene!.traverse((n) => {
    if (n.name.startsWith('risk-')) names.push(n.name);
  });
  return names.sort();
};
const markInfo = (id: string) =>
  named('risk-person:' + id)?.userData as { level: string; source: string } | undefined;
const position = (id: string) =>
  named('person-avatar:' + id)!
    .position.toArray()
    .map((v) => Math.round(v * 1e6) / 1e6);

/** 기록에서 그 시각 이하 마지막 World 의 w-0012 접지점(Three 좌표). */
function recordedFeet(t: number) {
  const entry = [...log.worlds].reverse().find((w) => w.t <= t)!;
  const message = JSON.parse(entry.text) as {
    payload: { tracks: { world_id: string; ground_anchor_xyz: [number, number, number] }[] };
  };
  const anchor = message.payload.tracks.find((tr) => tr.world_id === 'w-0012')!.ground_anchor_xyz;
  return worldToThree(worldPoint(...anchor)).map((v) => Math.round(v * 1e6) / 1e6);
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  viewer = createViewerStore('REPLAY');
  viewer.getState().markReady();
  data = createSpatialDataStore();
  replay = createReplaySource(log);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  scene = null;
  vi.restoreAllMocks();
});

describe('녹화 재생 장면', () => {
  it('시각별 아바타 위치가 기록과 같고 기록 없는 사람을 만들지 않는다', async () => {
    await mount();
    expect(replay.subscriberCount).toBe(1);
    expect(position('w-0012')).toEqual(recordedFeet(T0));
    // 높이를 모르는 사람은 수평 위치에만 둔다(바닥 Z 를 지어내지 않는다).
    expect(position('w-0013')).toEqual([6.1, 0, -2.2]);

    await seek(T0 + 5900);
    expect(position('w-0012')).toEqual(recordedFeet(T0 + 5900));
    await seek(T0);
    expect(position('w-0012')).toEqual(recordedFeet(T0));
    expect(named('person-avatar:w-9999')).toBeUndefined();
  });

  it('위험 강조가 기록 시각의 이벤트 상태를 따르고, 뒤로 돌려도 같은 시각이면 같다', async () => {
    await mount();
    expect(marks()).toEqual([]);
    await seek(T0 + 1500);
    expect(marks()).toEqual(['risk-person:w-0012']);
    expect(markInfo('w-0012')).toMatchObject({ level: 'HIGH', source: 'REPLAY' });
    await seek(T0 + 2500);
    expect(markInfo('w-0012')!.level).toBe('CRITICAL');
    // 기록 없는 구간에도 해소된 것으로 보지 않는다.
    await seek(T0 + 3700);
    expect(markInfo('w-0012')!.level).toBe('CRITICAL');
    await seek(T0 + 5500);
    expect(marks()).toEqual([]);
    await seek(T0 + 1500);
    expect(markInfo('w-0012')).toMatchObject({ level: 'HIGH', source: 'REPLAY' });
    await seek(T0 + 500);
    expect(marks()).toEqual([]);
    expect(data.getState().counts.outOfOrder).toBe(0);
  });

  it('LIVE 모드로 바꾸면 재생 이벤트를 강조하지 않고 REPLAY 로 돌아오면 다시 보인다', async () => {
    await mount();
    await seek(T0 + 2500);
    expect(marks()).toEqual(['risk-person:w-0012']);
    await act(async () => viewer.getState().setMode('LIVE'));
    expect(marks()).toEqual([]);
    await act(async () => viewer.getState().setMode('REPLAY'));
    expect(markInfo('w-0012')).toMatchObject({ level: 'CRITICAL', source: 'REPLAY' });
  });
});
