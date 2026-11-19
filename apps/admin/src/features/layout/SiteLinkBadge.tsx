import { useGpuStatus } from '@/features/gpu/useGpu';
import { siteLinkDown, siteLinkDownTitle } from '@/features/layout/status';
import { useLinkAlive } from '@/hooks/useLinkAlive';
import { useRealtimeStore } from '@/store/realtime.store';

// 상단바 「현장 연결 끊김 · 감시 중단」(S15P31A101-719). 17차에 게이트웨이가 끊겨도 세팅 화면은 「확인 중」, 관제는 사람 0명으로만 보여
// 끊긴 줄 몰랐다. 상단바는 세팅·관제·CCTV 화면에 모두 있으므로 여기 한 곳에 둔다. 근거는 EC2 가 이미 주는 viewer_health.laptop.link
// (하트비트 1초 주기 3회 누락 = 3초)다. 평소에는 아무것도 그리지 않는다(최소 화면).

export function SiteLinkBadge() {
  const health = useRealtimeStore((s) => s.health);
  const ec2Alive = useLinkAlive();
  const { dot } = useGpuStatus();
  const down = siteLinkDown(health, ec2Alive, dot !== 'OFF');
  if (!down) return null;
  return (
    <span
      role="alert"
      data-testid="site-link-down"
      title={siteLinkDownTitle(down)}
      className="rounded-md bg-delay/15 px-2 py-1 text-sm font-semibold whitespace-nowrap text-delay"
    >
      현장 연결 끊김 · 감시 중단
    </span>
  );
}
