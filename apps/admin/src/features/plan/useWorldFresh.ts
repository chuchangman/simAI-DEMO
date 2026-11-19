import { isWorldFresh, useRealtimeStore } from '@/store/realtime.store';
import { useEffect, useState } from 'react';

/**
 * 최근 world 를 받았는지. world 가 멈추면 시간이 지나서 바뀌므로 저장소 변화와 타이머를 둘 다 본다(useLinkAlive 와 같은 방식).
 * 값이 바뀔 때만 다시 그린다.
 */
export function useWorldFresh(): boolean {
  const [fresh, setFresh] = useState(() => isWorldFresh(useRealtimeStore.getState(), Date.now()));
  useEffect(() => {
    const update = () => setFresh(isWorldFresh(useRealtimeStore.getState(), Date.now()));
    update();
    const unsubscribe = useRealtimeStore.subscribe(update);
    const id = setInterval(update, 500);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, []);
  return fresh;
}
