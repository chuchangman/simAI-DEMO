import { ELAPSED_TICK_MS, MINUTE_MS } from '@/features/events/constants';
import { useEffect, useState } from 'react';

// 경과 표시가 여럿(배너·카드)이어도 타이머는 하나다. 칸마다 setTimeout 을 두지 않는다.

type Listener = (now: number) => void;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** 간격의 경계(1초면 매 초 0ms)에 맞춰 알려서, 모든 칸이 같은 순간에 함께 바뀐다. */
function schedule() {
  timer = setTimeout(
    () => {
      const now = Date.now();
      listeners.forEach((listener) => listener(now));
      schedule();
    },
    ELAPSED_TICK_MS - (Date.now() % ELAPSED_TICK_MS),
  );
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  if (timer === undefined) schedule();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

/** 지금 시각(ms). 매 초 바뀌어 쓰는 컴포넌트만 다시 그린다. */
export function useSharedNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribe(setNow), []);
  return now;
}

/**
 * 지금 시각(ms)을 분이 바뀔 때만 갱신한다. 1초 틱을 그대로 쓰면 목록 전체가 매 초 다시 그려지므로,
 * 분 단위면 충분한 판단(확인한 지 오래된 이벤트 숨기기)은 이 훅으로 한다.
 */
export function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(
    () =>
      subscribe((at) =>
        setNow((prev) => (Math.floor(at / MINUTE_MS) === Math.floor(prev / MINUTE_MS) ? prev : at)),
      ),
    [],
  );
  return now;
}
