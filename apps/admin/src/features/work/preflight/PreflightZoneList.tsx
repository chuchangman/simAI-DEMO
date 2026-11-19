import { SeverityBadge } from '@/features/events/SeverityBadge';
import type { Zone } from '@/features/zones/types';
import { zoneDisplayName } from '@/features/zones/zoneName';

// 작업 전 확인의 구역 목록: 이름 + 위험 등급(위험·경고·주의). 누르면 그 구역의 편집 창이 열린다.
// 구역을 아직 받지 못했으면 아무것도 보이지 않고(없다고 잘못 알리지 않는다), 받지 못했으면 안내를, 하나도 없으면 '구역 없음'을 보인다.

export function PreflightZoneList({
  zones,
  loaded,
  failed,
  onOpen,
}: {
  zones: readonly Zone[];
  /** 구역 응답을 받았는지. */
  loaded: boolean;
  /** 구역을 받지 못했는지. */
  failed: boolean;
  onOpen: (zoneId: string) => void;
}) {
  if (!loaded) {
    return failed ? (
      <p role="alert" className="text-[13px] text-destructive">
        구역을 불러오지 못했어요
      </p>
    ) : null;
  }
  if (zones.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">구역 없음</p>;
  }
  return (
    <ul aria-label="구역 목록" className="flex flex-col gap-2">
      {zones.map((zone) => (
        <li key={zone.zoneId}>
          <button
            type="button"
            onClick={() => onOpen(zone.zoneId)}
            className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border border-border bg-card px-3 py-2.5 text-left text-sm text-foreground outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate font-semibold">{zoneDisplayName(zone.name)}</span>
            <SeverityBadge severity={zone.severity} />
          </button>
        </li>
      ))}
    </ul>
  );
}
