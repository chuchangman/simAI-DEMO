import { formatTime } from '@/features/events/events';
import { SeverityBadge } from '@/features/events/SeverityBadge';
import { useLiveEvents } from '@/features/events/useLiveEvents';
import {
  severityCounts,
  workEventRows,
  workEventsOf,
  type WorkEventRow,
} from '@/features/work/run/run';
import { useZoneName } from '@/features/zones/useZoneName';
import { zoneNameOrDefault, type ZoneNameOf } from '@/features/zones/zoneName';
import { ruleName } from '@/lib/ruleNames';
import { Card, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';
import { useMemo } from 'react';

// 작업 종료 단계 오른쪽 가운데 카드: 지금 실행을 시작한 뒤 난 경보 기록(위험·경고)을 최근 것부터(S15P31A101-731).
// 머리줄 수는 경보 기록 한 건 한 건(작업 목록·달력·종료 미팅의 위험·경고 수와 같은 정의)이고, 관제 화면의 「진행 중 n건」(지금 진행 중인
// 사건 카드)과 이름을 가른다. 줄은 종류(규칙)·구역을 보이고, 같은 초·같은 대상의 위험·경고 쌍은 한 줄이다. 구역을 모르면 '현장'.

/** 구역을 알 수 없는 경보에 쓰는 장소 이름. */
const NO_ZONE_NAME = '현장';

/** 머리줄 수를 올려 보면 나오는 설명. */
const COUNT_TITLE =
  '이번 실행에서 난 위험·경고 기록 수입니다(한 건 한 건). 작업 목록·종료 미팅의 위험·경고 수와 같은 기준이고, 관제 화면의 「진행 중」은 지금 진행 중인 사건 수입니다.';

function EventRow({ row, zoneName }: { row: WorkEventRow; zoneName: ZoneNameOf }) {
  const zone = row.zoneId ? zoneNameOrDefault(row.zoneId, zoneName) : NO_ZONE_NAME;
  const rules = row.ruleIds.map(ruleName).join(' · ');
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className="font-mono tabular-nums">{formatTime(row.at)}</span>
      <span className="flex min-w-0 flex-col">
        <span title={rules} className="truncate font-semibold">
          {rules}
        </span>
        <span className="truncate text-sm text-muted-foreground">{zone}</span>
      </span>
      <SeverityBadge severity={row.severity} />
    </li>
  );
}

/**
 * 경보 기록. startedAt 은 지금 실행을 시작한 시각(EC2 ms)이고, 없으면 기록이 없는 것으로 본다. zoneId 는 구역 작업의 구역이다
 * (종료 미팅처럼 그 구역 경보만 센다, 없으면 현장 전체).
 */
export function EventListCard({
  startedAt,
  zoneId = null,
}: {
  startedAt: number | null;
  zoneId?: string | null;
}) {
  const { entries } = useLiveEvents();
  const zoneName = useZoneName();
  const events = useMemo(
    () => workEventsOf(entries, startedAt, null, zoneId),
    [entries, startedAt, zoneId],
  );
  const rows = useMemo(() => workEventRows(events), [events]);
  const counts = severityCounts(events);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <h2>경보 기록</h2>
          <span
            title={COUNT_TITLE}
            className="text-sm font-normal text-muted-foreground tabular-nums"
          >
            {events.length}건
            {events.length > 0 && ` · 위험 ${counts.critical} · 경고 ${counts.high}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">경보 없음</p>
        ) : (
          <ul
            aria-label="경보 기록 목록"
            className="flex max-h-[260px] flex-col divide-y divide-border overflow-auto"
          >
            {rows.map((row) => (
              <EventRow key={row.key} row={row} zoneName={zoneName} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
