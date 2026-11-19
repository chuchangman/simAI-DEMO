import type { Severity } from '@/features/events/types';

// 확인 대기 경보 표시(경보 배너 테두리, 미확인 칩·표시, 울리는 종)와 구역 목록이 그 이벤트·구역의 등급 색을 따르게 하는 클래스.
// 위험 빨강·경고 주황·주의 노랑이고 안내는 회색이다. 경보는 위험·경고만 만들지만, 등급을 받는 쪽이 따로 좁히지 않도록
// 네 등급을 모두 둔다. Tailwind 가 소스에서 클래스 이름을 읽으므로 토큰 이름을 완성된 문자열로 적는다.

export const ALARM_TEXT: Record<Severity, string> = {
  CRITICAL: 'text-sev-critical',
  HIGH: 'text-sev-high',
  CAUTION: 'text-sev-caution',
  INFO: 'text-muted-foreground',
};

export const ALARM_BORDER: Record<Severity, string> = {
  CRITICAL: 'border-sev-critical',
  HIGH: 'border-sev-high',
  CAUTION: 'border-sev-caution',
  INFO: 'border-faint',
};

export const ALARM_RING: Record<Severity, string> = {
  CRITICAL: 'ring-sev-critical',
  HIGH: 'ring-sev-high',
  CAUTION: 'ring-sev-caution',
  INFO: 'ring-faint',
};
