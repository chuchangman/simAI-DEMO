/** 알림·이력·보고서 공통 표시 이름(-660). R8·R10은 명세 7.2의 확장 규칙 이름이다. */
export const RULE_NAME: Readonly<Record<string, string>> = {
  R1: '위험구역 진입',
  R2: '추락 위험(가장자리)',
  R3: '고소 작업면 위',
  R4: '낙상 의심',
  R5: '위험구역 접근',
  R6: '위험구역 안 시야 끊김',
  R7: '감시 저하',
  R8: '장비 근접',
  R9: '안전모 미착용',
  R10: '불확실 점유 근접',
  R11: '조끼 미착용',
};

export const SEVERITY_LABEL = {
  CRITICAL: '위험',
  HIGH: '경고',
  CAUTION: '주의',
  INFO: '안내',
} as const;

export const ruleName = (ruleId: string) => RULE_NAME[ruleId] ?? ruleId;
