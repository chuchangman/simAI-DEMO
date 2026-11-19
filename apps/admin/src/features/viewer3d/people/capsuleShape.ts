// 캡슐 아바타의 치수(m, Three Y-up, 루트=발 위치). 캡슐을 그리는 PersonLayer 가 쓴다.
export const CAPSULE = {
  /** 몸통 캡슐 반지름. */
  bodyRadius: 0.2,
  /** 몸통 캡슐의 원통 길이(양 끝 반구 제외). */
  bodyLength: 1.06,
  /** 몸통 캡슐 가운데 높이. 바닥은 0.05, 위쪽 끝은 1.51 이다. */
  bodyY: 0.78,
  headRadius: 0.13,
  /** 머리 구 가운데 높이. */
  headY: 1.58,
} as const;
