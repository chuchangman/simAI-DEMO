import { HEALTH_TOPIC, PPE_TOPIC, WORLD_TOPIC } from '@/lib/stomp';
import type { PeopleNamesMock } from '@/mocks/peopleNames';
import { readLiveUser, unauthorized } from '@/mocks/problem';
import {
  MOCK_CONFIG,
  ppeViewAt,
  viewerHealthAt,
  worldStateAt,
  type MockConfig,
  type MockOutage,
} from '@/mocks/realtimeScenario';
import type { StompBroker } from '@/mocks/stompBroker';
import { http, HttpResponse } from 'msw/http';

// 개발 서버 mock 송출: world 10Hz, health 1Hz, PPE 2Hz(-531). 위험 이벤트는 저절로 만들지 않는다.
const WORLD_MS = 100;
const HEALTH_MS = 1000;
const PPE_MS = 500;

export interface RealtimeMock {
  /**
   * GET /api/health(명세 12.6, 열람). /topic/health 와 같은 지금 상태(장애·Scene 불일치 흉내 포함)를 준다.
   * 응답 형식은 FE 제안(viewer_health 메시지 그대로, features/layout/api.ts)을 따른다.
   */
  handlers: ReturnType<typeof http.get>[];
  /** health 송출을 ms 동안 멈춘다(EC2 상태 메시지 끊김 흉내). REST 조회는 그대로 답한다. */
  pauseHealth(ms: number): void;
  /** 연결을 끊는다(서버 재시작 흉내). 클라이언트가 다시 연결한다. */
  drop(): void;
  /**
   * 장애를 흉내 낸다(명세 FR-11). 그때부터 world 가 오지 않고, 3초 뒤 EC2 가 health 로 알린다. null 이면 복구한다.
   */
  outage(kind: MockOutage | null): void;
  /** Tier 0 가 이전 Scene 으로 판정하는 상태(명세 FR-12)를 켜고 끈다. */
  sceneMismatch(on: boolean): void;
  /**
   * 토큰 만료를 흉내 낸다: 다음 STOMP 연결(CONNECT)을 ERROR 로 거절하고 지금 연결을 끊는다. 클라이언트가 토큰을 갱신해
   * 다시 붙는지 본다(실서버는 만료된 토큰의 CONNECT 를 ERROR 프레임으로 거절한다).
   */
  expireStomp(): void;
  stop(): void;
}

export function startRealtimeMock(
  broker: StompBroker,
  now: () => number = Date.now,
  // 구성 묶음 상태(발행·ACK). 구역 mock 이 정한다(mocks/zones).
  config: () => MockConfig = () => MOCK_CONFIG,
  peopleNames?: PeopleNamesMock,
): RealtimeMock {
  let healthPausedUntil = 0;
  let fault: { kind: MockOutage; since: number } | undefined;
  let staleScene = false;
  // 연결이 없으면(로그인 전·로그아웃 뒤) 메시지를 만들지 않는다.
  const live = () => broker.connections > 0;
  const healthAt = (t: number) =>
    viewerHealthAt(t, {
      outage: fault,
      sceneMismatch: staleScene,
      config: config(),
      people: peopleNames?.snapshotAt(t),
    });

  function publishWorld() {
    if (!live() || fault) return;
    const configVersion = config().applied_version;
    broker.publish(WORLD_TOPIC, worldStateAt(now(), { sceneMismatch: staleScene, configVersion }));
  }

  function publishHealth() {
    const t = now();
    if (live() && t >= healthPausedUntil) broker.publish(HEALTH_TOPIC, healthAt(t));
  }

  peopleNames?.onChange(() => publishHealth());

  function publishPpe() {
    // 장애 흉내 중에는 PPE 도 오지 않는다(화면은 만료·연결로 UNKNOWN 을 보인다).
    if (live() && !fault) broker.publish(PPE_TOPIC, ppeViewAt(now()));
  }

  const timers = [
    setInterval(publishWorld, WORLD_MS),
    setInterval(publishHealth, HEALTH_MS),
    setInterval(publishPpe, PPE_MS),
  ];

  return {
    handlers: [
      http.get('*/api/health', ({ request }) => {
        // 로그인한 계정이면 역할과 상관없이 본다. 만료된 실서버 토큰(혼합 모드)은 서버처럼 거절한다.
        const t = now();
        return readLiveUser(request, t) ? HttpResponse.json(healthAt(t)) : unauthorized();
      }),
      // PPE 처음 상태(-531). /topic/ppe 와 같은 스냅샷의 payload 를 Tier 0 하나만큼 담는다.
      http.get('*/api/ppe/current', ({ request }) => {
        const t = now();
        if (!readLiveUser(request, t)) return unauthorized();
        return HttpResponse.json(fault ? [] : [ppeViewAt(t).payload]);
      }),
    ],
    pauseHealth: (ms) => {
      healthPausedUntil = now() + ms;
    },
    drop: () => broker.dropAll(),
    outage: (kind) => {
      fault = kind ? { kind, since: now() } : undefined;
    },
    sceneMismatch: (on) => {
      staleScene = on;
    },
    expireStomp: () => {
      broker.rejectNextConnects();
      broker.dropAll();
    },
    stop: () => timers.forEach(clearInterval),
  };
}
