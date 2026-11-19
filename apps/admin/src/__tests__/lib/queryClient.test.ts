import { ApiError, NETWORK_ERROR } from '@/lib/http';
import { createQueryClient, shouldRetry } from '@/lib/queryClient';
import { describe, expect, it } from 'vitest';

describe('shouldRetry', () => {
  it('4xx 와 형식이 틀린 응답은 다시 보내지 않는다', () => {
    expect(shouldRetry(0, new ApiError(400))).toBe(false);
    expect(shouldRetry(0, new ApiError(403))).toBe(false);
    expect(shouldRetry(0, new ApiError(404))).toBe(false);
    expect(shouldRetry(0, new ApiError(200, { kind: 'INVALID_RESPONSE' }))).toBe(false);
  });

  it('연결 실패·시간 초과·5xx·그 밖의 오류는 두 번까지 다시 보낸다', () => {
    for (const error of [
      new ApiError(NETWORK_ERROR),
      new ApiError(NETWORK_ERROR, { kind: 'TIMEOUT' }),
      new ApiError(503),
      new Error('boom'),
    ]) {
      expect(shouldRetry(0, error)).toBe(true);
      expect(shouldRetry(1, error)).toBe(true);
      expect(shouldRetry(2, error)).toBe(false);
    }
  });
});

describe('createQueryClient', () => {
  it('창으로 돌아와도 다시 받지 않고, mutation 은 다시 보내지 않는다', () => {
    const { queries, mutations } = createQueryClient().getDefaultOptions();
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.retry).toBe(shouldRetry);
    expect(mutations?.retry).toBe(false);
  });
});
