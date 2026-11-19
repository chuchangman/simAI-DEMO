import { createFileRoute, redirect } from '@tanstack/react-router';

// 첫 화면(/)은 작업 관리다(S15P31A101-665). 로그인 뒤 기본 이동·없는 주소·옛 실시간 관제 북마크도 여기를 지나 작업 관리로 간다.
// 실시간 관제는 /live 다.
export const Route = createFileRoute('/_app/')({
  beforeLoad: () => {
    throw redirect({ to: '/work', replace: true });
  },
});
