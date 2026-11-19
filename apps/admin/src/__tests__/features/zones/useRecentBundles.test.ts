import { pendingPollMs } from '@/features/zones/useRecentBundles';
import { describe, expect, it, vi } from 'vitest';

// 적용 대기 묶음을 다시 받는 간격(S15P31A101-638): 발행 1분까지 3초, 그 뒤 1분. 적용 대기가 아니면 받지 않는다.
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

const ISSUED_AT = 1_760_342_400_000;
const bundle = (status: 'PENDING' | 'APPLIED' | 'REJECTED' | 'MISMATCH') => ({
  status,
  issued_at: ISSUED_AT,
});

describe('pendingPollMs', () => {
  it.each([
    ['PENDING', 0, 3_000],
    ['PENDING', 59_999, 3_000],
    ['PENDING', 60_000, 60_000],
    ['PENDING', 3_600_000, 60_000],
  ] as const)('%s 발행 %i ms 뒤는 %i ms 마다 받는다', (status, elapsed, interval) => {
    expect(pendingPollMs(bundle(status), ISSUED_AT + elapsed)).toBe(interval);
  });

  it.each(['APPLIED', 'REJECTED', 'MISMATCH'] as const)('%s 는 받지 않는다', (status) => {
    expect(pendingPollMs(bundle(status), ISSUED_AT + 1_000)).toBe(false);
  });

  it('묶음을 모르면 받지 않는다', () => {
    expect(pendingPollMs(undefined, ISSUED_AT)).toBe(false);
  });
});
