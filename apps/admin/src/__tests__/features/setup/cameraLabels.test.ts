import {
  cameraLabel,
  cameraNumber,
  cameraShortLabel,
  isNeighborPair,
  neighborPairs,
  pairLabel,
} from '@/features/setup/cameraLabels';
import { describe, expect, it } from 'vitest';

const CAMERA_IDS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
const LEGACY_IDS = ['cam1', 'cam2', 'cam3', 'cam4'];

describe('세팅 화면 카메라 이름', () => {
  it('id 종류와 상관없이 목록 순서로 이름을 만든다', () => {
    expect(cameraLabel(CAMERA_IDS, 'cam_C')).toBe('카메라 3');
    expect(cameraShortLabel(CAMERA_IDS, 'cam_D')).toBe('카메라 4');
    expect(pairLabel(CAMERA_IDS, 'cam_B', 'cam_C')).toBe('카메라 2–카메라 3');
    expect(cameraLabel(LEGACY_IDS, 'cam3')).toBe('카메라 3');
  });

  it('목록에 없는 id 는 번호 없이 표시하고 번호는 null 이다', () => {
    expect(cameraNumber(CAMERA_IDS, 'cam9')).toBeNull();
    expect(cameraLabel(CAMERA_IDS, 'cam9')).toBe('카메라');
    expect(cameraShortLabel(CAMERA_IDS, 'cam9')).toBe('카메라');
    expect(pairLabel(CAMERA_IDS, 'cam_A', 'cam9')).toBe('카메라 1–카메라');
  });
});

describe('옆 카메라 쌍 판정', () => {
  it('모서리를 도는 순서의 이웃(1–2, 2–3, 3–4, 4–1)은 어느 쪽 순서로 물어도 참이다', () => {
    for (const [a, b] of [
      ['cam_A', 'cam_B'],
      ['cam_B', 'cam_C'],
      ['cam_C', 'cam_D'],
      ['cam_D', 'cam_A'],
    ] as const) {
      expect(isNeighborPair(CAMERA_IDS, a, b)).toBe(true);
      expect(isNeighborPair(CAMERA_IDS, b, a)).toBe(true);
    }
    expect(isNeighborPair(LEGACY_IDS, 'cam4', 'cam1')).toBe(true);
  });

  it('마주 보는 쌍·같은 카메라·목록에 없는 id 는 거짓이다', () => {
    expect(isNeighborPair(CAMERA_IDS, 'cam_A', 'cam_C')).toBe(false);
    expect(isNeighborPair(CAMERA_IDS, 'cam_D', 'cam_B')).toBe(false);
    expect(isNeighborPair(CAMERA_IDS, 'cam_B', 'cam_B')).toBe(false);
    expect(isNeighborPair(CAMERA_IDS, 'cam_A', 'cam9')).toBe(false);
  });

  it('옆 카메라 쌍만 카메라 순서대로 돌려주고 마주 보는 쌍은 뺀다', () => {
    expect(neighborPairs(CAMERA_IDS)).toEqual([
      { a: 'cam_A', b: 'cam_B' },
      { a: 'cam_A', b: 'cam_D' },
      { a: 'cam_B', b: 'cam_C' },
      { a: 'cam_C', b: 'cam_D' },
    ]);
    expect(neighborPairs(LEGACY_IDS)).toHaveLength(4);
    expect(neighborPairs([])).toEqual([]);
  });
});
