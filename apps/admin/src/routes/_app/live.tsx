import { MonitorPage } from '@/features/monitor/MonitorPage';
import { createFileRoute } from '@tanstack/react-router';

// 실시간 관제. 첫 화면(/)이 작업 관리가 되어 /live 로 옮겼다(S15P31A101-665).
export const Route = createFileRoute('/_app/live')({
  component: MonitorPage,
  staticData: { fullBleed: true, eventPanel: true },
});
