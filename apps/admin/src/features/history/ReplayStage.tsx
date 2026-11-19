import { CctvFigures, CctvMockWall } from '@/features/cctv/CctvDemo';
import { cctvPeople, type CctvProjector } from '@/features/cctv/cctvMockView';
import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { formatTime } from '@/features/events/events';
import { replayErrorLine } from '@/features/history/replay';
import { allGap, isEmptyReplay, type ReplayIndex } from '@/features/history/replayIndex';
import { preloadAt } from '@/features/history/replaySegments';
import { ReplayVideoWall } from '@/features/history/ReplayVideoWall';
import type { Span, VideoSegment } from '@/features/history/types';
import { useActiveSegments, useReplaySegments } from '@/features/history/useReplaySegments';
import {
  useReplayFrame,
  useReplayNoData,
  useReplayPending,
  type WorkReplay,
} from '@/features/history/useWorkReplay';
import type { ReplaySpatialSource } from '@/features/viewer3d';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

const LOADING_LINE = '기록을 불러오는 중입니다…';

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * CCTV 4화면. 재생 시각을 덮는 영상 조각(상시 조각·관제 뒤 올린 녹화 mp4)이 있으면 그 영상을 카메라 칸마다 틀고, 없으면 목 화면이다.
 * 영상을 끝내 받지 못한 조각은 빼고, 남은 조각이 없으면 목 화면(3D 다시 보기)으로 돌아간다(S15P31A101-668).
 * 목 화면은 재생 시각에 보이는 World 기록의 사람을 그리고, 기록이 바뀔 때만 다시 그린다.
 * 데이터 없음이면 사람을 그리지 않고 흐리게 둔다(마지막 기록을 이어 그리지 않는다, FR-28). 기록이 없어도 기록 없는 구간
 * 밖이면 그 시각에 아무도 없던 것이라 빈 화면을 그대로 보인다.
 * 아직 받지 못한 뒷구간의 시각이면 목 화면 대신 불러오는 중 안내를 보인다(영상은 기록과 상관없이 튼다).
 * 시연 계정은 한 칸을 크게 볼 때 나머지 칸을 큰 칸 아래 한 줄에 두고, 영상 실패 안내 줄을 보이지 않는다.
 */
function ReplayCctv({
  replay,
  index,
  holdMs,
  segments,
}: {
  replay: ReplaySpatialSource | null;
  index: ReplayIndex | null;
  holdMs: number;
  /** 작업 구간과 겹치는 영상 조각 전부. 지금 시각을 덮는 것만 골라 튼다. */
  segments: readonly VideoSegment[];
}) {
  const frame = useReplayFrame(replay, index, holdMs);
  const noData = useReplayNoData(replay, index, holdMs);
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(() => new Map());
  const playable = useMemo(
    () => segments.filter((segment) => !failed.has(segment.segment_id)),
    [segments, failed],
  );
  const onFailed = useCallback(
    (id: string, message = '영상을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.') =>
      setFailed((held) => (held.has(id) ? held : new Map(held).set(id, message))),
    [],
  );
  const active = useActiveSegments(replay, playable);
  const upcoming = useActiveSegments(replay, playable, preloadAt);
  const pending = useReplayPending(replay, index);
  const demo = useIsDemoAccount();
  const rest = demo ? 'below' : 'side';
  const people = useMemo(() => (frame ? cctvPeople(frame.tracks) : []), [frame]);
  const figures = useCallback(
    (project: CctvProjector) => <CctvFigures project={project} people={people} />,
    [people],
  );
  const wall =
    active.length > 0 ? (
      <ReplayVideoWall
        segments={active}
        upcoming={upcoming}
        replay={replay}
        onFailed={onFailed}
        rest={rest}
      />
    ) : pending ? (
      <Notice>{LOADING_LINE}</Notice>
    ) : (
      <CctvMockWall
        figures={figures}
        frozen={noData}
        badge={noData ? '데이터 없음' : frame ? formatTime(frame.t) : '작업자 없음'}
        rest={rest}
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!demo && failed.size > 0 && (
        <p role="status" className="p-2 text-sm text-muted-foreground">
          {Array.from(new Set(failed.values())).join(' ')}
          <button type="button" className="ml-3" onClick={() => setFailed(new Map())}>
            영상 다시 확인
          </button>
        </p>
      )}
      {/* 칸 배치(CctvWall)는 남은 높이를 flex-1 로 받아 컨테이너 크기(cqh)로 칸을 잰다. 감싸는 칸이 flex 열이 아니면 높이 0 으로 접혀 빈 화면이 된다(S15P31A101-749). */}
      <div className="flex min-h-0 flex-1 flex-col">{wall}</div>
    </div>
  );
}

interface ReplayStageProps {
  session: WorkReplay;
  /** 작업 구간. */
  range: Span;
}

/** 화면 가운데 안내 한 줄. 보일 기록이 있으면 null. 기록이 하나도 없을 때 구간 길이·데이터 없음 여부를 구분해 사유를 알린다. */
function stageNotice(session: WorkReplay, range: Span): string | null {
  if (session.failed) return replayErrorLine(session.error);
  if (session.loading || !session.replay) return LOADING_LINE;
  if (!session.index || !isEmptyReplay(session.index)) return null;
  if (range.to - range.from < 1_000) {
    return '작업이 시작 직후 바로 종료되어(1초 미만) 저장된 기록이 없습니다.';
  }
  return allGap(session.index.gaps, range)
    ? '작업 구간 동안 관제 데이터를 받지 못해 저장된 3D 기록이 없습니다.'
    : '작업 시간 동안 감지된 작업자와 위험 이벤트가 없습니다.';
}

/** 3D 기록이 하나도 없을 때는 상단 영상 상태 문구에서 '3D 기록 먼저 보기' 안내를 뺀다(본문에 볼 3D 기록이 없으므로 모순을 막는다). */
function stageSegmentMessage(message: string | null, index: ReplayIndex | null): string | null {
  if (!message) return null;
  if (index === null || !isEmptyReplay(index)) return message;
  return message.replace(' · 3D 기록 먼저 보기', '').replace(' 3D 기록을 먼저 볼 수 있습니다.', '');
}

/**
 * 가운데 칸: CCTV 목 화면. 기록을 받는 중·실패·없음이면 안내만 보인다.
 * 영상 조각 목록은 기록을 받는 동안 같이 받아 둔다(기록이 준비된 뒤에 요청하면 영상이 그만큼 늦게 켜진다).
 * 시연 계정은 위쪽 영상 상태 줄(업로드 실패·다시 확인)을 보이지 않는다.
 */
export function ReplayStage({ session, range }: ReplayStageProps) {
  const { replay, index, holdMs } = session;
  const { segments, message, refresh, canRefresh } = useReplaySegments(range);
  const notice = stageNotice(session, range);
  const demo = useIsDemoAccount();
  const segmentMessage = demo ? null : stageSegmentMessage(message, index);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {segmentMessage && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 p-2 text-sm text-muted-foreground"
        >
          <span>{segmentMessage}</span>
          {canRefresh && (
            <button type="button" onClick={() => void refresh()}>
              다시 확인
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {notice !== null ? (
          <Notice>{notice}</Notice>
        ) : (
          <ReplayCctv replay={replay} index={index} holdMs={holdMs} segments={segments} />
        )}
      </div>
    </div>
  );
}
