import { useEffect, useState } from 'react';

/**
 * 지금 시각(ms). 정한 간격마다 바뀌어, 쓰는 컴포넌트만 다시 그린다(데이터 연령·시계).
 * 간격의 경계(1초면 매 초 0ms)에 맞춰 바꿔서, 이 훅을 쓰는 칸들이 같은 순간에 함께 바뀐다.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      timer = setTimeout(tick, intervalMs - (at % intervalMs));
    };
    timer = setTimeout(tick, intervalMs - (Date.now() % intervalMs));
    return () => clearTimeout(timer);
  }, [intervalMs]);
  return now;
}
