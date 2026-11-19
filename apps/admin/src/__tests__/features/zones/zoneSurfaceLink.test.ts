import { zoneOf } from '@/__tests__/features/zones/zoneFixture';
import type { SurfaceGeometry } from '@/features/surfaces/types';
import { linkSurfaces, pickedSurface } from '@/features/zones/zoneSurfaceLink';
import { describe, expect, it } from 'vitest';

const surfaceOf = (objectId: string, zoneId: string | null) => ({ objectId, zoneId });

const geometryAt = (cx: number, cy: number): SurfaceGeometry => ({
  centerXy: [cx, cy],
  sizeXy: [1, 1],
  yawRad: 0,
  topHeightM: 0.4,
});

describe('linkSurfaces(서버가 작업면에 저장한 zone_id 로 잇는다)', () => {
  const a = zoneOf({ zoneId: 'z-a', name: 'A', min: [0, 0, 0], max: [4, 4, 2] });
  const b = zoneOf({ zoneId: 'z-b', name: 'B', min: [6, 6, 0], max: [8, 8, 2] });

  it('작업면의 zoneId 가 가리키는 구역에 잇는다', () => {
    const ws1 = surfaceOf('ws-1', 'z-a');
    const ws2 = surfaceOf('ws-2', 'z-b');
    const links = linkSurfaces([a, b], [ws1, ws2]);
    expect([...links.keys()]).toEqual(['z-a', 'z-b']);
    expect(links.get('z-a')).toBe(ws1);
    expect(links.get('z-b')).toBe(ws2);
  });

  it('지금 구역에 없는(보관된) 구역 ID 에 걸린 작업면은 거른다', () => {
    const links = linkSurfaces([a], [surfaceOf('ws-1', 'z-a'), surfaceOf('ws-2', 'z-archived')]);
    expect([...links.keys()]).toEqual(['z-a']);
    expect(links.get('z-a')?.objectId).toBe('ws-1');
    expect(linkSurfaces([a], [surfaceOf('ws-2', 'z-archived')]).size).toBe(0);
  });

  it('zoneId 가 null 인 작업면은 어느 구역에도 잇지 않는다', () => {
    expect(linkSurfaces([a, b], [surfaceOf('ws-1', null)]).size).toBe(0);
  });

  it('한 구역에 작업면이 둘 이상 걸리면 작업면 ID 순으로 첫 번째만 잇는다(입력 순서와 무관)', () => {
    const ws1 = surfaceOf('ws-1', 'z-a');
    const ws2 = surfaceOf('ws-2', 'z-a');
    for (const surfaces of [
      [ws2, ws1],
      [ws1, ws2],
    ]) {
      const links = linkSurfaces([a], surfaces);
      expect(links.size).toBe(1);
      expect(links.get('z-a')).toBe(ws1);
    }
  });

  it('구역이 겹치거나 작업면 위치가 구역 밖이어도 기하가 아니라 zoneId 만 본다', () => {
    const inner = zoneOf({ zoneId: 'z-inner', name: '안', min: [1, 1, 0], max: [3, 3, 2] });
    // 중심은 안쪽 구역 안(a·inner 모두 포함)이지만 zoneId 는 바깥 구역이다
    const inside = { ...surfaceOf('ws-1', 'z-a'), geometry: geometryAt(2, 2) };
    expect([...linkSurfaces([a, inner], [inside]).keys()]).toEqual(['z-a']);
    // 중심이 어느 구역 안에도 없지만 zoneId 가 있으면 잇는다
    const outside = { ...surfaceOf('ws-2', 'z-b'), geometry: geometryAt(20, 20) };
    expect([...linkSurfaces([a, b], [outside]).keys()]).toEqual(['z-b']);
    // 중심이 구역 안에 있어도 zoneId 가 null 이면 잇지 않는다
    const unlinked = { ...surfaceOf('ws-3', null), geometry: geometryAt(2, 2) };
    expect(linkSurfaces([a, inner], [unlinked]).size).toBe(0);
  });

  it('구역이나 작업면이 없으면 빈 연결이다', () => {
    expect(linkSurfaces([], [surfaceOf('ws-1', 'z-a')]).size).toBe(0);
    expect(linkSurfaces([a], []).size).toBe(0);
  });
});

describe('pickedSurface(3D 에서 고른 작업면)', () => {
  const a = zoneOf({ zoneId: 'z-a', name: 'A', min: [0, 0, 0], max: [4, 4, 2] });
  const linkedSurface = surfaceOf('ws-1', 'z-a');
  const orphanSurface = surfaceOf('ws-2', null);
  const archivedSurface = surfaceOf('ws-3', 'z-archived');
  const secondSurface = surfaceOf('ws-4', 'z-a');
  const surfaces = [linkedSurface, orphanSurface, archivedSurface, secondSurface];
  const links = linkSurfaces([a], surfaces);
  const pick = (objectId: string | null) => pickedSurface(objectId, surfaces, links);

  it('이어진 작업면이면 그 구역을 알리고 orphan 은 비어 있다', () => {
    expect(pick('ws-1')).toEqual({ zoneId: 'z-a', orphan: null });
  });

  it('구역에 이어지지 않았거나 보관된 구역에만 걸린 작업면이면 orphan 이다', () => {
    expect(pick('ws-2')).toEqual({ zoneId: null, orphan: orphanSurface });
    expect(pick('ws-3')).toEqual({ zoneId: null, orphan: archivedSurface });
  });

  it('한 구역의 둘째 작업면은 구역 화면에서 닿을 수 없어 orphan 이다', () => {
    expect(pick('ws-4')).toEqual({ zoneId: null, orphan: secondSurface });
  });

  it('모르는 작업면이거나 고른 것이 없으면 둘 다 비어 있다', () => {
    const none = { zoneId: null, orphan: null };
    expect(pick('ob-1')).toEqual(none);
    expect(pick(null)).toEqual(none);
  });
});
