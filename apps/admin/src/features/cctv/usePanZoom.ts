import {
  IDENTITY_VIEW,
  isZoomed,
  panBy,
  viewForKey,
  wheelFactor,
  zoomAt,
  type PanZoomPoint,
  type PanZoomView,
} from '@/features/cctv/panZoom';
import { DRAG_THRESHOLD_PX } from '@/hooks/useFloatSpot';
import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

interface Gesture {
  /** 누른 자리와 마지막으로 옮긴 포인터 위치(px). */
  start: PanZoomPoint;
  last: PanZoomPoint;
  dragging: boolean;
}

/** 칸 안의 한 점을 칸 폭·높이에 대한 비율로. 칸이 보이지 않으면(크기 0) undefined 다. */
function pointInBox(box: DOMRect, clientX: number, clientY: number): PanZoomPoint | undefined {
  if (box.width === 0 || box.height === 0) return undefined;
  return { x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height };
}

/**
 * 영상 칸 하나의 디지털 확대·이동. 칸 뿌리 요소에 ref 와 handlers 를 붙인다.
 * 휠은 포인터 밑을 기준으로 확대하고, 확대 중에는 누른 채 DRAG_THRESHOLD_PX 넘게 움직여 옮긴다. 확대 전의 누르기와
 * 움직이지 않은 누르기는 그대로 클릭이고, 끌어서 옮긴 뒤 따라 나오는 click 은 삼킨다(칸 크게 보기가 켜지지 않게).
 * + - 0 과 화살표 키는 칸에 포커스가 있을 때만 듣는다(브라우저 확대 키 Ctrl/Cmd 조합은 건드리지 않는다).
 */
export function usePanZoom() {
  const [view, setView] = useState<PanZoomView>(IDENTITY_VIEW);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);
  const zoomed = isZoomed(view);

  // React 의 onWheel 은 passive 라 페이지 스크롤을 막을 수 없어 직접 붙인다.
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const point = pointInBox(element.getBoundingClientRect(), e.clientX, e.clientY);
      if (point) setView((now) => zoomAt(now, point, wheelFactor(e.deltaY, e.deltaMode)));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const startDrag = (g: Gesture, e: ReactPointerEvent<HTMLElement>) => {
    g.dragging = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const dragTo = (g: Gesture, e: ReactPointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - g.last.x) / box.width;
    const dy = (e.clientY - g.last.y) / box.height;
    if (Number.isFinite(dx) && Number.isFinite(dy)) setView((now) => panBy(now, dx, dy));
  };
  const endGesture = () => {
    gesture.current = null;
    setDragging(false);
  };

  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      swallowClick.current = false;
      const start = { x: e.clientX, y: e.clientY };
      gesture.current = { start, last: start, dragging: false };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || !zoomed) return;
      // 칸 밖에서 버튼을 놓아 pointerup 을 못 받았으면 눌린 기록을 버린다(안 눌렀는데 끌려가지 않게).
      if (e.buttons === 0) {
        gesture.current = null;
        return;
      }
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) <= DRAG_THRESHOLD_PX) return;
        startDrag(g, e);
      }
      dragTo(g, e);
      g.last = { x: e.clientX, y: e.clientY };
    },
    // 끌어서 끝난 누르기만 뒤따르는 click 을 삼킨다. 브라우저가 끌기를 거둔 경우(취소·캡처 잃음)에는 click 이 없다.
    onPointerUp: () => {
      swallowClick.current = gesture.current?.dragging ?? false;
      endGesture();
    },
    onPointerCancel: endGesture,
    onLostPointerCapture: endGesture,
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      const swallow = swallowClick.current;
      swallowClick.current = false;
      // 키보드로 누른 클릭(detail 0)은 끌기가 낳은 클릭이 아니다.
      if (!swallow || e.detail === 0) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const box = e.currentTarget.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const next = viewForKey(view, e.key, box);
      if (!next) return;
      e.preventDefault();
      setView(next);
    },
  };

  return { ref, view, zoomed, dragging, handlers };
}
