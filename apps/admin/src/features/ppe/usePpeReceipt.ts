import { requestPpeCurrent } from '@/features/ppe/api';
import { ppeReceipt, type PpeReceipt } from '@/features/ppe/ppeHealth';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** PPE 수신 확인 간격(ms). 사람이 없으면 /topic/ppe 가 오지 않으므로 REST 로 마지막 수신 시각을 본다(S15P31A101-634) */
export const PPE_RECEIPT_POLL_MS = 5_000;

const PPE_RECEIPT_KEY = ['ppe-receipt'] as const;

/** 진행 중인 작업이 있을 때만 GET /api/ppe/current 를 주기적으로 받아 PPE 상태가 들어오는지 본다. 꺼져 있으면 'unknown' */
export function usePpeReceipt(enabled: boolean): PpeReceipt {
  const { data } = useQuery({
    queryKey: PPE_RECEIPT_KEY,
    queryFn: ({ signal }) => requestPpeCurrent(api, signal),
    enabled,
    refetchInterval: enabled ? PPE_RECEIPT_POLL_MS : false,
  });
  return enabled ? ppeReceipt(data) : 'unknown';
}

/**
 * [condition] 이 [ms] 동안 이어서 참이어야 참이다. 작업 시작·종료 직후 묶음 적용(수 초)이나 한 번의 늦은 응답으로 안내가 깜박이지 않게 한다.
 */
export function useSustained(condition: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!condition) return;
    const timer = window.setTimeout(() => setElapsed(true), ms);
    return () => {
      window.clearTimeout(timer);
      setElapsed(false); // 조건이 끊기면 처음부터 다시 센다
    };
  }, [condition, ms]);
  return condition && elapsed;
}
