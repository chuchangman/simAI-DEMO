import { Box3, Vector3, type Object3D } from 'three';

/** 대상의 중심. 형상이 없으면 객체의 World 위치를 쓴다. 렌더 전에 옮긴 부모도 반영하도록 행렬을 먼저 갱신한다. */
export function focusPoint(object: Object3D): Vector3 {
  object.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(object);
  return box.isEmpty() ? object.getWorldPosition(new Vector3()) : box.getCenter(new Vector3());
}

/** 시점의 방향과 거리를 그대로 두고 회전 중심만 대상으로 옮긴다. camera·orbitTarget 을 직접 바꾼다. */
export function moveOrbitTo(camera: Vector3, orbitTarget: Vector3, point: Vector3): void {
  const offset = camera.clone().sub(orbitTarget);
  orbitTarget.copy(point);
  camera.copy(point).add(offset);
}
