import { AppLayout } from '@/features/layout/AppLayout';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app')({
  // 로그인하지 않았으면 로그인 화면으로 보내고, 로그인 뒤 돌아올 곳을 redirect 에 남긴다.
  beforeLoad: ({ context, location }) => {
    if (!context.sessionStore.getState().session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: AppLayout,
});
