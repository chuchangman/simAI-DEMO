import { ApiError } from '@/lib/http';
import { QueryClient } from '@tanstack/react-query';

const MAX_RETRIES = 2;

/**
 * 다시 보내도 결과가 같은 실패(4xx: 권한·입력 문제, 형식이 틀린 응답)는 바로 실패로 둔다.
 * 연결 실패·시간 초과·5xx 만 두 번까지 다시 보낸다.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.kind === 'INVALID_RESPONSE') return false;
    if (error.kind === 'HTTP' && error.status < 500) return false;
  }
  return failureCount < MAX_RETRIES;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // 실시간 값은 STOMP 가 갱신한다. 창으로 돌아올 때마다 다시 받지 않는다.
      queries: { retry: shouldRetry, refetchOnWindowFocus: false },
      // 요청이 서버에 반영됐는지 모르는 채로 다시 보내지 않는다(ACK 등).
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
