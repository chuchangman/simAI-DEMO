import { ALERT, SWITCH } from '@/features/tbm/styles';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';

// 보고서를 못 받았을 때의 알림과 '다시 불러오기'. 본문 종이와 작은 미리보기가 같이 쓴다.

export function ReportLoadError({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn(ALERT, 'flex flex-none items-center gap-3', className)}>
      보고서를 불러오지 못했습니다
      <Button variant="secondary" onClick={onRetry} className={SWITCH}>
        다시 불러오기
      </Button>
    </div>
  );
}
