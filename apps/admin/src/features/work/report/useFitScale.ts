import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 틀(frame) 안에 내용(content)을 비율을 지킨 채 통째로 넣는 배율(최대 1).
 * 틀이나 내용의 크기가 바뀌면 다시 재고, 그리기 전에 재서 첫 화면이 크게 번쩍이지 않는다.
 * 크기를 잴 수 없는 환경(시험)에서는 1 로 둔다.
 */
export function useFitScale(
  frame: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
): number {
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const frameEl = frame.current;
    const contentEl = content.current;
    if (!frameEl || !contentEl) return undefined;

    const fit = () => {
      const { clientWidth, clientHeight } = frameEl;
      const { offsetWidth, offsetHeight } = contentEl;
      if (clientWidth === 0 || clientHeight === 0 || offsetWidth === 0 || offsetHeight === 0) {
        return;
      }
      setScale(Math.min(1, clientWidth / offsetWidth, clientHeight / offsetHeight));
    };

    fit();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(frameEl);
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [frame, content]);

  return scale;
}
