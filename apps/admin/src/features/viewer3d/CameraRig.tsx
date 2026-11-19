import { focusPoint, moveOrbitTo } from '@/features/viewer3d/camera';
import {
  CAMERA_VIEW_MOVE_MS,
  cameraViewPose,
  interpolateView,
  prefersReducedMotion,
  sameView,
  type ViewerViewPose,
} from '@/features/viewer3d/cameras/cameraView';
import { roomViewOf, topRoomViewOf } from '@/features/viewer3d/scene/roomView';
import { useShownScanBounds } from '@/features/viewer3d/scene/useShownRoom';
import { targetKey } from '@/features/viewer3d/target';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { roomLimitFrom, type RoomBounds } from '@/lib/roomLimit';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import type { Camera, PerspectiveCamera } from 'three';

type Controls = ComponentRef<typeof OrbitControls>;

/** 카메라 시점 보기(-590)의 시점 이동 하나. cameraId 가 없으면 클릭 전 시점으로 돌아가는 중이다. */
interface CameraFlight {
  from: ViewerViewPose;
  to: ViewerViewPose;
  elapsedMs: number;
  durationMs: number;
  cameraId: string | null;
}

const perspective = (camera: Camera): PerspectiveCamera | null =>
  (camera as PerspectiveCamera).isPerspectiveCamera ? (camera as PerspectiveCamera) : null;

const fovOf = (camera: Camera): number | null => perspective(camera)?.fov ?? null;

function setFov(camera: Camera, fovDeg: number) {
  const p = perspective(camera);
  if (!p || p.fov === fovDeg) return;
  p.fov = fovDeg;
  p.updateProjectionMatrix();
}

/** 남은 관성(damping)을 한 번에 풀어 없앤다. 이동을 시작할 때 이전 끌기의 관성이 이동과 다투지 않게 한다. */
function settleOrbit(controls: Controls) {
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
}

/**
 * 카메라 조작과 초점 요청. 카메라는 Canvas 가 살아 있는 동안 하나다.
 * 처음 시점(회전 중심·카메라 자리)은 스캔 범위에서 정하고, 스캔이 없으면 목업 교실 기준이다.
 * 새 스캔 범위가 들어오면 한 번 그 시점으로 옮기고, 시점 초기화 요청(viewResets)이 오면 그 시점으로 돌아간다.
 * 카메라 시점 보기(-590): 요청이 오면 그 카메라 자리·방향·세로 시야각으로 옮기고, 맞아 있는 동안 alignedCamera 를 둔다.
 * 프레임마다 지금 시점을 마지막으로 놓은 시점과 비교해, 사용자 조작이나 다른 명령으로 바뀌면 이동을 멈추거나 맞음을 푼다.
 */
