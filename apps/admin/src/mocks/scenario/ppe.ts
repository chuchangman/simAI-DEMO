import { nextMsgId, SOURCE_ID } from '@/mocks/scenario/shared';
import type { PpeViewMessage } from '@simai/contracts';

/** mock 사람(scenario/world 의 WORKERS)별 안전모·조끼. 세 가지 표시(착용·미착용·모름)를 한 화면에서 보게 나눈다. */
const PEOPLE = [
  { id: 'w-0012', helmet: 'WORN', vest: 'WORN' },
  { id: 'w-0015', helmet: 'NOT_WORN', vest: 'UNKNOWN' },
  { id: 'w-0021', helmet: 'UNKNOWN', vest: 'NOT_WORN' },
] as const;

/** 근거 만료 초기값(마지막 근거 + 10초, 명세 5.5) */
const EXPIRES_MS = 10_000;
/** 촬영 → EC2 수신까지 걸린 척하는 시간 */
const DELAY_MS = 80;

type State = 'WORN' | 'NOT_WORN' | 'UNKNOWN';

function item(state: State, capture: number) {
  if (state === 'UNKNOWN') {
    return {
      state,
      reported_state: state,
      reason: 'REGION_NOT_OBSERVABLE',
      last_evidence_at_ms: null,
      expires_at_ms: null,
    };
  }
  return {
    state,
    reported_state: state,
    reason: state === 'WORN' ? 'WINDOW_WORN' : 'WINDOW_NOT_WORN',
    last_evidence_at_ms: capture,
    expires_at_ms: capture + EXPIRES_MS,
  };
}

/** /topic/ppe·GET /api/ppe/current: 시각 t(ms)의 PPE 스냅샷(ppe_view, S15P31A101-531). */
export function ppeViewAt(t: number): PpeViewMessage {
  const capture = t - DELAY_MS;
  return {
    schema_version: '1.0.0',
    msg_type: 'ppe_view',
    msg_id: nextMsgId(),
    sent_at: t,
    source_id: SOURCE_ID,
    payload: {
      tier0_source_id: 'tier0-01',
      snapshot_at_ms: t,
      people: PEOPLE.map((p) => ({
        world_id: p.id,
        identity_revision: 0,
        capture_time_ms: capture,
        received_at_ms: t,
        helmet: item(p.helmet, capture),
        vest: item(p.vest, capture),
      })),
    },
  };
}
