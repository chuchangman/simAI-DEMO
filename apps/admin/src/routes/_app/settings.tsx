import { SettingsPage } from '@/features/settings/SettingsPage';
import { createFileRoute } from '@tanstack/react-router';

// 설정(S15P31A101-705): 상단바 계정 메뉴의 「설정」으로 들어온다. 계정이 쓸 수 있는 구역만 보인다(GPU 는 관리자만).
export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});
