import type { FloatBounds, FloatBox, Measured } from '@/lib/floatSpot';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

interface Drag {
  x: number;
  y: number;
  start: FloatBox;
  bounds: FloatBounds;
}

/** 누른 채 끄는 동안 시작 자리에서 움직인 만큼 onMove 를 부른다. 안의 버튼(접기)은 끌기로 잡지 않는다. */
export function usePanelDrag(
  startOf: () => Measured,
  onMove: (start: FloatBox, dx: number, dy: number, bounds: FloatBounds) => void,
) {
  const drag = useRef<Drag | null>(null);
  const [active, setActive] = useState(false);
  const end = () => {
    drag.current = null;
    setActive(false);
  };
  return {
    active,
    handlers: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
        const now = startOf();
        if (!now) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, start: now.box, bounds: now.bounds };
        setActive(true);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (d) onMove(d.start, e.clientX - d.x, e.clientY - d.y, d.bounds);
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}
