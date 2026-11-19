import '@/index.css';
// 저장된 다크·화이트 모드를 화면을 그리기 전에 적용한다.
import '@/features/layout/theme.store';

import { requestAck } from '@/features/events/api';
import { resetEventClear } from '@/features/events/eventClear.store';
import { bindEventsCache } from '@/features/events/eventsCache';
import { bindConfigCache } from '@/features/zones/configCache';
import { installAudioUnlock } from '@/lib/alarmSound';
import { api, authSession } from '@/lib/api';
import { bindSession } from '@/lib/bindSession';
// 환경변수가 틀리면 화면을 그리기 전에 멈춘다.
import { env } from '@/lib/env';
import { queryClient } from '@/lib/queryClient';
import { realtime } from '@/lib/realtime';
import { routeTree } from '@/routeTree.gen';
import { useSessionStore } from '@/store/session.store';
import { clearZoneDrafts } from '@/store/zoneEdit.store';
import { stopZoneEdit } from '@/store/zoneEditMode.store';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/** 앱을 켤 때 세션 복구를 기다리는 시간(ms). 넘으면 로그인 화면부터 그린다. */
const RESTORE_WAIT_MS = 3000;

/** 사용자가 끝나면(로그아웃·다른 계정·권한 변경) 그 사용자의 화면 상태를 비운다: 구역 초안, 편집 모드, 지운 이벤트 기준 시각. */
const clearUserScreenState = () => {
  clearZoneDrafts();
  stopZoneEdit();
  resetEventClear();
};

const router = createRouter({
  routeTree,
  context: { sessionStore: useSessionStore, queryClient },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** 상단 바 아래까지 화면을 채우고 상단 바를 그 위에 띄운다(실시간 관제). */
    fullBleed?: boolean;
    /** 오른쪽에 이벤트 패널이 있다(실시간 관제). 경보 배너가 그 자리를 비키고 「상세」를 이 화면에서 연다. */
    eventPanel?: boolean;
    /** 하단 메뉴(독)가 본문 위에 반투명하게 떠 있어도 되는 화면(CCTV 관제·작업 관리). 본문 아래에 독 자리를 따로 비우지 않고 끝까지 채운다. */
    dockOverlay?: boolean;
  }
}

// 서버가 아직 없는 API 는 개발 서버에서 msw 로 REST·STOMP 를 흉내 낸다. DEV 조건이라 빌드에는 들어가지 않는다.
// VITE_API_REAL 에 적은 경로(예: /api/auth)는 흉내 내지 않고 개발 서버 프록시로 실서버에 보낸다(vite.config.ts).
if (import.meta.env.DEV && env.VITE_API_MOCK) {
  const { startMockBackend } = await import('@/mocks/startBackend');
  await startMockBackend();
}

// 새로고침해도 로그인이 이어지게 갱신 쿠키로 세션을 되살린다. 서버가 늦으면 정한 시간만 기다리고 그린다
// (늦게 끝나면 그때 로그인되고 로그인 라우트 가드가 가려던 화면으로 보낸다. 그 사이 로그인을 시도했으면 버린다).
// 기다리기를 그만둬도 요청은 끊지 않는다(authSession.restore).
await Promise.race([
  authSession.restore(),
  new Promise((resolve) => setTimeout(resolve, RESTORE_WAIT_MS)),
]);

// 로그인·로그아웃·토큰 거부로 세션이 바뀌면 실시간 연결을 열고 닫고, 라우트 가드를 다시 돌리고,
// 사용자가 끝나면 이전 사용자의 데이터를 지운다. 되살린 세션이 있으면 바로 연결한다.
// 실시간 연결은 만료가 가까우면 먼저 갱신한 토큰으로 붙는다(STOMP 는 401 로 갱신할 길이 없다).
bindSession({
  sessionStore: useSessionStore,
  realtime,
  router,
  queryClient,
  getToken: authSession.freshToken,
  // 서버가 STOMP 연결을 ERROR 로 거절하면 토큰을 갱신해 다시 붙는다. 갱신 쿠키가 거부되면 authSession 이 로그아웃시킨다.
  refreshToken: authSession.refresh,
  onUserChange: clearUserScreenState,
});
// /topic/events 로 받은 이벤트를 경보 목록 캐시에 반영한다. 연결이 다시 열리면 끊긴 사이 누른 확인을 서버로 보낸다.
bindEventsCache(realtime, queryClient, (eventId, eventSequence) =>
  requestAck(api, eventId, eventSequence),
);
// /topic/health 의 구성 버전이 바뀌면(다른 브라우저의 구역·작업면 저장·발행) 구역·작업면·묶음 목록을 다시 받는다.
bindConfigCache(queryClient);
// 브라우저는 사용자가 누르기 전에는 소리를 막는다. 첫 클릭·키 입력(로그인 포함)에서 경보음을 깨운다.
installAudioUnlock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
