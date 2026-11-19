import type { Http } from '@/lib/http';
import { validateMessage, type PpeViewPayload } from '@simai/contracts';
import { z } from 'zod';

/**
 * GET /api/ppe/current 응답: Tier 0 마다 /topic/ppe 와 같은 모양(ppe_view payload)을 하나씩 담은 배열(명세 12.4, S15P31A101-531).
 * 봉투가 없어 같은 계약 검사기로 보도록 봉투를 씌워 검사한다. 하나라도 계약과 다르면 응답 전체를 버린다.
 */
const ppeCurrentSchema = z.array(z.unknown()).transform((items, ctx) => {
  const payloads: PpeViewPayload[] = [];
  for (const payload of items) {
    const checked = validateMessage('ppe_view', {
      schema_version: '1.0.0',
      msg_type: 'ppe_view',
      msg_id: '00000000-0000-4000-8000-000000000000',
      sent_at: 0,
      source_id: 'ec2',
      payload,
    });
    if (!checked.ok) {
      ctx.addIssue({ code: 'custom', message: 'ppe_view 계약과 다르다' });
      return z.NEVER;
    }
    payloads.push(checked.message.payload);
  }
  return payloads;
});

/** 지금 사람별 안전모·조끼 상태(열람 이상). 연결이 (다시) 열릴 때 한 번 받는다. */
export function requestPpeCurrent(http: Http, signal?: AbortSignal) {
  return http('/api/ppe/current', { schema: ppeCurrentSchema, signal });
}
