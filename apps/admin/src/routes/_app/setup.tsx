import { SetupPage } from '@/features/setup/SetupPage';
import { createFileRoute } from '@tanstack/react-router';

// 현장 세팅은 작업마다 한다. ?workUnitId=<작업 id> 가 없으면 작업 관리로 안내한다.
function SetupRoute() {
  const { workUnitId } = Route.useSearch();
  return <SetupPage key={workUnitId ?? ''} workUnitId={workUnitId} />;
}

export const Route = createFileRoute('/_app/setup')({
  validateSearch: (search: Record<string, unknown>): { workUnitId?: number } => {
    const n = Number(search.workUnitId);
    return { workUnitId: Number.isInteger(n) && n > 0 ? n : undefined };
  },
  component: SetupRoute,
});
