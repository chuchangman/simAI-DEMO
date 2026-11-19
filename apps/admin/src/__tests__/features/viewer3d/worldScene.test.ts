import {
  CAMERAS,
  fixtureBox,
  fixtureFeet,
  OBJECTS,
  PEOPLE,
  ZONES,
} from '@/features/viewer3d/dev-harness/mockUi';
import { roomViewOf } from '@/features/viewer3d/scene/roomView';
import {
  threeToWorld,
  toThreePoint,
  worldPoint,
  worldToThree,
} from '@/features/viewer3d/worldCoordinates';
import { WORLD_REFERENCE_POINTS } from '@/features/viewer3d/WorldReference';
import { DEMO_ROOM, FLOOR_ROTATION_X, roomLayout } from '@/features/viewer3d/WorldScene';
import { DEFAULT_ROOM_LIMIT, roomLimitFrom } from '@/lib/roomLimit';
import { Mesh, PlaneGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

// 부동소수 잔차(1e-16 수준)를 지우고 -0 을 0 으로 맞춰 비교한다.
const clean = (values: readonly number[]) => values.map((n) => Math.round(n * 1e9) / 1e9 + 0);
const toWorld = (v: Vector3) => clean(threeToWorld(toThreePoint(v.toArray())!));

describe('World 교실 배치', () => {
  it('DEMO 교실은 World 원점 모서리에서 X·Y 0~10m, 바닥 Z=0 이다', () => {
    const layout = roomLayout(DEMO_ROOM)!;
    expect(layout.floor.position).toEqual([5, 0, -5]);
    expect(layout.floor.size).toEqual([10, 10]);
    expect(clean(layout.walls.position)).toEqual([5, 0.55, -5]);
    expect(layout.walls.size).toEqual([10, 1.1, 10]);
  });

  it('돌려 놓은 바닥 꼭짓점이 World 모서리 네 곳이고 윗면이 World +Z 를 본다', () => {
    const layout = roomLayout(DEMO_ROOM)!;
    const floor = new Mesh(new PlaneGeometry(...layout.floor.size));
    floor.rotation.x = FLOOR_ROTATION_X;
    floor.position.fromArray(layout.floor.position);
    floor.updateMatrixWorld();

    const position = floor.geometry.getAttribute('position');
    const corners = Array.from({ length: position.count }, (_, i) =>
      toWorld(new Vector3().fromBufferAttribute(position, i).applyMatrix4(floor.matrixWorld)),
    );
    expect(corners).toHaveLength(4);
    expect(corners).toEqual(
      expect.arrayContaining([
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [10, 10, 0],
      ]),
    );

    const normal = new Vector3(0, 0, 1).transformDirection(floor.matrixWorld);
    expect(toWorld(normal)).toEqual([0, 0, 1]);
  });

  it('바닥 회전은 worldToThree 와 같은 변환이다(로컬 u·v → World X·Y)', () => {
    const floor = new Mesh(new PlaneGeometry(1, 1));
    floor.rotation.x = FLOOR_ROTATION_X;
    floor.updateMatrixWorld();
    const local = new Vector3(2, 3, 0).applyMatrix4(floor.matrixWorld);
    expect(clean(local.toArray())).toEqual(worldToThree(worldPoint(2, 3, 0)));
  });

  it.each([
    ['0', { ...DEMO_ROOM, sizeX: 0 }],
    ['음수', { ...DEMO_ROOM, sizeY: -1 }],
    ['NaN', { ...DEMO_ROOM, wallHeight: Number.NaN }],
    ['무한대', { ...DEMO_ROOM, sizeX: Number.POSITIVE_INFINITY }],
  ])('크기가 %s 이면 그리지 않는다', (_, room) => {
    expect(roomLayout(room)).toBeNull();
  });
});

describe('처음 시점(roomViewOf)', () => {
  it('스캔이 없으면 예전 처음 시점과 같다(방 가운데 (5, 5, 0) 을 앞·오른쪽 10m 위에서 본다)', () => {
    const view = roomViewOf(DEFAULT_ROOM_LIMIT);
    expect(view.target).toEqual(worldToThree(worldPoint(5, 5, 0)));
    expect(view.home).toEqual(worldToThree(worldPoint(15, -5, 10)));
  });

  it('스캔이 있으면 스캔 범위 가운데 바닥을 보고 거리는 긴 변에 비례한다', () => {
    const scan = { min: [2, 1, -0.1], max: [6, 9, 3] } as const;
    const view = roomViewOf(roomLimitFrom(scan));
    // 가운데 (4, 5), 긴 변 8m(y) → 앞·오른쪽·위로 8m.
    expect(view.target).toEqual(worldToThree(worldPoint(4, 5, 0)));
    expect(view.home).toEqual(worldToThree(worldPoint(12, -3, 8)));
  });

  it('쓸 수 없는 스캔(한 변 0.2m·NaN)이면 목업 시점이라 카메라가 가운데에 붙거나 사라지지 않는다', () => {
    const mock = roomViewOf(DEFAULT_ROOM_LIMIT);
    expect(roomViewOf(roomLimitFrom({ min: [0, 0, 0], max: [0.2, 0.2, 3] }))).toEqual(mock);
    expect(roomViewOf(roomLimitFrom({ min: [0, 0, 0], max: [Number.NaN, 5, 3] }))).toEqual(mock);
  });

  it('범위가 두 배면 카메라가 가운데에서 두 배 멀어진다', () => {
    const near = roomViewOf(roomLimitFrom({ min: [0, 0, 0], max: [5, 5, 3] }));
    const far = roomViewOf(roomLimitFrom({ min: [0, 0, 0], max: [10, 10, 3] }));
    const distance = (v: ReturnType<typeof roomViewOf>) =>
      new Vector3(...v.home).distanceTo(new Vector3(...v.target));
    expect(distance(far) / distance(near)).toBeCloseTo(2, 9);
  });
});

describe('World 기준점', () => {
  it('원점과 ±X·±Y·±Z 1m 가 기대한 Three 위치에 놓인다', () => {
    const placed = Object.fromEntries(
      WORLD_REFERENCE_POINTS.map((p) => [p.key, clean(worldToThree(p.world))]),
    );
    expect(placed).toEqual({
      O: [0, 0, 0],
      '+X': [1, 0, 0],
      '-X': [-1, 0, 0],
      '+Y': [0, 0, -1],
      '-Y': [0, 0, 1],
      '+Z': [0, 1, 0],
      '-Z': [0, -1, 0],
    });
    for (const p of WORLD_REFERENCE_POINTS.filter((r) => r.key !== 'O')) {
      expect(new Vector3(...worldToThree(p.world)).length()).toBe(1);
    }
  });
});

describe('사람·구역 배치 기준(예시 Fixture)', () => {
  const inRoom = ([x, y, z]: readonly number[]) =>
    x! >= 0 && x! <= DEMO_ROOM.sizeX && y! >= 0 && y! <= DEMO_ROOM.sizeY && z! >= 0;

  it('작업자 발은 World (x, y, 0) 에서 Three (x, 0, -y) 로 간다', () => {
    expect(clean(fixtureFeet(PEOPLE[0]!))).toEqual([2.4, 0, -7.2]);
    for (const person of PEOPLE) {
      expect(clean(threeToWorld(fixtureFeet(person)))).toEqual([person.x, person.y, 0]);
    }
  });

  it('구역 상자는 바닥(Z=0)부터 높이까지 서고 World 범위가 그대로 돌아온다', () => {
    const zoneA = fixtureBox(ZONES[0]!);
    expect(clean(zoneA.position)).toEqual([2, 1, -8]);
    expect(clean(zoneA.size)).toEqual([3, 2, 2.4]);

    for (const box of [...ZONES, ...OBJECTS]) {
      const { position, size } = fixtureBox(box);
      const half = new Vector3(...size).multiplyScalar(0.5);
      const a = toWorld(new Vector3(...position).sub(half));
      const b = toWorld(new Vector3(...position).add(half));
      const min = a.map((v, i) => Math.min(v, b[i]!));
      const max = a.map((v, i) => Math.max(v, b[i]!));
      expect(min).toEqual(clean([box.x - box.sizeX / 2, box.y - box.sizeY / 2, 0]));
      expect(max).toEqual(clean([box.x + box.sizeX / 2, box.y + box.sizeY / 2, box.height]));
    }
  });

  it('예시 사람·구역·작업면·카메라는 모두 DEMO 교실 안에 있다', () => {
    for (const person of PEOPLE) expect(inRoom([person.x, person.y, 0])).toBe(true);
    for (const box of [...ZONES, ...OBJECTS]) {
      expect(inRoom([box.x - box.sizeX / 2, box.y - box.sizeY / 2, 0])).toBe(true);
      expect(inRoom([box.x + box.sizeX / 2, box.y + box.sizeY / 2, box.height])).toBe(true);
    }
    for (const camera of CAMERAS) expect(inRoom([camera.x, camera.y, camera.z])).toBe(true);
  });
});
