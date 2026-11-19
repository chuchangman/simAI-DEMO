// 개발 서버 mock 이 STOMP 로 보내는 메시지의 입구. 구현은 scenario/ 아래에 나눠 있다(shared·world·health·risk·ppe).
// 시험(__tests__/mocks/realtimeScenario.test.ts)이 만든 메시지를 모두 계약 검증기로 검사한다.

export { viewerHealthAt, type MockOutage } from '@/mocks/scenario/health';
export { ppeViewAt } from '@/mocks/scenario/ppe';
export { mockEventId, riskEventsBetween, seededEventsAt } from '@/mocks/scenario/risk';
export { EVENT_CYCLE_MS, MOCK_CONFIG, nextMsgId, type MockConfig } from '@/mocks/scenario/shared';
export { worldStateAt } from '@/mocks/scenario/world';
