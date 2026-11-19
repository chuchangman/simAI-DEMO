import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

// 휴대폰 화면(맵 보강 촬영 등, S15P31A101-607). 관제 화면의 상단 바·하단 메뉴 없이 그린다. 로그인 가드는 _app 과 같다:
// 로그인하지 않았으면 로그인 화면으로 보내고, 로그인 뒤 돌아올 곳을 redirect 에 남긴다.
function MobileLayout() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute('/_mobile')({
  beforeLoad: ({ context, location }) => {
    if (!context.sessionStore.getState().session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: MobileLayout,
});
