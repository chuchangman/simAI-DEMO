import { env } from '@/lib/env';
import { DEMO_FLOW } from '@/mocks/demoFlow';

/**
 * 서버가 아직 없는 API 를 msw 로 REST·STOMP 흉내 낸다(개발 서버 전용, main.tsx 가 DEV 에서만 불러서 빌드에는 들어가지 않는다).
 * VITE_API_REAL 에 적은 경로(예: /api/auth)는 흉내 내지 않고 개발 서버 프록시로 실서버에 보낸다(vite.config.ts).
 */
export async function startMockBackend() {
  const [
    { network },
    { handlers, staticObjectsMock, tbmMock, workMock, setupMock },
    { readMockUser },
    { withoutRealPaths },
    { createStompBroker },
    { startRealtimeMock },
    { createEventsMock },
    { createClipsMock },
    { createZonesMock },
    { createPeopleNamesMock },
    { seededEventsAt },
    { startDemoAlerts },
  ] = await Promise.all([
    import('virtual:msw'),
    import('@/mocks/handlers'),
    import('@/mocks/mockUser'),
    import('@/mocks/realPaths'),
    import('@/mocks/stompBroker'),
    import('@/mocks/realtime'),
    import('@/mocks/events'),
    import('@/mocks/clips'),
    import('@/mocks/zones'),
    import('@/mocks/peopleNames'),
    import('@/mocks/realtimeScenario'),
    import('@/mocks/demoAlerts'),
  ]);
  // 토큰 모양만 본다: mock 로그인 토큰이나 sub·role 이 있는 JWT(혼합 모드, 서명은 보지 않는다).
  // 로그아웃 뒤 토큰 없이 붙지 않는지, 만료된 실서버 토큰이 서버처럼 ERROR 로 거절되는지 볼 수 있다.
  const broker = createStompBroker({
    url: env.VITE_STOMP_URL,
    authorize: (authorization) => {
      const user = readMockUser(authorization);
      return user !== undefined && (user.expiresAt === undefined || user.expiresAt > Date.now());
    },
  });
  // 진행 중 두 건과 지난 관제(꺼진 관제에서 열린 채 남은) 세 건을 싣고 시작한다(S15P31A101-595).
  const events = createEventsMock({
    broker,
    summaryCompleteDelayMs: 1_500,
    seed: seededEventsAt(Date.now()),
  });
  const clips = createClipsMock({ findEvent: events.find });
  // health 의 구성 묶음 상태(발행·ACK)는 구역 mock 이 정한다. 발행하는 묶음에는 지금 작업면을 싣는다. 구역을 저장하면 세팅 mock 의
  // 세션이 COMPLETED·zones_committed_at 이 된다. 작업 관리의 '세팅 완료'(SETUP_DONE)는 세팅 화면의 「세팅 완료」(POST .../complete, -615)가 정한다.
  const zones = createZonesMock({
    staticObjects: staticObjectsMock.store,
    onCommit: setupMock.completeAfterZonesCommit,
  });
  tbmMock.bindLayoutZones(zones.layoutZones);
  // 세팅 구역 단계의 처음 목록 채우기(-629)는 지금 관제 구역을 읽는다
  setupMock.bindLiveZones(() => zones.currentZones());
  // simAI-DEMO: 세팅 완료가 그 세팅에서 만든 구역을 관제 구역에 더한다
  setupMock.bindApplyZones((fields) => zones.addZones(fields));
  const peopleNames = createPeopleNamesMock(Date.now);
  // GET /api/health 가 STOMP 흉내와 같은 상태를 주도록 실시간 mock 을 먼저 만든다.
  const { handlers: realtimeHandlers, ...realtimeMock } = startRealtimeMock(
    broker,
    Date.now,
    zones.config,
    peopleNames,
  );
  network.configure({
    // 실서버 경로의 mock 은 빼서 그 요청이 그대로 나가게 한다(처리되지 않은 요청은 bypass).
    handlers: [
      ...withoutRealPaths(
        [
          ...handlers,
          ...peopleNames.handlers,
          ...events.handlers,
          ...clips.handlers,
          ...zones.handlers,
          ...realtimeHandlers,
        ],
        env.VITE_API_REAL,
      ),
      broker.handler,
    ],
    onUnhandledFrame: 'bypass',
    // msw 는 가로챈 요청·프레임마다 콘솔에 남긴다. world 가 초당 10번 와서 콘솔이 넘치므로 끈다(REST 기록도 같이 꺼진다).
    context: { quiet: true },
  });
  await network.enable();
  // simAI-DEMO: 작업 시작 ~ 종료 동안 위험 이벤트 시나리오를 40초마다 보낸다(서버·AI 없이 경보를 본다)
  if (DEMO_FLOW) {
    startDemoAlerts({
      broker,
      events,
      working: () => workMock.workItems().some((w) => w.progress === 'IN_PROGRESS'),
      zoneId: () => zones.currentZones()[0]?.zone_id ?? null,
    });
  }
  // 개발 도구 콘솔에서 흉내 낸다: simaiMock.pauseHealth(5000), simaiMock.drop(),
  // simaiMock.expireAuth()(다음 ACK 를 토큰 만료로 거절해 갱신 뒤 다시 보내기를 본다),
  // simaiMock.outage('tier0' | 'laptop' | 'remote' | null)(장애 흉내), simaiMock.sceneMismatch(true),
  // simaiMock.rejectNextBundle()(다음 구성 묶음을 Tier 0 가 거부해 STALE),
  // simaiMock.failNextPublish('CALIBRATION_MISSING' | 'CURRENT_CALIBRATION_MISSING' | 'RULES_MISSING' |
  // 'SITE_NOT_SINGLE' | 'PUBLIC_URL_NOT_SET')(다음 발행 요청을 서버 오류 409·503 으로 거절, 기본 CALIBRATION_MISSING)
  // simaiMock.expireStomp()(STOMP 토큰 만료: 다음 연결을 ERROR 로 거절 → 갱신 뒤 다시 붙기)
  // simaiMock.markSetupDone(workId?)(오늘 날짜 작업의 세팅이 끝났다고 표시: 진행이 SETUP_DONE 이 되고 보고서 초안이 2.5초 뒤 채워진다)
  Object.assign(globalThis, {
    simaiMock: {
      ...realtimeMock,
      expireAuth: events.expireAuth,
      failNextSummary: events.failNextSummary,
      updateSummary: events.updateSummary,
      rejectNextBundle: zones.rejectNextBundle,
      failNextPublish: zones.failNextPublish,
      markSetupDone: workMock.markSetupDone,
      bindWatch: peopleNames.bindWatch,
    },
  });
}