export function CameraRig() {
  const store = useViewerStore();
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const controlsRef = useRef<Controls>(null);
  const bounds = useShownScanBounds();
  const limit = useMemo(() => roomLimitFrom(bounds), [bounds]);
  const view = useMemo(() => roomViewOf(limit), [limit]);
  const topView = useMemo(() => topRoomViewOf(limit), [limit]);
  const savedPose = useRef<{
    home: readonly [number, number, number];
    target: readonly [number, number, number];
  } | null>(null);
  const movedForBounds = useRef<RoomBounds | null>(null);
  // 회전 중심은 처음 한 번만 넘긴다. 스캔이 사라질 때 보던 방향이 갑자기 돌지 않게 이후 이동은 아래에서 직접 한다.
  const [initialTarget] = useState(view.target);
  // 처음 시야각. 처음·위에서 보기 시점으로 갈 때 이 값으로 돌린다(카메라 시점 보기가 시야각을 바꾼다).
  const [homeFov] = useState(() => fovOf(camera));
  const flight = useRef<CameraFlight | null>(null);
  // 첫 카메라 시점 보기 직전의 시점. 나가기(exitCameraView)로 여기로 돌아간다.
  const beforeCameraView = useRef<ViewerViewPose | null>(null);
  // 시점 틀이 마지막으로 놓은 시점(이동 중이거나 맞아 있을 때만). 지금 시점과 다르면 바깥에서 바꾼 것이다.
  const expected = useRef<ViewerViewPose | null>(null);

  const applyView = useCallback(
    (next: {
      home: readonly [number, number, number];
      target: readonly [number, number, number];
    }) => {
      const controls = controlsRef.current;
      if (!controls) return;
      camera.position.set(next.home[0], next.home[1], next.home[2]);
      controls.target.set(next.target[0], next.target[1], next.target[2]);
      if (homeFov !== null) setFov(camera, homeFov);
      controls.update();
    },
    [camera, homeFov],
  );

  const readView = useCallback((): ViewerViewPose | null => {
    const controls = controlsRef.current;
    const fovDeg = fovOf(camera);
    if (!controls || fovDeg === null) return null;
    const p = camera.position;
    const t = controls.target;
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], fovDeg };
  }, [camera]);

  const writeView = useCallback(
    (next: ViewerViewPose) => {
      const controls = controlsRef.current;
      if (!controls) return;
      camera.position.set(...next.position);
      controls.target.set(...next.target);
      setFov(camera, next.fovDeg);
      controls.update();
    },
    [camera],
  );

  /** 카메라 시점 보기를 끝낸다(맞음·이동·마커 숨김을 푼다). 클릭 전 시점은 forget 일 때만 잊는다. */
  const endCameraView = useCallback(
    (forget: boolean) => {
      flight.current = null;
      expected.current = null;
      if (forget) beforeCameraView.current = null;
      store.getState().setAlignedCamera(null);
      store.getState().setCameraViewId(null);
    },
    [store],
  );

  const startFlight = useCallback(
    (to: ViewerViewPose, cameraId: string | null) => {
      const controls = controlsRef.current;
      if (!controls) return;
      settleOrbit(controls);
      const from = readView();
      if (!from) return;
      flight.current = {
        from,
        to,
        elapsedMs: 0,
        durationMs: prefersReducedMotion() ? 0 : CAMERA_VIEW_MOVE_MS,
        cameraId,
      };
      expected.current = from;
      store.getState().setAlignedCamera(null);
    },
    [readView, store],
  );

  const goHome = useCallback(() => {
    savedPose.current = null;
    applyView(store.getState().topView ? topView : view);
  }, [applyView, store, topView, view]);

  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (!state.focus || state.focus === prev.focus) return;
        const controls = controlsRef.current;
        const object = scene.getObjectByName(targetKey(state.focus.target));
        if (!controls || !object) return;
        moveOrbitTo(camera.position, controls.target, focusPoint(object));
        controls.update();
      }),
    [store, scene, camera],
  );

  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (state.viewResets === prev.viewResets) return;
        // 시점 초기화는 카메라 시점 보기도 끝낸다(나가기로 돌아갈 시점을 잊는다).
        endCameraView(true);
        goHome();
      }),
    [store, goHome, endCameraView],
  );

  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (state.cameraViewRequest && state.cameraViewRequest !== prev.cameraViewRequest) {
          const { cameraId } = state.cameraViewRequest;
          const pose = state.cameraPoses.find((p) => p.cameraId === cameraId);
          if (!pose) return;
          if (!beforeCameraView.current) beforeCameraView.current = readView();
          startFlight(cameraViewPose(pose), cameraId);
          state.setCameraViewId(cameraId);
        }
        if (state.cameraViewExits !== prev.cameraViewExits) {
          const back = beforeCameraView.current;
          if (!back) return;
          // 마커 숨김은 돌아가기를 마칠 때 푼다(카메라 자리에서 출발하는 동안 마커가 시야를 가리지 않게).
          startFlight(back, null);
          beforeCameraView.current = null;
        }
      }),
    [store, readView, startFlight],
  );

  useEffect(
    () =>
      store.subscribe((state, prev) => {
        if (state.topView === prev.topView) return;
        const controls = controlsRef.current;
        if (!controls) return;
        if (state.topView) {
          savedPose.current = {
            home: [camera.position.x, camera.position.y, camera.position.z],
            target: [controls.target.x, controls.target.y, controls.target.z],
          };
          applyView(topView);
        } else {
          const restore = savedPose.current ?? view;
          savedPose.current = null;
          applyView(restore);
        }
      }),
    [store, camera, applyView, topView, view],
  );

  useEffect(() => {
    if (store.getState().topView) {
      applyView(topView);
    }
  }, [store, applyView, topView]);

  // 스캔이 사라졌다가 같은 범위로 돌아오면 다시 옮기지 않는다(보던 시점을 지키려고 새 범위일 때만 옮긴다).
  useEffect(() => {
    if (!bounds || movedForBounds.current === bounds) return;
    movedForBounds.current = bounds;
    goHome();
  }, [bounds, goHome]);

  // Canvas 가 내려가면 카메라 시점 상태를 푼다(VDT 를 켠 채 두지 않는다).
  useEffect(() => () => endCameraView(true), [endCameraView]);

  // OrbitControls 의 update(우선순위 -1) 뒤에 돈다. 그래서 사용자 조작이 반영된 시점과 마지막으로 놓은 시점을 비교할 수 있다.
  useFrame((_, delta) => {
    const last = expected.current;
    if (!last) return;
    const now = readView();
    if (!now) return;
    if (!sameView(now, last)) {
      // 사용자가 돌렸거나 다른 시점 명령(초점·위에서 보기 등)이 왔다. 이동을 멈추고 맞음을 푼다(클릭 전 시점은 기억한다).
      endCameraView(false);
      return;
    }
    const moving = flight.current;
    if (!moving) return;
    moving.elapsedMs += delta * 1000;
    const t = moving.durationMs > 0 ? Math.min(moving.elapsedMs / moving.durationMs, 1) : 1;
    const next = t >= 1 ? moving.to : interpolateView(moving.from, moving.to, t);
    writeView(next);
    expected.current = next;
    if (t < 1) return;
    flight.current = null;
    if (moving.cameraId) {
      store.getState().setAlignedCamera(moving.cameraId);
    } else {
      expected.current = null;
      store.getState().setCameraViewId(null);
    }
  });

  return <OrbitControls ref={controlsRef} makeDefault target={initialTarget} />;
}
