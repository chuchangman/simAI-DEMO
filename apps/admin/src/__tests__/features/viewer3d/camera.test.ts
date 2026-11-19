import { focusPoint, moveOrbitTo } from '@/features/viewer3d/camera';
import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

describe('focusPoint', () => {
  it('형상이 있으면 경계 상자의 중심을 쓴다', () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    mesh.position.set(3, 1, -4);
    mesh.updateMatrixWorld();
    expect(focusPoint(mesh).toArray()).toEqual([3, 1, -4]);
  });

  it('형상이 없으면 객체의 World 위치를 쓴다', () => {
    const parent = new Group();
    parent.position.set(1, 0, 0);
    const child = new Group();
    child.position.set(0, 2, 0);
    parent.add(child);
    parent.updateMatrixWorld();
    expect(focusPoint(child).toArray()).toEqual([1, 2, 0]);
  });

  it('렌더 전에 부모를 옮겨도 옮긴 위치를 쓴다', () => {
    const parent = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    parent.add(mesh);
    parent.updateMatrixWorld();
    // 장면이 아직 다시 그려지지 않아 행렬이 옛 값인 상태.
    parent.position.set(-3, 0.5, 2);
    expect(focusPoint(mesh).toArray()).toEqual([-3, 0.5, 2]);
  });
});

describe('moveOrbitTo', () => {
  it('회전 중심을 대상으로 옮기고 카메라의 방향·거리는 그대로 둔다', () => {
    const camera = new Vector3(8, 8, 8);
    const orbitTarget = new Vector3(0, 0, 0);
    moveOrbitTo(camera, orbitTarget, new Vector3(2, 0, -3));
    expect(orbitTarget.toArray()).toEqual([2, 0, -3]);
    expect(camera.toArray()).toEqual([10, 8, 5]);
  });
});
