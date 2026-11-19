import type { CalibratedCameraPose } from '@/features/viewer3d/cameras/cameraMarkers';
import {
  CAMERA_VIEW_POSITION_TOL_M,
  cameraViewPose,
  createFpsGuard,
  easeInOutCubic,
  interpolateView,
  sameView,
  verticalFovDeg,
  type ViewerViewPose,
} from '@/features/viewer3d/cameras/cameraView';
import { withVdtCameraImages } from '@/features/viewer3d/scene/vdtMath';
import type { SceneMapCameras, SceneVdtConfig } from '@/features/viewer3d/scene/vdtTypes';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { worldPoint, worldToThree } from '@/features/viewer3d/worldCoordinates';
import { describe, expect, it } from 'vitest';

// 카메라 시점 보기(S15P31A101-590)의 순수 계산·Store 명령·사진 주소 자리.

const CAM_A: CalibratedCameraPose = {
  cameraId: 'cam_A',
  position: worldPoint(1, 2, 2.4),
  // 아래로 45° 내려다본다(+X 쪽).
  forward: worldPoint(Math.SQRT1_2, 0, -Math.SQRT1_2),
  hfovRad: Math.PI / 2,
};

const expectNear = (actual: readonly number[], expected: readonly number[]) =>
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 6));

describe('카메라 시점 계산', () => {
  it('세로 시야각은 수평 시야각과 16:9 비율로 구한다', () => {
    // tan(45°)=1, 1/(16/9)=0.5625 → 2·atan(0.5625)
    expect(verticalFovDeg(Math.PI / 2)).toBeCloseTo((2 * Math.atan(0.5625) * 180) / Math.PI, 9);
    expect(verticalFovDeg(Math.PI / 2, 1)).toBeCloseTo(90, 9);
  });

  it('카메라 자리는 worldToThree 로 옮기고 회전 중심은 정면 광선이 바닥에 닿는 점이다', () => {
    const view = cameraViewPose(CAM_A);
    expectNear(view.position, worldToThree(CAM_A.position));
    // 높이 2.4 m 에서 45° 아래 → 바닥까지 거리 2.4·√2, 바닥 점 (3.4, 2, 0)
    expectNear(view.target, worldToThree(worldPoint(3.4, 2, 0)));
    expect(view.fovDeg).toBeCloseTo(verticalFovDeg(Math.PI / 2), 9);
  });

  it('정면이 바닥을 향하지 않으면 4 m 앞을 회전 중심으로 둔다', () => {
    const level = { ...CAM_A, forward: worldPoint(0, 1, 0) };
    expectNear(cameraViewPose(level).target, worldToThree(worldPoint(1, 6, 2.4)));
  });

  it('이음은 0·1 에서 끝나고 가운데에서 절반이며, 시점 잇기는 끝에서 목표와 같다', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(2)).toBe(1);
    const from: ViewerViewPose = { position: [0, 0, 0], target: [0, 0, -1], fovDeg: 50 };
    const to = cameraViewPose(CAM_A);
    expect(interpolateView(from, to, 1)).toEqual({
      position: [...to.position],
      target: [...to.target],
      fovDeg: to.fovDeg,
    });
    expect(interpolateView(from, to, 0.5).fovDeg).toBeCloseTo((50 + to.fovDeg) / 2, 9);
  });

  it('맞아 있음은 자리 1 cm·방향 0.25°·세로 시야각 0.1° 안이고 회전 중심 거리는 보지 않는다', () => {
    const base = cameraViewPose(CAM_A);
    expect(sameView(base, base)).toBe(true);
    // 같은 방향으로 회전 중심만 더 멀리
    const farther: ViewerViewPose = {
      ...base,
      target: [
        base.position[0] + (base.target[0] - base.position[0]) * 2,
        base.position[1] + (base.target[1] - base.position[1]) * 2,
        base.position[2] + (base.target[2] - base.position[2]) * 2,
      ],
    };
    expect(sameView(farther, base)).toBe(true);
    const moved: ViewerViewPose = {
      ...base,
      position: [
        base.position[0] + CAMERA_VIEW_POSITION_TOL_M * 2,
        base.position[1],
        base.position[2],
      ],
    };
    expect(sameView(moved, base)).toBe(false);
    expect(sameView({ ...base, fovDeg: base.fovDeg + 1 }, base)).toBe(false);
    const turned: ViewerViewPose = {
      ...base,
      target: [base.target[0], base.target[1] + 0.2, base.target[2]],
    };
    expect(sameView(turned, base)).toBe(false);
  });
});

