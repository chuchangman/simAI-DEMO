import {
  CCTV_CAMS,
  CCTV_H,
  CCTV_W,
  cctvFigures,
  cctvLine,
  cctvPath,
  cctvPeople,
  cctvProj,
} from '@/features/cctv/cctvMockView';
import { ROOM, toPlan } from '@/features/plan/plan';
import { describe, expect, it } from 'vitest';

const cam_A = CCTV_CAMS.find((cam) => cam.id === 'cam_A')!;
const center = { x: ROOM.width / 2, y: ROOM.depth / 2 };

describe('CCTV 모의 화면 투영', () => {
  it('카메라 앞의 점은 화면 안에 투영한다', () => {
    const p = cctvProj(cam_A)(3, 3, 1)!;
    expect(p).not.toBeNull();
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(CCTV_W);
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(CCTV_H);
    expect(p.d).toBeGreaterThan(0);
  });

  it('카메라 뒤의 점은 null 이다', () => {
    expect(cctvProj(cam_A)(cam_A.x - 3, cam_A.y - 3, 0)).toBeNull();
  });

  it('모서리 카메라 네 대 모두 방 가운데를 화면 가운데 가까이에 본다', () => {
    expect(CCTV_CAMS.map((cam) => cam.id)).toEqual(['cam_A', 'cam_B', 'cam_C', 'cam_D']);
    for (const cam of CCTV_CAMS) {
      const p = cctvProj(cam)(center.x, center.y, 0)!;
      expect(p.x).toBeCloseTo(CCTV_W / 2, 5);
      expect(Math.abs(p.y - CCTV_H / 2)).toBeLessThan(CCTV_H / 10);
    }
  });

  it('경로는 카메라 뒤 점에서 끊고 다음 점부터 다시 긋는다', () => {
    const project = cctvProj(cam_A);
    const path = cctvPath(project, [
      [2, 2],
      [3, 3],
      [cam_A.x - 3, cam_A.y - 3],
      [4, 4],
      [5, 5],
    ]);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path.match(/L/g)).toHaveLength(2);
    const line = cctvLine(project, 0, 0, ROOM.width, 0, 0, 4);
    expect(line.match(/M/g)).toHaveLength(1);
    expect(line.match(/L/g)).toHaveLength(4);
  });

  it('사람은 먼 사람부터 그리고 카메라 뒤 사람은 뺀다', () => {
    const figures = cctvFigures(cctvProj(cam_A), [
      { id: 'near', x: 2, y: 2 },
      { id: 'behind', x: cam_A.x - 3, y: cam_A.y - 3 },
      { id: 'far', x: 8, y: 8 },
    ]);
    expect(figures.map((f) => f.id)).toEqual(['far', 'near']);
    const [far, near] = figures;
    expect(near!.body.height).toBeGreaterThan(far!.body.height);
    // 머리는 몸통 위에 있다.
    expect(near!.head.cy).toBeLessThan(near!.body.y + near!.body.height);
  });

  it('World 트랙을 평면 좌표의 사람으로 바꾸고, 위치를 모르는 사람(LOST·UNKNOWN)은 뺀다', () => {
    const track = (
      world_id: string,
      observation_state: 'OBSERVED' | 'PREDICTED' | 'UNKNOWN',
      track_lifecycle: 'CONFIRMED' | 'LOST',
    ) => ({
      world_id,
      position_xy: [2, 7] as [number, number],
      observation_state,
      track_lifecycle,
    });
    const [x, y] = toPlan(2, 7);
    expect(
      cctvPeople([
        track('w-1', 'OBSERVED', 'CONFIRMED'),
        track('w-2', 'PREDICTED', 'CONFIRMED'),
        track('w-3', 'UNKNOWN', 'CONFIRMED'),
        track('w-4', 'OBSERVED', 'LOST'),
      ]),
    ).toEqual([
      { id: 'w-1', x, y },
      { id: 'w-2', x, y },
    ]);
  });
});
