import { fitPanel } from '@/features/events/panelBox';
import { measure, type FloatBox } from '@/lib/floatSpot';
import { useEffect, useState, type RefObject } from 'react';

/**
 * 옮기거나 크기를 바꾼 패널의 자리. null 이면 오른쪽 기본 자리다.
 * 창 크기가 바뀌면 화면 밖으로 나가지 않게 다시 맞춘다.
 */
export function useFloatingBox(panel: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<FloatBox | null>(null);

  const moved = box !== null;
  useEffect(() => {
    if (!moved) return undefined;
    const refit = () => {
      const now = measure(panel.current);
      if (now) setBox((prev) => (prev ? fitPanel(prev, now.bounds) : prev));
    };
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, [moved, panel]);

  return { box, setBox, reset: () => setBox(null) };
}