describe('VDT 프레임 감시', () => {
  it('준비 시간 뒤 창이 찰 때 평균 FPS 가 기준 아래면 알리고, 기준 이상이면 알리지 않는다', () => {
    const slow = createFpsGuard({ minFps: 24, windowMs: 1000, warmupMs: 100 });
    let low = false;
    for (let i = 0; i < 40 && !low; i++) low = slow.push(50); // 20 FPS
    expect(low).toBe(true);

    const fast = createFpsGuard({ minFps: 24, windowMs: 1000, warmupMs: 100 });
    let anyLow = false;
    for (let i = 0; i < 200; i++) anyLow = fast.push(1000 / 60) || anyLow;
    expect(anyLow).toBe(false);
  });

  it('준비 시간 동안의 느린 프레임과 탭이 멈춘 긴 간격은 세지 않는다', () => {
    const guard = createFpsGuard({ minFps: 24, windowMs: 1000, warmupMs: 1000 });
    // 준비 시간(사진 올리기·그림자 굽기) 동안 100 ms 프레임 10개
    for (let i = 0; i < 10; i++) expect(guard.push(100)).toBe(false);
    // 탭이 숨었다 돌아온 3 초 간격은 창을 비운다
    expect(guard.push(3000)).toBe(false);
    let anyLow = false;
    for (let i = 0; i < 120; i++) anyLow = guard.push(1000 / 60) || anyLow;
    expect(anyLow).toBe(false);
  });
});

describe('뷰어 Store 카메라 시점 명령', () => {
  const ready = () => {
    const store = createViewerStore('LIVE');
    store.getState().setCameraPoses([CAM_A]);
    return store;
  };

  it('준비 전이면 NOT_READY, 마커에 없는 카메라면 NOT_FOUND, 빈 값이면 INVALID_TARGET 이다', () => {
    const store = ready();
    expect(store.getState().viewFromCamera('cam_A')).toEqual({ ok: false, reason: 'NOT_READY' });
    store.getState().markReady();
    expect(store.getState().viewFromCamera('cam_Z')).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(store.getState().viewFromCamera('')).toEqual({ ok: false, reason: 'INVALID_TARGET' });
    expect(store.getState().cameraViewRequest).toBeNull();
  });

  it('요청마다 새 객체를 두고 프레임 저하로 막은 VDT 를 다시 허락한다', () => {
    const store = ready();
    store.getState().markReady();
    store.getState().blockCameraVdt('LOW_FPS');
    expect(store.getState().viewFromCamera('cam_A')).toEqual({ ok: true });
    const first = store.getState().cameraViewRequest;
    expect(first).toEqual({ cameraId: 'cam_A' });
    expect(store.getState().cameraVdtBlocked).toBeNull();
    store.getState().viewFromCamera('cam_A');
    expect(store.getState().cameraViewRequest).not.toBe(first);
  });

  it('나가기는 요청 수만 늘린다', () => {
    const store = ready();
    expect(store.getState().exitCameraView()).toEqual({ ok: true });
    expect(store.getState().cameraViewExits).toBe(1);
  });
});

describe('VDT 사진 주소 자리(cameraImageUrls)', () => {
  const MAP: SceneMapCameras = {
    cam_B: {
      imageSize: [2304, 1296],
      K: [
        [1152, 0, 1152],
        [0, 1152, 648],
        [0, 0, 1],
      ],
      R: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      t: [0, 0, 0],
      poseSource: 'MA_ALIGNED_SIM3',
    },
    cam_A: {
      imageSize: [2304, 1296],
      K: [
        [1152, 0, 1152],
        [0, 1152, 648],
        [0, 0, 1],
      ],
      R: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      t: [1, 0, 0],
      poseSource: 'CALIBRATION',
    },
  };

  it('주소가 없으면 장면 설정 그대로이고, 장면 설정도 없으면 null 이다(사진을 지어내지 않는다)', () => {
    expect(withVdtCameraImages(null, MAP, undefined)).toBeNull();
    expect(withVdtCameraImages(null, MAP, {})).toBeNull();
    expect(withVdtCameraImages(null, null, { cam_A: '/bg/cam_A.jpg' })).toBeNull();
  });

  it('장면 설정이 없으면 map_cameras 와 주소가 둘 다 있는 카메라로 ID 순 최소 설정을 만든다', () => {
    const config = withVdtCameraImages(null, MAP, {
      cam_B: '/bg/cam_B.jpg',
      cam_C: '/bg/cam_C.jpg',
    });
    expect(config?.cameras.map((c) => [c.cameraId, c.imageUrl, c.poseSource])).toEqual([
      ['cam_B', '/bg/cam_B.jpg', 'MA_ALIGNED_SIM3'],
    ]);
    expect(config?.floorPlane).toBeNull();
    expect(config?.wallPlanes).toEqual([]);
    const both = withVdtCameraImages(null, MAP, { cam_B: '/b.jpg', cam_A: '/a.jpg' });
    expect(both?.cameras.map((c) => c.cameraId)).toEqual(['cam_A', 'cam_B']);
  });

  it('장면 설정이 있으면 같은 카메라의 사진 주소만 바꾼다', () => {
    const base = withVdtCameraImages(null, MAP, { cam_A: '/old/a.jpg', cam_B: '/old/b.jpg' })!;
    const next = withVdtCameraImages(base, MAP, { cam_A: '/clean/a.jpg' }) as SceneVdtConfig;
    expect(next.cameras.map((c) => c.imageUrl)).toEqual(['/clean/a.jpg', '/old/b.jpg']);
    expect(withVdtCameraImages(base, MAP, { cam_A: '/old/a.jpg' })).toBe(base);
  });
});
