import type { Severity } from '@/features/events/types';

// 이벤트 기능이 같이 쓰는 이름표와 한도. 값이 어디서 왔는지는 각 줄 주석에 적는다.

/** 등급 순서(클수록 위험). */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  HIGH: 2,
  CAUTION: 1,
  INFO: 0,
};

export { SEVERITY_LABEL } from '@/lib/ruleNames';

/** 목록에 남기는 해소된 이벤트 수. 넘치면 오래된 것부터 버린다. */
export const MAX_RESOLVED = 50;

/** 한 묶음(사람)에 보이는 해소된 규칙 수. 같은 규칙에 되풀이해 걸려도 카드가 길어지지 않게. */
export const RESOLVED_PER_INCIDENT = 2;

/** EC2 마감(S15P31A101-722) 문구. 관측 해소가 아니라 Tier 0 가 사라져 닫은 것이라 '해소'라 적지 않는다. */
export const SERVER_CLOSE_LABEL = {
  WORK_ENDED: '작업 종료로 마감',
  SESSION_ENDED: 'GPU 세션 종료로 마감',
  NOT_IN_SNAPSHOT: 'Tier 0 기록 없음으로 마감',
} as const;

/** 이벤트 패널의 「최근 해소」 칸에 남기는 해소된 묶음(사람·규칙·구역별) 수. */
export const RECENT_RESOLVED_INCIDENTS = 4;

/**
 * 화면 묶음(S15P31A101-731)의 「짧은 시간」(ms): 같은 위험·같은 구역 경보가 앞 묶음의 마지막 갱신에서 이만큼 안에 다시 나면 한 카드로 센다.
 * 17차 재생에서 트랙 번호가 바뀌며 같은 「추락 위험(가장자리)」가 4~52초 간격으로 새로 났다. 기록·이벤트는 그대로이고 화면만 묶는다.
 */
export const CARD_MERGE_GAP_MS = 60 * 1000;

/**
 * 잠깐 생겼다 사라진 중복 트랙(유령 트랙, S15P31A101-785)으로 볼 수명 상한(ms). 생긴 때와 끝난 때를 이 브라우저가 이어서 봤고
 * 그 사이가 이보다 짧은 사람만 「지금 안 보임」 카드를 접는다. 11-16 라이브에서 유령 트랙은 2~20초 살았고(실제 작업자 2명),
 * 실제 작업자는 작업 동안 몇 분 넘게 보이므로 20초에 여유를 더했다.
 */
export const GHOST_MAX_LIFE_MS = 30 * 1000;

/** 운영자가 확인한 지 이만큼(ms) 지난 이벤트는 이벤트 패널에서 숨긴다. 확인하지 않은 이벤트는 오래돼도 남는다. */
export const ACK_HIDE_AFTER_MS = 24 * 60 * 60 * 1000;

/** 관제 화면이 ACK 를 보낼 때 쓰는 확인 경로(계약 event_ack 의 channel). */
export const CONTROL_ROOM_CHANNEL = 'CONTROL_ROOM';

/** 확인(ACK)이 들어온 곳의 이름. */
export const ACK_CHANNEL_LABEL: Record<string, string> = {
  [CONTROL_ROOM_CHANNEL]: '관제',
  FOREMAN_PWA: '반장 휴대폰',
  SITE_BUTTON: '현장 버튼',
};

/** 서버가 ProblemDetail 의 code 로 알리는 ACK 실패(명세 12.6). */
export const ACK_ERROR_CODE = {
  NOT_FOUND: 'EVENT_NOT_FOUND',
  RESOLVED: 'EVENT_RESOLVED',
  INVALID_SEQUENCE: 'INVALID_EVENT_SEQUENCE',
  INVALID_CHANNEL: 'INVALID_ACK_CHANNEL',
} as const;

/** 상향 의견 처리 상태 문구(명세 5.4, 12.3). */
export const ESCALATION_STATUS_LABEL = {
  approved: '승인',
  rejected: '거절',
  applied: '적용',
  already_applied: '이미 적용',
  event_closed: '이벤트 종료',
} as const;

