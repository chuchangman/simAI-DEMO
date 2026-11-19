import { labelCapPx, liftToClear } from '@/features/viewer3d/LabelSprite';
import { describe, expect, it } from 'vitest';

// 3D 이름표 화면 크기 상한·겹침 밀어내기(S15P31A101-757).
const rect = (seq: number, x: number, y: number, w = 100, h = 30) => ({
  seq,
  x,
  y,
  w,
  h,
  at: 0,
});

describe('이름표 화면 크기 상한', () => {
  it('글자 높이에 비례하되 22~60px 안이다', () => {
    expect(labelCapPx(0.24)).toBeCloseTo(36);
    expect(labelCapPx(0.01)).toBe(22);
    expect(labelCapPx(5)).toBe(60);
  });
});

describe('이름표 겹침 밀어내기', () => {
  it('겹치지 않으면 올리지 않는다', () => {
    expect(liftToClear(rect(2, 100, 200), [rect(1, 400, 200)])).toBe(0);
    expect(liftToClear(rect(2, 100, 200), [rect(1, 100, 100)])).toBe(0);
  });

  it('먼저 온 이름표와 겹치면 그 위로 올린다', () => {
    const lift = liftToClear(rect(2, 100, 200), [rect(1, 110, 205)]);
    // 먼저 온 이름표의 위쪽 끝(190)에서 간격 3 을 두고 그 위로 올린다.
    expect(lift).toBeGreaterThanOrEqual(28);
    expect(liftToClear(rect(2, 100, 200 - lift), [rect(1, 110, 205)])).toBe(0);
  });

  it('나중에 온 이름표는 기준이 아니다', () => {
    expect(liftToClear(rect(1, 100, 200), [rect(2, 100, 200)])).toBe(0);
  });
});
