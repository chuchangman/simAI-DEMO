import type { PlanTone } from '@/features/plan/plan';
import { cn } from '@simai/ui/lib/utils';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

// 지도 위 글자는 같은 대상에 0.3초 넘게 머물 때만 말풍선으로 보인다(관제 데모와 같다). 늘 떠 있는 이름표는 두지 않는다.

/** 말풍선을 띄우기까지 머무는 시간(ms). */
export const DWELL_MS = 300;
/** 포인터가 오른쪽 가장자리에서 이만큼(px) 안이면 말풍선을 포인터 왼쪽에 띄운다. */
const FLIP_EDGE_PX = 320;
/** 포인터와 말풍선 사이 가로·세로 간격(px). */
const TIP_GAP_X_PX = 14;
const TIP_GAP_Y_PX = 16;
/** 말풍선이 화면 아래로 잘리지 않게 남기는 높이(px). */
const TIP_BOTTOM_MARGIN_PX = 40;

export interface Dwell {
  key: string;
  x: number;
  y: number;
}

/** 대상마다 onPointerEnter·Move·Leave 를 붙이면, 한 대상에 DWELL_MS 넘게 머물 때 그 대상과 포인터 자리를 돌려준다. */
export function useDwell(ms = DWELL_MS) {
  const [tip, setTip] = useState<Dwell | null>(null);
  const cur = useRef<{
    key: string | null;
    x: number;
    y: number;
    timer?: ReturnType<typeof setTimeout>;
  }>({ key: null, x: 0, y: 0 });
  useEffect(() => () => clearTimeout(cur.current.timer), []);
  // 핸들러는 같은 함수를 돌려준다. 이것을 받는 층(memo)이 말풍선 때문에 다시 그려지지 않게 한다.
  const on = useCallback(
    (key: string) => ({
      onPointerEnter: (e: PointerEvent) => {
        const s = cur.current;
        clearTimeout(s.timer);
        s.key = key;
        s.x = e.clientX;
        s.y = e.clientY;
        setTip(null);
        s.timer = setTimeout(() => {
          if (s.key === key) setTip({ key, x: s.x, y: s.y });
        }, ms);
      },
      onPointerMove: (e: PointerEvent) => {
        const s = cur.current;
        if (s.key !== key) return;
        s.x = e.clientX;
        s.y = e.clientY;
      },
      onPointerLeave: () => {
        const s = cur.current;
        if (s.key !== key) return;
        clearTimeout(s.timer);
        s.key = null;
        setTip(null);
      },
    }),
    [ms],
  );
  return { tip, on };
}

export type TipTone = PlanTone;

const TONE = {
  critical: 'text-sev-critical',
  high: 'text-sev-high',
  caution: 'text-sev-caution',
} as const satisfies Record<TipTone, string>;

/** 포인터 곁 자리. 오른쪽 가장자리에서는 왼쪽으로, 아래 가장자리에서는 위로 비킨다. */
function tipPosition({ x, y }: Dwell) {
  const flip = x > window.innerWidth - FLIP_EDGE_PX;
  return {
    left: flip ? undefined : x + TIP_GAP_X_PX,
    right: flip ? window.innerWidth - x + TIP_GAP_X_PX : undefined,
    top: Math.min(y + TIP_GAP_Y_PX, window.innerHeight - TIP_BOTTOM_MARGIN_PX),
  };
}

/** 말풍선. 떠 있는 패널(흐림 효과) 안에서도 화면 기준으로 뜨도록 body 에 띄운다. */
export function HoverTip({
  tip,
  text,
  tone,
}: {
  tip: Dwell | null;
  text: string | undefined;
  tone?: TipTone;
}) {
  if (!tip || !text) return null;
  return createPortal(
    <div
      role="tooltip"
      style={tipPosition(tip)}
      className={cn(
        'pointer-events-none fixed z-[1000] max-w-[360px] rounded-[7px] bg-background/95 px-2.5 py-1 text-[13px] leading-5 whitespace-nowrap shadow-float ring-1 ring-border ring-inset',
        tone && TONE[tone],
      )}
    >
      {text}
    </div>,
    document.body,
  );
}
