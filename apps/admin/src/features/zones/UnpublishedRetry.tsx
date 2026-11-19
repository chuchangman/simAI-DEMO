import { UNPUBLISHED_TEXT } from '@/features/zones/useConfigApply';
import { BUTTON_CLASS, RETRY_CLASS } from '@/features/zones/zonePanelStyle';
import { Button } from '@simai/ui/components/button';

/** 반영했지만 현장으로 보내지 못했다는 한 줄과 다시 보내기 버튼. 구역 편집 패널과 구역 목록이 함께 쓴다. */
export function UnpublishedRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className={RETRY_CLASS}>
      <span className="min-w-0">{UNPUBLISHED_TEXT}</span>
      <Button variant="secondary" onClick={onRetry} className={BUTTON_CLASS}>
        다시 보내기
      </Button>
    </div>
  );
}
