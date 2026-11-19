import { SupplementPhonePage } from '@/features/setup/SupplementPhonePage';
import { createFileRoute } from '@tanstack/react-router';

// 휴대폰 맵 보강 촬영(S15P31A101-607). 세팅 화면의 QR 이 이 주소를 연다.
function SupplementPhoneRoute() {
  const { sessionId } = Route.useParams();
  return <SupplementPhonePage key={sessionId} sessionId={sessionId} />;
}

export const Route = createFileRoute('/_mobile/m/supplement/$sessionId')({
  component: SupplementPhoneRoute,
});
