import { measure, type FloatBox } from '@/lib/floatSpot';
import { useEffect, type RefObject } from 'react';
import { create } from 'zustand';

/** 창을 놓거나 크기 바꾸기를 멈춘 뒤 이만큼(ms) 지나 자리를 알린다(바뀌는 동안 이벤트 패널이 따라 흔들리지 않게). */
export const CCTV_BOX_SETTLE_MS = 150;

interface CctvFloatBoxState {
  /** 떠 있는 CCTV 창의 자리·크기(관제 장면 기준 px). 창이 없으면 null. */
  box: FloatBox | null;
}

// 떠 있는 CCTV 창(features/cctv)이 자리를 알리고, 이벤트 패널(features/events)이 그 자리를 비켜 선다.
export const useCctvFloatBoxStore = create<CctvFloatBoxState>()(() => ({ box: null }));

/** 떠 있는 CCTV 창의 자리(없으면 null). */
export const useCctvFloatBox = () => useCctvFloatBoxStore((s) => s.box);

const sameBox = (a: FloatBox | null, b: FloatBox | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height);

/** 같은 자리면 바꾸지 않는다(구독하는 패널이 다시 그려지지 않게). */
const publish = (box: FloatBox | null) =>
  useCctvFloatBoxStore.setState((state) => (sameBox(state.box, box) ? state : { box }));

interface CctvFloatLayout {
  /** 창을 끄는 중이면 알리지 않는다(놓은 뒤에 알린다). */
  dragging: boolean;
  /** 접어 머리줄만 남은 창은 영상이 없으니 비켜 서지 않게 비운다. */
  collapsed: boolean;
  /** 창의 자리·크기. 바뀌면 다시 잰다. */
  layoutKey: string;
}

/**
 * 떠 있는 CCTV 창의 자리를 알린다. 끄는 동안은 알리지 않고, 자리·크기·접힘이 바뀌고 나서 CCTV_BOX_SETTLE_MS 뒤에
 * 잰 자리를 알린다(접혔으면 비운다). 창이 닫히면(내려가면) 비운다.
 */
export function useReportCctvFloatBox(
  target: RefObject<HTMLElement | null>,
  { dragging, collapsed, layoutKey }: CctvFloatLayout,
) {
  useEffect(() => {
    if (dragging) return undefined;
    const timer = setTimeout(
      () => publish(collapsed ? null : (measure(target.current)?.box ?? null)),
      CCTV_BOX_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [target, dragging, collapsed, layoutKey]);
  useEffect(() => () => publish(null), []);
}
