import { CameraRig } from '@/features/viewer3d/CameraRig';
import type { CalibratedCameraPose } from '@/features/viewer3d/cameras/cameraMarkers';
import { cameraViewPose } from '@/features/viewer3d/cameras/cameraView';
import { roomViewOf } from '@/features/viewer3d/scene/roomView';
import { IDLE_LOAD, type SceneLoad } from '@/features/viewer3d/scene/sceneContract';
import {
  createSceneStore,
  SceneStoreContext,
  type SceneStore,
} from '@/features/viewer3d/scene/sceneStore';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint } from '@/features/viewer3d/worldCoordinates';
import { DEFAULT_ROOM_LIMIT, roomLimitFrom } from '@/lib/roomLimit';
import {
  advance,
  createRoot,
  extend,
  useThree,
  type ReconcilerRoot,
  type RootState,
} from '@react-three/fiber';
import { act, useEffect } from 'react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 시점 틀(CameraRig): 새 스캔 범위가 들어오면 한 번 그 시점으로 옮기고, 시점 초기화는 스캔이 있으면 스캔 시점·없으면 목업 시점으로 돌린다(-395).
// 스캔 범위는 뷰어 장면 저장소의 load.boundsWorld 와 display 로 들어온다. WebGL 없이 실제 OrbitControls 를 붙여 카메라 자리를 읽는다.

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

type Bounds = NonNullable<SceneLoad['boundsWorld']>;
const SCAN_A: Bounds = { min: [0, 0, 0], max: [6, 8, 3] };
const SCAN_B: Bounds = { min: [-2, 1, 0], max: [10, 7, 3] };
const TOO_SMALL: Bounds = { min: [0, 0, 0], max: [0.2, 0.2, 3] };
/** 사용자가 돌려 놓은 카메라 자리(어느 시점과도 다르다). */
const USER_POSITION = [7, 7, 7] as const;

const homeOf = (bounds: Bounds | null) => roomViewOf(roomLimitFrom(bounds)).home;
const targetOf = (bounds: Bounds | null) => roomViewOf(roomLimitFrom(bounds)).target;
const MOCK_HOME = roomViewOf(DEFAULT_ROOM_LIMIT).home;

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

let viewer: ViewerStore;
let sceneStore: SceneStore;
let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let three: (() => RootState) | null = null;

function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    three = get;
  }, [get]);
  return null;
}

async function mount() {
  const canvas = document.createElement('canvas');
  root = createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  await act(async () =>
    root!.render(
      <ViewerStoreContext value={viewer}>
        <SceneStoreContext value={sceneStore}>
          <Probe />
          <CameraRig />
        </SceneStoreContext>
      </ViewerStoreContext>,
    ),
  );
}

const camera = () => three!().camera;
const position = () => camera().position.toArray();
const orbitTarget = () => (three!().controls as unknown as { target: THREE.Vector3 }).target;
const expectNear = (actual: readonly number[], expected: readonly number[]) =>
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 5));

/** 스캔을 읽어 보이게 한다(같은 bounds 객체면 같은 스캔이다). */
const showScan = (boundsWorld: Bounds) =>
  act(async () => {
    sceneStore
      .getState()
      .setLoad({ ...IDLE_LOAD, phase: 'LOADED', sceneVersion: 'scene-1', boundsWorld });
    sceneStore.getState().setDisplay('FULL');
  });
const hideScan = () => act(async () => sceneStore.getState().setDisplay('HIDDEN'));
const moveByUser = () => {
  camera().position.set(...USER_POSITION);
  (three!().controls as unknown as { update: () => void }).update();
};
const resetView = () => act(async () => void viewer.getState().resetView());

beforeEach(() => {
  viewer = createViewerStore('LIVE');
  viewer.getState().markReady();
  sceneStore = createSceneStore();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  three = null;
});

