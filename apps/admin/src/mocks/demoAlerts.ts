import { EVENTS_TOPIC } from '@/lib/stomp';
import type { EventsMock } from '@/mocks/events';
import { riskEventsBetween } from '@/mocks/realtimeScenario';
import type { StompBroker } from '@/mocks/stompBroker';
import type { RiskEventMessage } from '@simai/contracts';

/** 시나리오 시각을 확인하는 간격(ms). */
const TICK_MS = 500;

interface DemoAlertsOptions {
  broker: StompBroker;
  events: Pick<EventsMock, 'record'>;
  /** 오늘 작업이 진행 중인가(작업 시작 ~ 작업 종료). 이때만 경보를 보낸다. */
  working: () => boolean;
  /** 경보를 붙일 관제 구역(세팅에서 만든 구역). 없으면 시나리오 구역 그대로. */
  zoneId: () => string | null;
}

/**
 * simAI-DEMO: 작업이 진행 중일 때 위험 이벤트 시나리오(scenario/risk.ts, 40초 한 바퀴: 진입 예측 → 개구부 근접 → 위험 구역 진입 →
 * 높이 확인 필요)를 /topic/events 로 보낸다. 서버·AI 없이 관제 경보 배너·카드·확인(ACK)을 볼 수 있다.
 */
export function startDemoAlerts({
  broker,
  events,
  working,
  zoneId,
}: DemoAlertsOptions): () => void {
  let last = Date.now();
  const withZone = (message: RiskEventMessage): RiskEventMessage => {
    const zone = zoneId();
    if (zone === null || message.payload.zone_id == null) return message;
    return { ...message, payload: { ...message.payload, zone_id: zone } };
  };
  // 해소되지 않은 이벤트. 작업을 끝낸 뒤에는 새 이벤트 없이 이 이벤트들의 나머지 전이(해소)만 보내 진행 중 경보가 남지 않게 한다.
  const open = new Set<string>();
  const timer = setInterval(() => {
    const now = Date.now();
    const from = last;
    last = now;
    if (broker.connections === 0) return;
    const active = working();
    for (const message of riskEventsBetween(from, now)) {
      const id = message.payload.event_id;
      if (!active && !open.has(id)) continue;
      if (message.payload.lifecycle === 'RESOLVED') open.delete(id);
      else open.add(id);
      broker.publish(EVENTS_TOPIC, events.record(withZone(message)));
    }
  }, TICK_MS);
  return () => clearInterval(timer);
}
