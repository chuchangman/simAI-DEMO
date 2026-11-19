import type { EventRow, ReplayIndex, WorkerRow } from '@/features/history/replayIndex';
import { Timeline, type TimelineProps } from '@/features/history/Timeline';
import { useReplayFrame, useReplayNoData, useReplayStatus } from '@/features/history/useWorkReplay';
import { EventLog, WorkerList } from '@/features/history/WorkLists';
import type { ReplaySpatialSource } from '@/features/viewer3d';
import { useMemo } from 'react';

// 재생 상태는 재생 중 0.1초마다 바뀐다. 그 값을 보이는 타임라인·목록만 구독해 화면 전체를 다시 그리지 않는다.

const NO_EVENTS: readonly EventRow[] = [];
const NO_GAPS: TimelineProps['gaps'] = [];
const NO_WORKERS: readonly WorkerRow[] = [];

/** 옮긴다. 끝으로 옮기면 재생 의도를 거둔다(엔진은 끝에서 시계만 세우고 의도를 남겨, 뒤로 옮기면 저절로 다시 재생된다). */
export function seekTo(replay: ReplaySpatialSource | null, t: number) {
  if (!replay) return;
  replay.seek(t);
  if (replay.getStatus().ended) replay.pause();
}

type ReplayTimelineProps = Omit<
  TimelineProps,
  'status' | 'noData' | 'events' | 'gaps' | 'onSeek' | 'onPlay' | 'onPause' | 'onSpeed'
> & { replay: ReplaySpatialSource | null; index: ReplayIndex | null; holdMs: number };

/** 재생 상태를 구독하는 타임라인. */
export function ReplayTimeline({ replay, index, holdMs, ...props }: ReplayTimelineProps) {
  const status = useReplayStatus(replay);
  const noData = useReplayNoData(replay, index, holdMs);
  return (
    <Timeline
      {...props}
      events={index?.events ?? NO_EVENTS}
      gaps={index?.gaps ?? NO_GAPS}
      status={status}
      noData={noData}
      onSeek={(t) => seekTo(replay, t)}
      onPlay={() => replay?.play()}
      onPause={() => replay?.pause()}
      onSpeed={(speed) => replay?.setSpeed(speed)}
    />
  );
}

interface ReplayListProps {
  replay: ReplaySpatialSource | null;
  index: ReplayIndex | null;
}

/** 작업자 목록. 지금 보이는 사람은 기록이 바뀔 때만 다시 센다. */
function ReplayWorkers({
  replay,
  index,
  holdMs,
  planned,
  selectedId,
  onPick,
}: ReplayListProps & {
  holdMs: number;
  planned: number;
  selectedId: string | null;
  onPick: (worldId: string) => void;
}) {
  const frame = useReplayFrame(replay, index, holdMs);
  const visible = useMemo(() => new Set(frame?.ids), [frame]);
  return (
    <WorkerList
      workers={index?.workers ?? NO_WORKERS}
      planned={planned}
      visible={visible}
      selectedId={selectedId}
      onPick={onPick}
    />
  );
}

/** 이벤트 로그. 지금 시각에 활성인 것·앞으로 올 것을 가르려고 재생 시각을 구독한다. */
function ReplayEvents({
  replay,
  index,
  onPick,
}: ReplayListProps & { onPick: (event: EventRow) => void }) {
  const { playhead } = useReplayStatus(replay);
  return <EventLog events={index?.events ?? NO_EVENTS} playhead={playhead} onPick={onPick} />;
}

/** 오른쪽 열: 작업자 목록과 이벤트 로그. */
export function ReplayLists({
  replay,
  index,
  holdMs,
  planned,
  selectedId,
  onPickWorker,
  onPickEvent,
}: ReplayListProps & {
  holdMs: number;
  planned: number;
  selectedId: string | null;
  onPickWorker: (worldId: string) => void;
  onPickEvent: (event: EventRow) => void;
}) {
  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3.5">
      <ReplayWorkers
        replay={replay}
        index={index}
        holdMs={holdMs}
        planned={planned}
        selectedId={selectedId}
        onPick={onPickWorker}
      />
      <ReplayEvents replay={replay} index={index} onPick={onPickEvent} />
    </div>
  );
}