describe('CameraRig 스캔 시점', () => {
  it('스캔이 없으면 카메라를 옮기지 않는다', async () => {
    await mount();
    const start = position();
    await hideScan();
    expect(position()).toEqual(start);
  });

  it('새 스캔 범위가 들어오면 그 시점(가운데 바닥을 보는 자리)으로 한 번 옮긴다', async () => {
    await mount();
    await showScan(SCAN_A);
    expectNear(position(), homeOf(SCAN_A));
    expectNear(orbitTarget().toArray(), targetOf(SCAN_A));
  });

  it('같은 범위 객체로는 다시 옮기지 않고, 다른 범위 객체가 들어오면 그 시점으로 옮긴다', async () => {
    await mount();
    await showScan(SCAN_A);
    moveByUser();

    // 스캔이 숨었다가 같은 범위로 돌아와도 사용자가 보던 시점을 지킨다.
    await hideScan();
    await showScan(SCAN_A);
    expectNear(position(), USER_POSITION);

    await showScan(SCAN_B);
    expectNear(position(), homeOf(SCAN_B));
    expectNear(orbitTarget().toArray(), targetOf(SCAN_B));
  });

  it('스캔이 사라져도 카메라는 그대로다', async () => {
    await mount();
    await showScan(SCAN_A);
    moveByUser();
    await hideScan();
    expectNear(position(), USER_POSITION);
  });

  it('쓸 수 없는 범위(한 변 0.2m)는 새 범위로 치지 않아 카메라를 옮기지 않는다', async () => {
    await mount();
    const start = position();
    await showScan(TOO_SMALL);
    expect(position()).toEqual(start);
  });
});

describe('CameraRig 시점 초기화', () => {
  it('스캔이 보이면 스캔 시점으로, 스캔이 없으면 목업 교실 시점으로 돌아간다', async () => {
    await mount();
    await showScan(SCAN_A);
    moveByUser();
    await resetView();
    expectNear(position(), homeOf(SCAN_A));
    expectNear(orbitTarget().toArray(), targetOf(SCAN_A));

    moveByUser();
    await hideScan();
    await resetView();
    expectNear(position(), MOCK_HOME);
    expectNear(orbitTarget().toArray(), targetOf(null));
  });

  it('쓸 수 없는 스캔이 보이는 동안에도 목업 교실 시점으로 돌아간다', async () => {
    await mount();
    await showScan(TOO_SMALL);
    moveByUser();
    await resetView();
    expectNear(position(), MOCK_HOME);
  });

  it('스캔이 늦게 들어와도 시점 초기화는 지금 보이는 스캔을 따른다', async () => {
    await mount();
    await resetView();
    expectNear(position(), MOCK_HOME);
    await showScan(SCAN_B);
    moveByUser();
    await resetView();
    expectNear(position(), homeOf(SCAN_B));
  });
});

const CAM_A: CalibratedCameraPose = {
  cameraId: 'cam_A',
  position: worldPoint(1, 2, 2.4),
  forward: worldPoint(Math.SQRT1_2, 0, -Math.SQRT1_2),
  hfovRad: 1.6,
};
const CAM_A_VIEW = cameraViewPose(CAM_A);

let clockS = 0;
/** frameloop 'never' 라 시계를 직접 돌린다(초). OrbitControls update(-1) 뒤에 시점 틀 프레임이 돈다. */
const step = (seconds: number) =>
  act(async () => {
    clockS += seconds;
    advance(clockS);
  });
const fov = () => (camera() as THREE.PerspectiveCamera).fov;
const viewFromCamera = (cameraId: string) =>
  act(async () => void viewer.getState().viewFromCamera(cameraId));
const exitCameraView = () => act(async () => void viewer.getState().exitCameraView());

