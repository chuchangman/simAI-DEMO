// simAI-DEMO: 개발 서버 목을 시연 흐름(GPU·서버 없이 작업 관리 → 세팅 → 구역 → 작업 전 확인 → 관제 → 종료 → 히스토리)에 맞춘다.
// 시험(vitest, MODE 'test')은 원래 목 데이터를 그대로 쓴다.
// - 시연 계정 「새 맵 만들기」가 재사용으로 시작할 수 있게 재사용 후보를 둔다(handlers.ts)
// - GPU 가 처음부터 연결돼 있다(gpu.ts)
// - 처음 관제 구역·작업면을 비워 AI 위험 구역 초안 「수락」이 보이게 한다(zones.ts, staticObjects.ts)
// - 세팅 완료가 그 세팅에서 만든 구역을 관제 구역에 더한다(startBackend.ts)
export const DEMO_FLOW = import.meta.env.MODE !== 'test';
