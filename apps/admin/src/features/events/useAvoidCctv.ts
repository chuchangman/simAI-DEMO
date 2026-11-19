import { avoidBox, defaultPanelBox } from '@/features/events/panelBox';
import { measure, type FloatBox } from '@/lib/floatSpot';
import { useCctvFloatBox } from '@/store/cctvFloatBox.store';
import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 떠 있는 CCTV 창이 이벤트 패널을 가리면 비켜 선 패널 상자(창 위·아래 빈칸 중 넓은 쪽). 가리지 않거나, 패널이 접혔거나,
 * 빈칸이 모자라면 null 이라 패널은 제자리(옮긴 box, 없으면 기본 자리)에 있다. 기준 자리는 비켜 선 패널을 재지 않고 box 나
 * 기본 자리로 잡는다(비켜 선 높이를 기준으로 삼으면 창을 치워도 길어지지 않는다). 창 크기가 바뀌면 다시 맞춘다.
 */
export function useAvoidCctv(
  panel: RefObject<HTMLElement | null>,
  box: FloatBox | null,
  folded: boolean,
): FloatBox | null {
  const cover = useCctvFloatBox();
  const [avoided, setAvoided] = useState<FloatBox | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const now = folded || !cover ? null : measure(panel.current);
      setAvoided(now && avoidBox(box ?? defaultPanelBox(now.bounds, now.box.width), cover));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [panel, box, folded, cover]);
  return avoided;
}
