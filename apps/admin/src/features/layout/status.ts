import type { HealthSnapshot } from '@/store/realtime.store';

// 시계·마지막 수신 시각에 보이는 값을 viewer_health(명세 12.4 /topic/health)에서 만든다. 화면 컴포넌트 없이 시험한다.

const CLOCK = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** EC2 기준 시각(명세 3.8). 이 브라우저 시계에 EC2 와의 차이(clockOffsetMs)를 더해 보인다. */
export function clockLabel(clockOffsetMs: number | undefined, now: number): string | undefined {
  return clockOffsetMs === undefined ? undefined : CLOCK.format(now + clockOffsetMs);
}

/** 마지막 데이터(world_state)를 받은 시각(EC2 시계). 받은 적 없으면 없다. */
export function lastDataClock(health: HealthSnapshot | null): string | undefined {
  if (!health || health.payload.data_age_ms === null) return undefined;
  return CLOCK.format(health.payload.as_of - health.payload.data_age_ms);
}

/** 상단바 「현장 연결 끊김」에 보일 근거. 끊기지 않았거나 알릴 때가 아니면 null. */
export interface SiteLinkDown {
  /** 마지막 게이트웨이 하트비트 시각(EC2 시계). 받은 적 없으면 null. */
  lastHeartbeatAt: number | null;
}

/**
 * 현장 게이트웨이(노트북)와 끊겼는지(S15P31A101-719). EC2 가 이미 viewer_health.laptop.link 로 하트비트 3회(3초) 누락을 알린다.
 * EC2 와 끊긴 동안은 그 값이 낡았으므로 말하지 않고(그때는 EC2 연결 문제), GPU 가 꺼져 있으면(작업·세팅 없음, 밤사이 노트북을 끈
 * 정상 상태) 오류처럼 보이지 않게 숨긴다(-704 사용자 결정과 같은 기준).
 */
export function siteLinkDown(
  health: HealthSnapshot | null,
  ec2Alive: boolean,
  gpuOn: boolean,
): SiteLinkDown | null {
  if (!health || !ec2Alive || !gpuOn) return null;
  const laptop = health.payload.laptop;
  return laptop.link === 'DISCONNECTED' ? { lastHeartbeatAt: laptop.last_heartbeat_at } : null;
}

/** 「현장 연결 끊김」 마우스 올림 설명. */
export function siteLinkDownTitle(down: SiteLinkDown): string {
  const since =
    down.lastHeartbeatAt === null
      ? '현장 게이트웨이 노트북의 신호를 받은 적이 없습니다'
      : `현장 게이트웨이 노트북의 신호가 ${CLOCK.format(down.lastHeartbeatAt)}부터 끊겼습니다`;
  return `${since}. 카메라 영상·위험 판정·현장 경보가 멈췄을 수 있습니다. 노트북 전원·인터넷과 게이트웨이 프로그램을 확인하세요.`;
}
