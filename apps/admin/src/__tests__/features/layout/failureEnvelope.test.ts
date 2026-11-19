import { lastDataClock } from '@/features/layout/status';
import type { HealthSnapshot } from '@/store/realtime.store';
import { validateMessage, type ViewerHealthMessage } from '@simai/contracts';
import { describe, expect, it } from 'vitest';

// GET /api/health 와 /topic/health 는 같은 viewer_health 봉투다. 서버가 주는 값(계약 예제)으로 마지막 수신 시각이 맞게 읽히는지 본다.

const examples = import.meta.glob<ViewerHealthMessage>(
  '../../../../../../../contracts/examples/viewer_health*.json',
  { eager: true, import: 'default' },
);
const example = (name: string) => {
  const raw = Object.entries(examples).find(([path]) => path.endsWith(name))?.[1];
  if (!raw) throw new Error(`계약 예제가 없다: ${name}`);
  const checked = validateMessage('viewer_health', raw);
  if (!checked.ok) throw new Error(`계약 예제가 계약을 통과하지 못한다: ${name}`);
  return checked.message;
};

const snapshot = (message: ViewerHealthMessage, receivedAt = message.sent_at): HealthSnapshot => ({
  payload: message.payload,
  receivedAt,
  clockOffsetMs: 0,
});

describe('서버 viewer_health 봉투로 읽는 마지막 수신 시각', () => {
  it('정상 예제는 마지막 수신 시각을 EC2 가 잰 데이터 연령에서 읽는다', () => {
    expect(lastDataClock(snapshot(example('viewer_health.json')))).toBeDefined();
  });

  it('원격 전달 단절 예제(Tier 0 끊김, 노트북 정상, 데이터 연령 null)는 마지막 수신 시각이 없다', () => {
    const message = example('viewer_health.remote_link_lost.json');
    const health = snapshot(message);
    expect(message.payload).toMatchObject({
      remote_state: 'REMOTE_LINK_LOST',
      tier0_link: 'DISCONNECTED',
      laptop: { link: 'CONNECTED' },
      data_age_ms: null,
    });
    // 데이터 연령을 모르면(null) 시각으로 만들지 않는다.
    expect(lastDataClock(health)).toBeUndefined();
  });
});
