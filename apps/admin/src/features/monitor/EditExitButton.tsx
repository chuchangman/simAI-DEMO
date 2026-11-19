import { TOOL_BUTTON_SIZE, TOOL_ICON_CLASS } from '@/features/layout/spatialHost/toolIcons';
import { ToolTooltip } from '@/features/layout/spatialHost/ToolTooltip';
import { clearZoneDrafts, useHasZoneDrafts } from '@/store/zoneEdit.store';
import { stopZoneEdit } from '@/store/zoneEditMode.store';
import { Button } from '@simai/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@simai/ui/components/popover';
import { TooltipProvider } from '@simai/ui/components/tooltip';
import { X } from 'lucide-react';
import { useState } from 'react';

const LABEL = '편집 끝내기';

/**
 * 관제의 구역 편집 패널 위쪽에서 관리자 편집 모드를 끝낸다. 저장 안 한 초안이 있으면 끄기 전에 버릴지 먼저 묻는다.
 * 편집은 구역 목록에서 시작하므로(S15P31A101-489) 켜는 버튼은 없다.
 */
export function EditExitButton() {
  const hasDrafts = useHasZoneDrafts();
  const [confirming, setConfirming] = useState(false);

  // 이미 물어보는 중에 누르면 팝오버가 스스로 닫히게 두고 다시 열지 않는다.
  const exit = () => {
    if (!hasDrafts) stopZoneEdit();
    else if (!confirming) setConfirming(true);
  };
  const discard = () => {
    clearZoneDrafts();
    stopZoneEdit();
    setConfirming(false);
  };

  return (
    <TooltipProvider>
      <Popover
        open={confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
      >
        <ToolTooltip
          label={LABEL}
          trigger={
            <PopoverTrigger
              render={
                <Button variant="ghost" size={TOOL_BUTTON_SIZE} aria-label={LABEL} onClick={exit} />
              }
            />
          }
        >
          <X aria-hidden className={TOOL_ICON_CLASS} />
        </ToolTooltip>
        <PopoverContent aria-label="편집 끄기">
          <Button size="sm" variant="destructive" onClick={discard}>
            수정 버리고 끄기
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            계속 편집
          </Button>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
