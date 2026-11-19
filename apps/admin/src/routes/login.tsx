import { LoginPage } from '@/features/auth/LoginPage';
import { safeRedirect } from '@/features/auth/safeRedirect';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  // 이미 로그인했으면 원래 가려던 화면으로 보낸다. 로그인 직후에도 router.invalidate 로 여기를 다시 지난다.
  beforeLoad: ({ context, search }) => {
    if (context.sessionStore.getState().session) {
      throw redirect({ href: safeRedirect(search.redirect, window.location.origin) });
    }
  },
  component: LoginPage,
});
