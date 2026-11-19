import { ANY_CAMERA, useCamSplitStore } from '@/features/cctv/camSplit.store';
import type { Incident } from '@/features/events/incidents';
import { cn } from '@simai/ui/lib/utils';
import { Video } from 'lucide-react';

/** 놓이는 자리별 모양: 배너는 버튼 줄 높이에 맞추고, 카드는 본문 아래 작은 칩으로 둔다. */
const LOOK = {
  banner: 'h-8 rounded-lg bg-secondary px-2.5 text-secondary-foreground hover:bg-secondary/80',
  card: 'mt-0.5 w-fit rounded-md bg-surface-3 px-2 py-1 hover:bg-surface-3/70',
} as const;

/**
 * CCTV 버튼: 실시간 관제 오른쪽에 카메라 미리보기를 연다(관제 데모와 같다). 카메라는 고르지 않고 패널이 첫 카메라를 보인다.
 * 대상이 없으면 버튼이 없다(해소된 묶음).
 */
export function CameraButton({
  target,
  variant,
}: {
  target: Incident['target'];
  variant: keyof typeof LOOK;
}) {
  const open = useCamSplitStore((s) => s.open);
  if (!target) return null;
  return (
    <button
      type="button"
      onClick={() => open({ cam: ANY_CAMERA, target })}
      className={cn('inline-flex items-center gap-1.5 text-sm', LOOK[variant])}
    >
      <Video aria-hidden className="size-[15px]" />
      <span>CCTV로 확인</span>
    </button>
  );
}
