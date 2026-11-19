import type { PointerEvent } from 'react';

// 2D 평면 층이 함께 쓰는 그리기 값. 단위는 m(SVG 사용자 단위)이고 색은 토큰 클래스만 쓴다.

/** 등급 색 고리·채움(위험 빨강, 경고 주황, 주의 노랑). */
export const RING_TONE = {
  critical: 'fill-sev-critical/15 stroke-sev-critical',
  high: 'fill-sev-high/15 stroke-sev-high',
  caution: 'fill-sev-caution/15 stroke-sev-caution',
} as const;

/** 확인 대기 점멸. 움직임 줄이기 설정이면 멈추므로 선 굵기도 함께 키운다. */
export const ALARM_BLINK = 'motion-safe:animate-alarm-blink';

/** 대상마다 말풍선 머무름 핸들러를 붙인다(useDwell 의 on). */
export type Bind = (key: string) => {
  onPointerEnter: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerLeave: () => void;
};
