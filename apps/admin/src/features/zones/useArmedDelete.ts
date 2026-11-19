import { useEffect, useRef, useState } from 'react';

/** 삭제를 한 번 더 눌러야 하는 시간(ms). */
export const ARM_MS = 3_000;

/** 삭제 확인 단계: 처음 누르면 그 구역을 ARM_MS 동안 확인 상태로 두고, 시간이 지나면 풀린다. */
export function useArmedDelete() {
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const disarm = () => {
    clearTimeout(timer.current);
    setArmedKey(null);
  };
  const arm = (key: string) => {
    clearTimeout(timer.current);
    setArmedKey(key);
    timer.current = setTimeout(() => setArmedKey(null), ARM_MS);
  };
  return { armedKey, arm, disarm };
}
