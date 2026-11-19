import { useSyncExternalStore } from 'react';

/** 미디어 쿼리가 맞으면 true. 설정·창 크기가 바뀌면 바로 따라간다. matchMedia 가 없는 환경(jsdom)에서는 false 다. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}
