import { DashPanel } from '@/features/dashboard/DashPanel';
import { formatTime, ruleName } from '@/features/events/events';
import { SeverityBadge } from '@/features/events/SeverityBadge';
import { isRowActiveAt, pastEventRows, type PastEventRow } from '@/features/history/pastEventRows';
import type { EventRow, WorkerRow } from '@/features/history/replayIndex';
import { formatClock } from '@/features/history/works';
import { workerShortLabel } from '@/features/people/personDisplay';
import { useZoneName } from '@/features/zones/useZoneName';
import { zoneNameOrDefault, type ZoneNameOf } from '@/features/zones/zoneName';
import { cn } from '@simai/ui/lib/utils';
import { ListOrdered, Users } from 'lucide-react';
import { useMemo } from 'react';

const LIST = 'flex min-h-0 flex-col gap-1 overflow-auto px-2.5 py-2';
const ROW =
  'flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2';
const EMPTY_ROW = 'px-1.5 py-1 text-muted-foreground';

function WorkerItem({
  worker,
  visible,
  selected,
  onPick,
}: {
  worker: WorkerRow;
  visible: boolean;
  selected: boolean;
  onPick: (worldId: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onPick(worker.worldId)}
        className={cn(ROW, 'gap-3', selected && 'bg-surface-2 ring-1 ring-primary ring-inset')}
      >
        <span className="font-mono font-semibold">{worker.worldId}</span>
        <span className="font-mono text-sm text-muted-foreground">
          {formatClock(worker.firstSeen)}–{formatClock(worker.lastSeen)}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">이벤트 {worker.events}</span>
        <span
          className={cn('w-8 text-right text-sm', visible ? 'text-ok' : 'text-muted-foreground')}
        >
          {visible ? '보임' : '—'}
        </span>
      </button>
    </li>
  );
}

/** 구간에 잡힌 작업자(익명 World ID). 누르면 고른다. */
export function WorkerList({
  workers,
  planned,
  visible,
  selectedId,
  onPick,
}: {
  workers: readonly WorkerRow[];
  planned: number;
  visible: ReadonlySet<string>;
  selectedId: string | null;
  onPick: (worldId: string) => void;
}) {
  return (
    <DashPanel icon={Users} title="작업자" count={`잡힘 ${workers.length} · 계획 ${planned}`}>
      <ul aria-label="작업자 목록" className={LIST}>
        {workers.length === 0 && <li className={EMPTY_ROW}>잡힌 작업자가 없습니다.</li>}
        {workers.map((w) => (
          <WorkerItem
            key={w.worldId}
            worker={w}
            visible={visible.has(w.worldId)}
            selected={selectedId === w.worldId}
            onPick={onPick}
          />
        ))}
      </ul>
    </DashPanel>
  );
}

function EventItem({
  row,
  playhead,
  zoneName,
  onPick,
}: {
  row: PastEventRow;
  playhead: number | null;
  zoneName: ZoneNameOf;
  onPick: (event: EventRow) => void;
}) {
  const { first, people } = row;
  const active = playhead !== null && isRowActiveAt(row, playhead);
  const later = playhead !== null && first.raisedAt > playhead;
  // 화면에는 내부 트랙 ID(w-…) 대신 「작업자 #n」(관제 카드와 같은 표시)을 보이고, 원래 ID 는 hover 로 알린다(S15P31A101-751)
  const workers = people.length
    ? `${workerShortLabel(people[0]!)}${people.length > 1 ? ` 외 ${people.length - 1}명` : ''}`
    : '';
  // 작업자가 없으면 구역이 대상이라 이름을 모르면 `구역` 이고, 작업자 뒤에 붙을 때는 모르면 뺀다.
  const zone = workers
    ? zoneName(first.zoneId)
    : first.zoneId && zoneNameOrDefault(first.zoneId, zoneName);
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={() => onPick(first)}
        className={cn(
          ROW,
          'gap-2.5',
          active && 'bg-surface-2 font-semibold',
          later && 'text-muted-foreground',
        )}
      >
        <span className="font-mono text-sm">{formatTime(first.raisedAt)}</span>
        <SeverityBadge severity={row.severity} />
        <span className="min-w-0 flex-1 truncate">
          {ruleName(first.ruleId)}
          {row.occurrences > 1 && (
            <span
              className="ml-1.5 font-semibold text-muted-foreground"
              title="같은 위험이 이어져 한 줄로 묶었습니다(관제 카드의 「n회」와 같은 기준)"
            >
              ×{row.occurrences}
            </span>
          )}
        </span>
        <span className="text-sm text-muted-foreground">
          <span title={people.length ? people.join(' · ') : undefined}>{workers}</span>
          {workers && zone && ' · '}
          {zone}
        </span>
      </button>
    </li>
  );
}

/**
 * 구간 이벤트(발생순). 같은 위험이 이어진 것(같은 초·트랙 번호만 바뀐 경보 포함)은 한 줄 「×n」으로 묶는다(관제 카드와 같은 묶음, 머리 수는
 * 줄 수 = 사건 수). 지금 시각에 활성인 것을 강조하고, 누르면 그 시각으로 옮긴다. 확인(ACK)은 없다.
 */
export function EventLog({
  events,
  playhead,
  onPick,
}: {
  events: readonly EventRow[];
  playhead: number | null;
  onPick: (event: EventRow) => void;
}) {
  const zoneName = useZoneName();
  const rows = useMemo(() => pastEventRows(events), [events]);
  return (
    <DashPanel
      icon={ListOrdered}
      title="이벤트 로그"
      count={
        <span title="관제 카드와 같은 기준으로 묶은 사건 수입니다. 경보 기록 한 건 한 건은 전체 건수(괄호)입니다.">
          {rows.length === events.length
            ? rows.length
            : `사건 ${rows.length} (경보 ${events.length})`}
        </span>
      }
    >
      <ol aria-label="이벤트 로그" className={LIST}>
        {rows.length === 0 && <li className={EMPTY_ROW}>위험·경고 없음</li>}
        {rows.map((row) => (
          <EventItem
            key={row.key}
            row={row}
            playhead={playhead}
            zoneName={zoneName}
            onPick={onPick}
          />
        ))}
      </ol>
    </DashPanel>
  );
}
