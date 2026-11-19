import { useSpatialViewport } from '@/features/layout/SpatialViewportHost';
import { SetupZoneStep } from '@/features/setup/SetupZoneStep';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { SECONDARY } from '@/features/tbm/styles';
import { ZonesPage } from '@/features/zones/ZonesPage';
import { Button } from '@simai/ui/components/button';
import { useEffect, useRef } from 'react';

// '구역 편집' 창: 세팅의 구역 단계(SetupZoneStep: 왼쪽 큰 3D + 오른쪽 구역 편집 도구 ZonesPage)를 창 안에 그대로 쓴다.
// 눌러서 연 구역이 처음부터 골라져 있다. 구역 저장은 편집 도구가 하고(발행까지), 이 창은 닫기만 한다.

const NO_GHOSTS: never[] = [];

/** 창이 열릴 때 한 번만 그 구역을 고른다(3D 와 편집 도구가 같은 선택을 따른다). 이후 선택은 사용자가 바꾼다. */
function SelectZoneOnOpen({ zoneId }: { zoneId: string }) {
  const selectTarget = useSpatialViewport()?.selectTarget;
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !selectTarget) return;
    done.current = true;
    selectTarget({ type: 'zone', id: zoneId }, { focus: true });
  }, [selectTarget, zoneId]);
  return null;
}

export function ZoneEditDialog({ zoneId, onClose }: { zoneId: string; onClose: () => void }) {
  return (
    <ModalDialog label="구역 편집" onClose={onClose} className="w-[min(1180px,calc(100vw-48px))]">
      <div className="flex h-[min(760px,calc(100vh-48px))] flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] leading-[22px] font-bold text-foreground">구역 편집</h2>
          <Button variant="secondary" className={SECONDARY} onClick={onClose}>
            닫기
          </Button>
        </div>
        <SetupZoneStep
          title="가상 레이아웃"
          draftGhosts={NO_GHOSTS}
          plan={<p className="text-sm text-muted-foreground">3D 를 표시할 수 없습니다</p>}
        >
          <SelectZoneOnOpen zoneId={zoneId} />
          <ZonesPage placement="inline" />
        </SetupZoneStep>
      </div>
    </ModalDialog>
  );
}
