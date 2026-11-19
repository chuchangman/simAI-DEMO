import { useMonitorStandby } from '@/features/monitor/useTodayWorks';
import { LivePlan } from '@/features/plan/LivePlan';
import type { FloorCoverage } from '@/lib/floorCoverage';
import { cn } from '@simai/ui/lib/utils';

/**
 * 3D 대신(또는 3D 가 뜨기 전에) 보이는 2D 평면 창. 이벤트 패널이 있는 화면은 왼쪽에 구역 목록 칼럼(왼쪽 14px + 칼럼 폭)이
 * 있고, 없는 화면(편집 모드)은 구역 편집 패널(왼쪽 14px + 폭 356px)이 있어 그 오른쪽에서 시작한다. 오른쪽은 이벤트 패널이
 * 있으면 그 자리를 비운다. 대기 화면이 덮는 동안은 inert 라 Tab 으로도 사람·구역을 고르지 못한다.
 */
export function PlanOverlay({
  withEventPanel,
  selectedKey,
  onSelect,
  coverage = null,
}: {
  withEventPanel: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** 바닥 감시 범위(-606). 켰고 지금 보정에 맞을 때만 넘긴다. */
  coverage?: FloorCoverage | null;
}) {
  const standby = useMonitorStandby();
  return (
    <div
      inert={standby}
      className={cn(
        'absolute top-[72px] bottom-[96px]',
        withEventPanel
          ? 'right-(--event-panel-inset) left-[calc(14px+var(--side-column-width)+16px)]'
          : 'right-5 left-[384px]',
      )}
    >
      <LivePlan
        selectedKey={selectedKey}
        onSelect={onSelect}
        coverage={coverage}
        className="size-full"
      />
    </div>
  );
}
