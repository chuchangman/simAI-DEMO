import {
  measure,
  moveSpot,
  spotStyle,
  type FloatAnchor,
  type FloatBounds,
  type FloatBox,
  type FloatMargin,
  type FloatSpot,
} from '@/lib/floatSpot';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/** 이만큼(px) 넘게 움직여야 끌기로 본다. 그보다 작은 움직임은 그냥 누르는 것이다. */
export const DRAG_THRESHOLD_PX = 4;

interface Press {
  x: number;
  y: number;
}

interface Drag extends Press {
  start: FloatBox;
  bounds: FloatBounds;
}

/**
 * 떠 있는 상자(target)를 끌어 옮긴다. 손잡이(또는 몸통)에 handlers 를 붙이면, 누른 채 DRAG_THRESHOLD_PX 넘게 움직일
 * 때부터 끌기이고 놓은 뒤 따라 나오는 click 은 삼킨다(끌기가 누르기로 바뀌지 않게). 옮기기 전에는 style 이 비어
 * 클래스의 기본 자리를 쓴다. 창이나 상자의 크기가 바뀌면 옮긴 자리를 화면 안으로 다시 맞춘다(refit 으로 바로 맞출 수도 있다).
 */
export function useFloatSpot(
  target: RefObject<HTMLElement | null>,
  anchor: FloatAnchor,
  margin: FloatMargin,
  initialSpot: FloatSpot | null = null,
  onSpotChange?: (spot: FloatSpot) => void,
) {
  const [spot, setSpot] = useState<FloatSpot | null>(initialSpot);
  const [dragging, setDragging] = useState(false);
  const press = useRef<Press | null>(null);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);

  const place = (d: Drag, x: number, y: number) =>
    setSpot(moveSpot(d.start, x - d.x, y - d.y, d.bounds, margin, anchor));
  const begin = (down: Press, e: ReactPointerEvent<HTMLElement>) => {
    const now = measure(target.current);
    if (!now) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { ...down, start: now.box, bounds: now.bounds };
    setDragging(true);
  };
  /** 눌러 둔 곳에서 임계값을 넘게 움직였으면 끌기를 시작한다. */
  const beginIfMoved = (e: ReactPointerEvent<HTMLElement>) => {
    const down = press.current;
    if (!down) return;
    // 상자 밖에서 버튼을 놓아 pointerup 을 못 받았으면 눌린 기록을 버린다(안 눌렀는데 끌려가지 않게).
    if (e.buttons === 0) {
      press.current = null;
      return;
    }
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= DRAG_THRESHOLD_PX) return;
    begin(down, e);
  };
  const end = () => {
    press.current = null;
    drag.current = null;
    setDragging(false);
  };

  /** 옮긴 자리를 지금 상자·부모 크기에 맞춰 화면 안으로 다시 맞춘다. 옮기지 않았으면 아무것도 하지 않는다. */
  const refit = useCallback(() => {
    const now = measure(target.current);
    if (!now) return;
    setSpot((prev) => (prev ? moveSpot(now.box, 0, 0, now.bounds, margin, anchor) : prev));
  }, [target, margin, anchor]);

  const placed = spot !== null;
  useEffect(() => {
    if (spot) onSpotChange?.(spot);
  }, [spot, onSpotChange]);
  useEffect(() => {
    if (!placed) return undefined;
    window.addEventListener('resize', refit);
    // 옮긴 뒤 상자 크기가 바뀌어도(창 크기를 바꾸면) 화면 밖으로 넘치지 않게 한다.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit);
    if (target.current) observer?.observe(target.current);
    return () => {
      window.removeEventListener('resize', refit);
      observer?.disconnect();
    };
  }, [placed, target, refit]);

  return {
    style: spot ? spotStyle(spot, anchor) : undefined,
    dragging,
    reset: () => setSpot(null),
    refit,
    handlers: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        swallowClick.current = false;
        press.current = { x: e.clientX, y: e.clientY };
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        if (!drag.current) beginIfMoved(e);
        if (drag.current) place(drag.current, e.clientX, e.clientY);
      },
      // 놓아서 끝난 끌기만 뒤따르는 click 을 삼킨다. 브라우저가 끌기를 거둔 경우(취소·캡처 잃음)에는 click 이 없다.
      onPointerUp: () => {
        swallowClick.current = drag.current !== null;
        end();
      },
      onPointerCancel: end,
      onLostPointerCapture: end,
      onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
        const swallow = swallowClick.current;
        swallowClick.current = false;
        // 키보드로 누른 클릭(detail 0)은 끌기가 낳은 클릭이 아니다.
        if (!swallow || e.detail === 0) return;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}
