import { createFileRoute, redirect } from '@tanstack/react-router';

// 예전 주소. 히스토리는 작업 관리(/work)의 지난 날짜 다시 보기로 합쳤다.
export const Route = createFileRoute('/_app/history/$workId')({
  beforeLoad: () => {
    throw redirect({ to: '/work', replace: true });
  },
});
