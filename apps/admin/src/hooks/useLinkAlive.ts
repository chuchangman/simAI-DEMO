import { isLinkAlive, useRealtimeStore } from '@/store/realtime.store';
import { useEffect, useState } from 'react';

/**
 * EC2 와 이어져 있는지. health 가 3초 넘게 안 오면 시간이 지나서 바뀌므로 저장소 변화와 타이머를 둘 다 본다.
 * 값이 바뀔 때만 다시 그린다.
 */
export function useLinkAlive(): boolean {
  const [alive, setAlive] = useState(() => isLinkAlive(useRealtimeStore.getState(), Date.now()));
  useEffect(() => {
    const update = () => setAlive(isLinkAlive(useRealtimeStore.getState(), Date.now()));
    update();
    const unsubscribe = useRealtimeStore.subscribe(update);
    const id = setInterval(update, 500);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, []);
  return alive;
}
