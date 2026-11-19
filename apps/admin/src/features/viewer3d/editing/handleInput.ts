import { threeToWorld, toThreePoint, type WorldPoint } from '@/features/viewer3d/worldCoordinates';
import type { RootState } from '@react-three/fiber';
import { useEffect } from 'react';
import { Mesh, Plane, Raycaster, Vector2, Vector3, type Intersection } from 'three';

// 구역(AABB)·작업면(OBB) 손잡이가 함께 쓰는 입력 처리(S15P31A101-195·-188). 손잡이 모양과 별개로 잡는 범위와 키를 맞춘다.

/** 표시 형상과 별개로 24×24 CSS px를 잡을 수 있게 한다. */
export const HANDLE_HIT_HALF_PX = 12;
/** 평면에서 약 3도 미만인 광선은 작은 포인터 오차도 큰 World 이동으로 증폭한다. */
export const MIN_PLANE_COSINE = 0.05;
const UP = new Vector3(0, 1, 0);

/**
 * 끌기 평면을 고른다. vertical 이면 손잡이를 지나며 카메라를 마주 보는 세로 평면(높이 읽기),
 * 아니면 손잡이 높이의 수평 평면(X·Y 읽기, 그 평면에서는 높이가 바뀌지 않는다). 카메라가 거의 수직이라 세로 평면을 못 만들면 null.
 */
export function dragPlane(get: () => RootState, anchor: Vector3, vertical: boolean): Plane | null {
  const plane = new Plane();
  if (!vertical) return plane.setFromNormalAndCoplanarPoint(UP, anchor);
  const normal = get().camera.getWorldDirection(new Vector3()).setY(0);
  if (normal.lengthSq() < MIN_PLANE_COSINE ** 2) return null;
  return plane.setFromNormalAndCoplanarPoint(normal.normalize(), anchor);
}

/** 화면 좌표(client px)를 평면 위 World 점으로 읽는 함수. 평면과 거의 나란한 광선이면 null. */
export function createPlaneReader(get: () => RootState, plane: Plane) {
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  return (clientX: number, clientY: number): WorldPoint | null => {
    const { camera, gl } = get();
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (Math.abs(raycaster.ray.direction.dot(plane.normal)) < MIN_PLANE_COSINE) return null;
    const point = raycaster.ray.intersectPlane(plane, new Vector3());
    const three = point && toThreePoint([point.x, point.y, point.z]);
    return three ? threeToWorld(three) : null;
  };
}

/**
 * 손잡이 광선 판정. 형상에 맞지 않아도 화면에서 손잡이 중심 ±HANDLE_HIT_HALF_PX 안이면 맞은 것으로 친다.
 * 반환 함수는 Mesh 의 raycast 로 넘긴다(this = 손잡이 Mesh).
 */
export function createHandleRaycast(get: () => RootState) {
  return function (this: Mesh, raycaster: Raycaster, intersections: Intersection[]) {
    const count = intersections.length;
    Mesh.prototype.raycast.call(this, raycaster, intersections);
    if (intersections.length > count) return;
    const { camera, gl } = get();
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const center = this.getWorldPosition(new Vector3());
    const projected = center.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) return;
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new Vector3()),
      center,
    );
    const point = raycaster.ray.intersectPlane(plane, new Vector3());
    if (!point) return;
    const distance = point.distanceTo(raycaster.ray.origin);
    if (distance < raycaster.near || distance > raycaster.far) return;
    const pointer = point.clone().project(camera);
    if (
      (Math.abs(pointer.x - projected.x) * rect.width) / 2 <= HANDLE_HIT_HALF_PX &&
      (Math.abs(pointer.y - projected.y) * rect.height) / 2 <= HANDLE_HIT_HALF_PX
    )
      intersections.push({ distance, point, object: this });
  };
}

/**
 * 편집 중 Esc·Enter. 입력칸·버튼·링크 위에서 누른 키와 한글 조합 중인 키는 무시한다.
 */
export function useEditKeys(onEscape: () => void, onEnter: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229)
        return;
      if (
        event
          .composedPath()
          .some(
            (target) =>
              target instanceof Element &&
              target.closest(
                'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"])',
              ),
          )
      )
        return;
      if (event.key === 'Escape') onEscape();
      if (event.key === 'Enter') onEnter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, onEnter]);
}
