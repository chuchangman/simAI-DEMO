import { loginErrorMessage } from '@/features/auth/loginErrorMessage';
import type { LoginForm } from '@/features/auth/types';
import { authSession } from '@/lib/api';
import { useSessionStore } from '@/store/session.store';
import { useMutation } from '@tanstack/react-query';

// 성공하면 세션만 저장한다. 원래 가려던 화면으로 보내는 것은 login 라우트 가드가 한다(main.tsx 의 router.invalidate).
export function useLogin() {
  const signIn = useSessionStore((s) => s.signIn);
  const mutation = useMutation({
    mutationFn: (input: LoginForm) => authSession.login(input),
    onSuccess: signIn,
    // 입력한 비밀번호가 mutation 캐시에 남지 않게, 로그인 화면이 닫히면 바로 지운다(기본은 5분).
    gcTime: 0,
  });

  return {
    login: mutation.mutate,
    pending: mutation.isPending,
    error: mutation.error ? loginErrorMessage(mutation.error) : undefined,
  };
}
