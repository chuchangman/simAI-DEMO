import { createFileRoute, redirect } from '@tanstack/react-router';

// 예전 주소. 레이아웃 · TBM 보고서 화면은 작업 관리(/work)로 합쳤다.
export const Route = createFileRoute('/_app/tbm')({
  beforeLoad: () => {
    throw redirect({ to: '/work', replace: true });
  },
});
