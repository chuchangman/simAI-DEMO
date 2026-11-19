import { GpuGateDialog } from '@/features/gpu/GpuGateDialog';
import { useGpuStatus } from '@/features/gpu/useGpu';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

// 세팅 시작·작업 시작 앞의 GPU 확인(S15P31A101-702). GPU 가 연결돼 있으면 바로 하고, 꺼져 있거나 준비 중이면 경고창을 띄운다.
// 경고창에서 켜거나(꺼짐) 기다리다가(준비 중) GPU 가 연결되면 막았던 일을 이어서 한다. 취소하면 아무것도 하지 않는다.
// 관리자가 아니면 GPU 상태를 모르므로 막지 않는다(서버가 판단한다).

export interface GpuGate {
  /** fn 을 GPU 가 연결됐을 때 부른다(지금 연결이면 바로) */
  guard: (fn: () => void) => void;
  /** 화면에 그릴 경고창(없으면 null) */
  dialog: ReactNode;
}

export function useGpuGate(): GpuGate {
  const { isAdmin, status, dot } = useGpuStatus();
  const [waiting, setWaiting] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);

  const guard = useCallback(
    (fn: () => void) => {
      if (!isAdmin || status === undefined || dot === 'CONNECTED') {
        fn();
        return;
      }
      pendingRef.current = fn;
      setWaiting(true);
    },
    [isAdmin, status, dot],
  );

  // 기다리는 동안 연결되면 이어서 한다(다음 틱에: 렌더가 끝난 뒤 창을 닫고 하던 일을 부른다)
  useEffect(() => {
    if (!waiting || dot !== 'CONNECTED') return;
    const timer = setTimeout(() => {
      const fn = pendingRef.current;
      pendingRef.current = null;
      setWaiting(false);
      fn?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [waiting, dot]);

  const cancel = useCallback(() => {
    pendingRef.current = null;
    setWaiting(false);
  }, []);

  return { guard, dialog: waiting ? <GpuGateDialog onCancel={cancel} /> : null };
}