describe('CameraRig 카메라 시점 보기(-590)', () => {
  beforeEach(() => {
    clockS = 0;
    viewer.getState().setCameraPoses([CAM_A]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('약 1 초에 걸쳐 카메라 자리·방향·세로 시야각으로 옮기고, 다 옮긴 뒤에만 맞아 있음을 알린다', async () => {
    await mount();
    const startPosition = position();
    const startFov = fov();
    await viewFromCamera('cam_A');
    expect(viewer.getState().cameraViewId).toBe('cam_A');
    expect(viewer.getState().alignedCamera).toBeNull();

    await step(0.5);
    expect(viewer.getState().alignedCamera).toBeNull();
    const mid = position();
    expect(mid).not.toEqual(startPosition);
    expect(fov()).not.toBeCloseTo(startFov, 3);

    await step(0.6);
    expectNear(position(), CAM_A_VIEW.position);
    expectNear(orbitTarget().toArray(), CAM_A_VIEW.target);
    expect(fov()).toBeCloseTo(CAM_A_VIEW.fovDeg, 6);
    expect(viewer.getState().alignedCamera).toBe('cam_A');

    // 가만히 있으면 맞아 있음을 유지한다(OrbitControls update 가 시점을 바꾸지 않는다).
    await step(0.1);
    expect(viewer.getState().alignedCamera).toBe('cam_A');
  });

  it('사용자가 시점을 돌리면 맞음과 마커 숨김을 풀고, 나가기는 클릭 전 시점·시야각으로 부드럽게 돌아간다', async () => {
    await mount();
    const startPosition = position();
    const startTarget = orbitTarget().toArray();
    const startFov = fov();
    await viewFromCamera('cam_A');
    await step(1.1);
    expect(viewer.getState().alignedCamera).toBe('cam_A');

    moveByUser();
    await step(0.016);
    expect(viewer.getState().alignedCamera).toBeNull();
    expect(viewer.getState().cameraViewId).toBeNull();

    await exitCameraView();
    await step(0.5);
    expect(position()).not.toEqual(startPosition);
    await step(0.6);
    expectNear(position(), startPosition);
    expectNear(orbitTarget().toArray(), startTarget);
    expect(fov()).toBeCloseTo(startFov, 6);
    expect(viewer.getState().alignedCamera).toBeNull();
  });

  it('돌아가는 동안은 그 카메라 마커를 숨긴 채 두고 돌아간 뒤에 보인다', async () => {
    await mount();
    await viewFromCamera('cam_A');
    await step(1.1);
    await exitCameraView();
    expect(viewer.getState().alignedCamera).toBeNull();
    expect(viewer.getState().cameraViewId).toBe('cam_A');
    await step(1.1);
    expect(viewer.getState().cameraViewId).toBeNull();
  });

  it('같은 카메라를 다시 부르면 다시 맞춘다', async () => {
    await mount();
    await viewFromCamera('cam_A');
    await step(1.1);
    moveByUser();
    await step(0.016);
    expect(viewer.getState().alignedCamera).toBeNull();

    await viewFromCamera('cam_A');
    await step(1.1);
    expectNear(position(), CAM_A_VIEW.position);
    expect(viewer.getState().alignedCamera).toBe('cam_A');
  });

  it('움직임 줄이기 설정이면 다음 프레임에 바로 옮긴다', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    await mount();
    await viewFromCamera('cam_A');
    await step(0.016);
    expectNear(position(), CAM_A_VIEW.position);
    expect(viewer.getState().alignedCamera).toBe('cam_A');
  });

  it('시점 초기화는 카메라 시점 보기를 끝내고, 그 뒤 나가기는 시점을 바꾸지 않는다', async () => {
    await mount();
    await viewFromCamera('cam_A');
    await step(1.1);
    await resetView();
    expectNear(position(), MOCK_HOME);
    expect(viewer.getState().alignedCamera).toBeNull();
    expect(viewer.getState().cameraViewId).toBeNull();
    const startFov = fov();

    await exitCameraView();
    await step(1.1);
    expectNear(position(), MOCK_HOME);
    expect(fov()).toBe(startFov);
  });
});
