import { CctvPage } from '@/features/cctv/CctvPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/cctv')({
  component: CctvPage,
  staticData: { dockOverlay: true },
});
