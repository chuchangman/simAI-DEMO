import { adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import { describe, expect, it, vi } from 'vitest';

// 계약은 알지만 어댑터가 옮기지 않는 msg_type 을 흉내 낸다(계약에 어떤 종류가 있든 default 분기를 시험한다).
vi.mock('@simai/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simai/contracts')>()),
  isMessageType: () => true,
  validateMessage: () => ({ ok: true, message: {} }),
}));

describe('뷰어가 옮기지 않는 msg_type', () => {
  it('계약 검사를 통과해도 모르는 msg_type 으로 거부한다', () => {
    expect(adaptMessage({ msg_type: 'not_rendered' }, 0)).toEqual({
      kind: 'rejected',
      reason: 'UNKNOWN_MSG_TYPE',
      msgType: 'not_rendered',
      detail: '모르는 msg_type: not_rendered',
    });
  });
});
