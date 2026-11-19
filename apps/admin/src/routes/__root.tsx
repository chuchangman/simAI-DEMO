import type { useSessionStore } from '@/store/session.store';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Navigate, Outlet } from '@tanstack/react-router';

// 라우트의 beforeLoad·loader 가 쓰는 값. main.tsx 의 createRouter 에서 넣는다.
export interface RouterContext {
  sessionStore: typeof useSessionStore;
  queryClient: QueryClient;
}

// 없어진 경로(/dashboard·/surfaces)와 틀린 주소는 첫 화면으로 보낸다.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => <Navigate to="/" replace />,
});
