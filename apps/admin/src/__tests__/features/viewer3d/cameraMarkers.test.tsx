import { CameraClickContext, CameraLayer } from '@/features/viewer3d/cameras/CameraLayer';
import {
  CAMERA_FRUSTUM_LENGTH_M,
  cameraFrustumDimensions,
  cameraMarkerTransform,
  highlightedCameraIds,
  readCalibrationCameraPoses,
  sameCalibratedCameraPoses,
} from '@/features/viewer3d/cameras/cameraMarkers';
import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { scenarioWorld } from '@/features/viewer3d/dev-harness/scenarios';
import { BoxEditContext, type BoxEditBinding } from '@/features/viewer3d/editing/BoxEditGizmo';
import { createEditStore } from '@/features/viewer3d/editing/editSession.store';
import { EditStoreContext } from '@/features/viewer3d/editing/EditStoreContext';
import { createPlannedStore } from '@/features/viewer3d/planned/plannedLayout';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint } from '@/features/viewer3d/worldCoordinates';
import { createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { act, useEffect } from 'react';
import type { Object3D, Scene } from 'three';
import * as THREE from 'three';
import { Quaternion, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const RAW_CALIBRATION = {
  calibration_state: 'CALIBRATED',
  calibration_version: 'cal-1',
  camera_poses: [
    {
      camera_id: 'cam_A',
      position_xyz: [0.2, 0.2, 2.5],
      forward_xyz: [0.7574, 0.5581, -0.3388],
      hfov_rad: 1.5204,
    },
    {
      camera_id: 'cam_B',
      position_xyz: [7.8, 0.2, 2.5],
      forward_xyz: [-0.7574, 0.5581, -0.3388],
      hfov_rad: 1.5204,
    },
  ],
};

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
let onCameraClick: ReturnType<typeof vi.fn<(cameraId: string) => void>>;

async function mount(boxEditBinding: BoxEditBinding = { boxEdit: null, boxGhosts: [] }) {
  const canvas = document.createElement('canvas');
  root ??= createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  const edit = createEditStore(viewer, data, createPlannedStore());
  const tree = (
    <ViewerStoreContext value={viewer}>
      <SpatialDataContext value={data}>
        <EditStoreContext value={edit.store}>
          <BoxEditContext value={boxEditBinding}>
            <CameraClickContext value={onCameraClick}>
              <SceneProbe />
              <CameraLayer />
            </CameraClickContext>
          </BoxEditContext>
        </EditStoreContext>
      </SpatialDataContext>
    </ViewerStoreContext>
  );
  await act(async () => root!.render(tree));
}

type Handler = (event: unknown) => void;
const onClickOf = (object: Object3D) =>
  (object as unknown as { __r3f: { handlers: { onClick: Handler } } }).__r3f.handlers.onClick;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  viewer = createViewerStore('LIVE');
  viewer.getState().markReady();
  data = createSpatialDataStore();
  data.getState().reset('mock:test');
  onCameraClick = vi.fn();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  scene = null;
  vi.restoreAllMocks();
});