/** 서버가 ProblemDetail 의 code 로 알리는 VLM 상향 의견 처리 실패(명세 12.6). */
export const ESCALATION_ERROR_CODE = {
  NOT_FOUND: 'EVENT_NOT_FOUND',
  ASSESSMENT_NOT_FOUND: 'ASSESSMENT_NOT_FOUND',
  RESOLVED: 'EVENT_RESOLVED',
  NOT_ACTIVE: 'NOT_ACTIVE',
  NOT_UPWARD: 'NOT_UPWARD',
  DUPLICATE: 'DUPLICATE',
  ALREADY_DECIDED: 'ALREADY_DECIDED',
  JOURNAL_UNAVAILABLE: 'JOURNAL_UNAVAILABLE',
  INVALID_DECISION: 'INVALID_DECISION',
  INVALID_ASSESSMENT: 'INVALID_ASSESSMENT_ID',
} as const;

/** 사고 구간 요약 진행 상태 문구(명세 5.4, 12.6, S15P31A101-368). */
export const SUMMARY_STATUS_LABEL = {
  QUEUED: '구간 요약 대기 중',
  RUNNING: '구간 요약 실행 중',
  SUCCEEDED: '요약 완료',
  FAILED: '요약 실패',
  TIMED_OUT: '시간 초과',
} as const;

/** 서버·워커가 알리는 사고 구간 요약 실패 코드(명세 12.6, S15P31A101-271, -369). */
export const SUMMARY_ERROR_CODE = {
  NOT_FOUND: 'EVENT_NOT_FOUND',
  CLIP_NOT_READY: 'CLIP_NOT_READY',
  EVENT_NOT_LIVE: 'EVENT_NOT_LIVE',
  CLIP_FETCH_FAILED: 'CLIP_FETCH_FAILED',
  NO_FACE_SAFE_FRAMES: 'NO_FACE_SAFE_FRAMES',
  VLM_ANSWER_INVALID: 'VLM_ANSWER_INVALID',
  VLM_INPUT_INVALID: 'VLM_INPUT_INVALID',
  VLM_TIMEOUT: 'VLM_TIMEOUT',
  VLM_UNAVAILABLE: 'VLM_UNAVAILABLE',
  VLM_REQUEST_REJECTED: 'VLM_REQUEST_REJECTED',
  VLM_CONFIG: 'VLM_CONFIG',
  CANCELLED: 'CANCELLED',
  TIMED_OUT: 'TIMED_OUT',
} as const;

export { RULE_NAME } from '@/lib/ruleNames';

/** 지표 키의 화면 이름. 없는 키는 키에서 단위 꼬리표를 뗀 이름으로 보인다. */
export const METRIC_LABEL: Record<string, string> = {
  edge_distance_m: '가장자리',
  height_diff_m: '높이 차',
  // 규칙 수치의 한국어 이름(S15P31A101-757). 사건 상세의 「자세히」에 보인다.
  zone_distance_m: '구역까지 거리',
  occupancy_z_min_m: '구역 바닥 높이',
  occupancy_z_max_m: '구역 최대 높이',
  surface_height_m: '작업면 높이',
  calibration_margin_m: '보정 여유',
  speed_mps: '속도',
  time_to_entry_s: '진입까지',
  head_drop_m: '머리 낙하',
};

/** 확인 필요 이유(confidence_reasons)의 화면 문구. */
export const CONFIDENCE_REASON: Record<string, string> = {
  Z_UNKNOWN: '높이 모름',
  PREDICTED: '예측 위치',
  PROVISIONAL_CALIB: '보정 미확정',
  SINGLE_VIEW: '한 대만 관측',
  JOINT_UNCERTAIN: '관절 불확실',
  IDENTITY_UNCERTAIN: '신원 불확실',
  // R9 를 유지할 때만 붙는다(계약 v7.17.0, 명세 7.1·7.2 R9).
  PPE_UNKNOWN: '보호구 상태 모름',
  UNSPECIFIED: '이유 미상',
};

/** 경과 시간이 바뀌는 간격(ms). 초 단위로 보이므로 1초다. */
export const ELAPSED_TICK_MS = 1000;

/** 1분(ms). 분 단위로만 다시 따지는 판단이 쓴다. */
export const MINUTE_MS = 60 * 1000;
