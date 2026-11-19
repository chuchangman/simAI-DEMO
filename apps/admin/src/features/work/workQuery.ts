import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { TBM_WORKS_KEY } from '@/features/tbm/api';
import { BUNDLES_KEY, ZONES_KEY } from '@/features/zones/api';
import { HISTORY_WORKS_KEY, WORK_KEY, WORK_REPORTS_KEY } from '@/lib/queryKeys';
import type { QueryClient, UseMutationResult } from '@tanstack/react-query';

// 작업 관리 훅이 함께 쓰는 캐시 무효화와 결과 모양.

/** 작업 관리 캐시와 히스토리 작업 목록을 모두 다시 받게 한다(제출·종료처럼 여러 화면에 걸친 변화 뒤). */
export function invalidateWork(client: QueryClient): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: WORK_KEY }),
    client.invalidateQueries({ queryKey: HISTORY_WORKS_KEY }),
  ]);
}

/**
 * 작업 시작·종료 뒤: 위에 더해 서버가 그때 발행하는 구성 묶음(안전모 요구 등, -518)·구역·작업면 적용 상태도 다시 받게 한다.
 * 서버가 시작·종료 때 새 구성 묶음을 발행하기 때문이다(features/tbm/useWorkSession 과 같다).
 * 관제가 보는 작업 목록(TBM_WORKS_KEY: 대기 화면·작업 바)도 15초 주기를 기다리지 않고 바로 다시 받는다.
 * 보고서를 먼저 새로 받고 나서 하루 작업·달력을 받는다. 종료하면 보고서의 wrap_up_status 가 GENERATING 으로 바뀌는데,
 * 하루 작업(ENDED)이 먼저 오면 종료 화면이 그 표시 없는 낡은 보고서로 마운트돼 `완료` 가 잠깐 켜지고 종료 미팅이 빈 채 보낼 수 있다.
 */
export async function invalidateAfterRun(client: QueryClient): Promise<void> {
  await client.invalidateQueries({ queryKey: WORK_REPORTS_KEY });
  await Promise.all([
    invalidateWork(client),
    client.invalidateQueries({ queryKey: TBM_WORKS_KEY }),
    client.invalidateQueries({ queryKey: BUNDLES_KEY }),
    client.invalidateQueries({ queryKey: ZONES_KEY }),
    client.invalidateQueries({ queryKey: STATIC_OBJECTS_KEY }),
  ]);
}

/**
 * 변경 훅이 화면에 돌려주는 모양. mutate(콜백)·mutateAsync(await)·pending·error·reset 만 둔다.
 * 요청은 한 번에 하나만 보내도록 화면이 pending 으로 단추를 막는다.
 */
export function mutationResult<TData, TVariables>(
  mutation: UseMutationResult<TData, Error, TVariables>,
) {
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    pending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}