describe('보정 카메라 마커 변환 및 파싱(cameraMarkers)', () => {
  it('보정 상태 응답에서 유효한 카메라 자세만 뽑고 중복·불량 항목은 버린다', () => {
    const parsed = readCalibrationCameraPoses(RAW_CALIBRATION);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.cameraId).toBe('cam_A');
    expect(parsed[0]?.position).toEqual([0.2, 0.2, 2.5]);
    expect(parsed[0]?.hfovRad).toBeCloseTo(1.5204, 6);

    expect(readCalibrationCameraPoses({ camera_poses: [] })).toEqual([]);
    expect(readCalibrationCameraPoses(null)).toEqual([]);
    expect(
      readCalibrationCameraPoses({
        camera_poses: [
          {
            camera_id: 'dup',
            position_xyz: [0, 0, 2],
            forward_xyz: [1, 0, 0],
            hfov_rad: 1.2,
          },
          {
            camera_id: 'dup',
            position_xyz: [1, 0, 2],
            forward_xyz: [1, 0, 0],
            hfov_rad: 1.2,
          },
          {
            camera_id: 'bad_fov',
            position_xyz: [1, 0, 2],
            forward_xyz: [1, 0, 0],
            hfov_rad: 4.0,
          },
        ],
      }),
    ).toEqual([]);
  });

  it('World 위치·정면 벡터를 Three.js (x, z, -y) 로 변환하고 정면 사원수를 맞춘다', () => {
    const [camA] = readCalibrationCameraPoses(RAW_CALIBRATION);
    const transform = cameraMarkerTransform(camA!);
    // World (0.2, 0.2, 2.5) -> Three (0.2, 2.5, -0.2)
    expect(transform.position[0]).toBeCloseTo(0.2, 6);
    expect(transform.position[1]).toBeCloseTo(2.5, 6);
    expect(transform.position[2]).toBeCloseTo(-0.2, 6);
    // World forward (0.7574, 0.5581, -0.3388) -> Three (0.7574, -0.3388, -0.5581)
    expect(transform.forward[0]).toBeCloseTo(0.7574, 3);
    expect(transform.forward[1]).toBeCloseTo(-0.3388, 3);
    expect(transform.forward[2]).toBeCloseTo(-0.5581, 3);

    const q = new Quaternion(...transform.quaternion);
    const rotatedZ = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(rotatedZ.x).toBeCloseTo(transform.forward[0], 5);
    expect(rotatedZ.y).toBeCloseTo(transform.forward[1], 5);
    expect(rotatedZ.z).toBeCloseTo(transform.forward[2], 5);
  });

  it('길이 1.5 m 시야 절두체 크기와 선택한 사람 트랙의 카메라 강조 집합을 계산한다', () => {
    const frustum = cameraFrustumDimensions(Math.PI / 2, CAMERA_FRUSTUM_LENGTH_M);
    expect(frustum.length).toBe(1.5);
    expect(frustum.halfWidth).toBeCloseTo(1.5, 6);
    expect(frustum.halfHeight).toBeCloseTo(1.5 / (16 / 9), 6);

    const tracks = [
      { worldId: 'w-1', cameras: ['cam_A', 'cam_C'] },
      { worldId: 'w-2', cameras: ['cam_B'] },
    ];
    expect([...highlightedCameraIds(tracks, { type: 'person', id: 'w-1' })]).toEqual([
      'cam_A',
      'cam_C',
    ]);
    expect([...highlightedCameraIds(tracks, { type: 'zone', id: 'z-1' })]).toEqual([]);
    expect([...highlightedCameraIds(tracks, null)]).toEqual([]);
  });

  it('같은 카메라 마커 목록을 다시 넘겨도 viewer3d Store 를 바꾸지 않는다', () => {
    const posesA = readCalibrationCameraPoses(RAW_CALIBRATION);
    const posesB = readCalibrationCameraPoses(structuredClone(RAW_CALIBRATION));
    expect(sameCalibratedCameraPoses(posesA, posesB)).toBe(true);
    viewer.getState().setCameraPoses(posesA);
    const stored = viewer.getState().cameraPoses;
    viewer.getState().setCameraPoses(posesB);
    expect(viewer.getState().cameraPoses).toBe(stored);
  });
});

describe('CameraLayer 3D 렌더링·클릭·사람 선택 강조·편집 모드 숨김', () => {
  it('카메라 마커·시야 절두체를 정확한 위치에 그리고 클릭 시 onCameraClick 을 호출한다', async () => {
    const poses = readCalibrationCameraPoses(RAW_CALIBRATION);
    viewer.getState().setCameraPoses(poses);
    await mount();

    const markerA = scene!.getObjectByName('camera-marker:cam_A')!;
    expect(markerA).toBeDefined();
    expect(markerA.position.toArray()).toEqual([0.2, 2.5, -0.2]);
    expect(scene!.getObjectByName('camera-frustum:cam_A')).toBeDefined();

    const bodyA = scene!.getObjectByName('camera-body:cam_A')!;
    const stopPropagation = vi.fn();
    act(() => onClickOf(bodyA)({ delta: 0, stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onCameraClick).toHaveBeenCalledWith('cam_A');
  });

  it('사람이 선택되면 그 사람 트랙의 cameras 에 든 카메라 마커만 강조 표시한다', async () => {
    const poses = readCalibrationCameraPoses(RAW_CALIBRATION);
    viewer.getState().setCameraPoses(poses);
    viewer.getState().registerTarget({ type: 'person', id: 'w-0001' });
    await mount();

    const baseWorld = scenarioWorld('normal', 1, 1_760_342_400_000);
    const customWorld = {
      ...baseWorld,
      payload: {
        ...baseWorld.payload,
        tracks: baseWorld.payload.tracks.map((track) =>
          track.world_id === 'w-0001' ? { ...track, cameras: ['cam_B'] } : track,
        ),
      },
    };

    await act(async () => {
      expect(data.getState().ingest(customWorld, 1_760_342_400_110)).toBe('world');
    });

    expect(scene!.getObjectByName('camera-marker:cam_A')?.userData.highlighted).toBe(false);
    expect(scene!.getObjectByName('camera-marker:cam_B')?.userData.highlighted).toBe(false);

    await act(async () => {
      viewer.getState().select({ type: 'person', id: 'w-0001' });
    });

    expect(scene!.getObjectByName('camera-marker:cam_A')?.userData.highlighted).toBe(false);
    expect(scene!.getObjectByName('camera-marker:cam_B')?.userData.highlighted).toBe(true);
  });

  it('구역 상자 편집(boxEdit) 중에는 카메라 마커를 숨긴다', async () => {
    const poses = readCalibrationCameraPoses(RAW_CALIBRATION);
    viewer.getState().setCameraPoses(poses);
    await mount({
      boxEdit: {
        id: 'z-01',
        kind: 'zone',
        box: { min: worldPoint(1, 1, 0), max: worldPoint(3, 3, 2) },
      },
      boxGhosts: [],
    });

    expect(scene!.getObjectByName('camera-layer')).toBeUndefined();
    expect(scene!.getObjectByName('camera-marker:cam_A')).toBeUndefined();
  });
});
