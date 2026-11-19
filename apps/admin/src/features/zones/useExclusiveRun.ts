import { useRef, useState } from 'react';

/**
 * 한 번에 하나만 보낸다. isPending 은 다음 턴에 바뀌어 같은 턴에 두 번 눌리면 두 번 보내므로, 보내는 중이면 여기서 바로
 * 막는다(막힌 호출은 undefined).
 */
export function useExclusiveRun() {
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async <T>(job: () => Promise<T>): Promise<T | undefined> => {
    if (sending.current) return undefined;
    sending.current = true;
    setBusy(true);
    try {
      return await job();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}
