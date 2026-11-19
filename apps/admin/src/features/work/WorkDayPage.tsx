import { useIsAbandonedSetupSession } from '@/features/setup/abandonedSetup.store';
import { isWorkError, WORK_ERROR } from '@/features/work/api';
import { PastDayPage } from '@/features/work/past/PastDayPage';
import { PreflightStage } from '@/features/work/preflight/PreflightStage';
import { ReportStage } from '@/features/work/report/ReportStage';
import { RunStage } from '@/features/work/run/RunStage';
import { SetupStage } from '@/features/work/SetupStage';
import type { WorkDayItem } from '@/features/work/types';
import { useOpenDay } from '@/features/work/useWorkDays';
import { WorkActionProvider } from '@/features/work/WorkActionContext';
import { WorkActionLayer } from '@/features/work/WorkActionLayer';
import {
  formatDayTitle,
  isEndedWork,
  stageIndexOf,
  stageOfProgress,
  type DayKind,
  type WorkStageId,
} from '@/features/work/workDay';
import { WorkStageNav } from '@/features/work/WorkStageNav';
import { lastRun } from '@/lib/workRuns';
import { Badge } from '@simai/ui/components/badge';
import { Button } from '@simai/ui/components/button';
import { ChevronLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';

// 날짜 화면(오늘·예정인 날): 머리줄(달력 단추 · 날짜 · 오늘/예정 · 단계 줄) 아래에 단계 화면 하나를 보인다.
// 단계는 서버 progress 가 정한다. 보고서 → 세팅(세션을 만들기 전이라 서버가 아직 REPORT)만 로컬 상태가 먼저 맡는다.
// 보고서를 보내(제출·잠금) 달력으로 나간 뒤 그 날짜를 다시 열면(SUBMITTED) 단계 화면 대신 지난 날과 같은 다시 보기 화면(PastDayPage)을 보인다.
// 「한 번 더 실행」(S15P31A101-696): 종료(ENDED) 화면에서 누르면 그 종료가 이어지는 동안 작업 전 확인을 다시 연다. 시작하면 서버가
// IN_PROGRESS 로 바꿔 작업 종료 단계로 돌아가고, 그 실행이 끝나면(마지막 실행 번호가 바뀜) 다시 종료 화면이다.

/**
 * 로컬에서 먼저 넘기는 이동은 보고서 → 세팅뿐이다. 작업 전 확인(작업 시작 단추)은 서버가 세팅 완료(work_unit.setup_completed_at,
 * progress SETUP_DONE)를 알린 뒤에만 연다(-642). 세팅 완료는 세팅 화면이 하루 작업을 다시 받은 뒤 끝나므로 기다림이 없다.
 */
const NEXT_STAGE: Partial<Record<WorkStageId, WorkStageId>> = {
  report: 'setup',
};

/** 날짜 화면 맨 아래 여백(하단 메뉴 위쪽 끝 84px + 여유). 스크롤 끝에서도 메뉴·단추가 문서를 덮지 않는다. */
// 화면 높이에 맞춘 단계(세팅·작업 전 확인, data-fit-height)는 스크롤할 끝이 없으므로 하단 메뉴·단추 위쪽 끝(84px)에서 12px 위까지만 비운다
// (본문 아래 여백 14 + 82 = 96).
const DOCK_CLEARANCE = 'pb-[128px] has-[[data-fit-height]]:pb-[82px]';

const KIND_CHIP: Partial<Record<DayKind, string>> = { today: '오늘', future: '예정' };

/** 머리줄. 단계 줄은 날짜 작업을 열고 난 뒤에 children 으로 들어온다. */
function DayHeader({
  date,
  kind,
  onBack,
  children,
}: {
  date: string;
  kind: DayKind;
  onBack: () => void;
  children?: ReactNode;
}) {
  const chip = KIND_CHIP[kind];
  return (
    <header className="flex flex-none items-center gap-x-3.5 gap-y-1">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeft aria-hidden />
        달력
      </Button>
      <h2 className="text-[17px] font-bold whitespace-nowrap">{formatDayTitle(date)}</h2>
      {chip && <Badge variant="outline">{chip}</Badge>}
      {children}
    </header>
  );
}

/** 하루 작업을 못 열었을 때. 지난 날짜는 다시 시도해도 안 되므로 단추 없이 알린다. */
function OpenFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isWorkError(error, WORK_ERROR.DATE_PAST)) {
    return <p className="text-muted-foreground">지난 날짜는 새로 열 수 없어요.</p>;
  }
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      작업을 불러오지 못했습니다.
      <Button variant="secondary" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </p>
  );
}

/** 지금 단계: 로컬 단계와 서버 progress 가 가리키는 단계 중 앞선 쪽. 서버가 앞서면 따라간다. */
const furtherStage = (local: WorkStageId, server: WorkStageId): WorkStageId =>
  stageIndexOf(server) > stageIndexOf(local) ? server : local;

/** 마지막 실행 번호(시작 전이면 0). 「한 번 더 실행」을 누른 종료가 아직 그대로인지 가른다. */
const lastRunNo = (day: WorkDayItem): number =>
  lastRun({ runs: day.runs, startedAt: day.actual_started_at, endedAt: day.actual_ended_at })
    ?.run_no ?? 0;

function OpenedDay({
  day,
  date,
  kind,
  todayKey,
  localStage,
  onLocalStage,
  onRefresh,
  onBack,
  onSubmitted,
}: {
  day: WorkDayItem;
  date: string;
  kind: DayKind;
  todayKey: string;
  localStage: WorkStageId;
  onLocalStage: (stage: WorkStageId) => void;
  /** 하루 작업을 서버에서 다시 받는다(단계를 서버 progress 에 다시 맞춘다). */
  onRefresh: () => void;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const progress = day.progress ?? 'REPORT';
  // 한 번 더 실행을 누른 그 종료(마지막 실행 번호)에서만 작업 전 확인을 연다. 다른 종료면(새 실행이 끝남) 저절로 풀린다
  const [rerunAfter, setRerunAfter] = useState<number | null>(null);
  const rerunning = progress === 'ENDED' && rerunAfter !== null && rerunAfter === lastRunNo(day);
  // 「세팅 취소」로 버린 세팅만 남은 날은 서버가 세팅 단계(SETUP)여도 TBM 보고서부터 보인다(features/setup/abandonedSetup.store)
  const setupAbandoned = useIsAbandonedSetupSession(day.work_id, day.active_setup_session_id);
  const serverStage = progress === 'SETUP' && setupAbandoned ? 'report' : stageOfProgress(progress);
  const stage = rerunning ? 'preflight' : furtherStage(localStage, serverStage);
  const stageProps = {
    day,
    date,
    todayKey,
    onNext: () => onLocalStage(NEXT_STAGE[stage] ?? stage),
    // 작업 시작이 세팅 완료 전이라 막혔을 때 세팅으로 돌아간다. 로컬은 세팅까지만 앞서므로 서버 progress 를 다시 받으면 따라간다
    onBackToReport: () => onLocalStage('report'),
    onBackToSetup: () => {
      onLocalStage('setup');
      onRefresh();
    },
    ...(rerunning && {
      rerunNo: lastRunNo(day) + 1,
      onCancelRerun: () => setRerunAfter(null),
    }),
  };

  return (
    <>
      <DayHeader date={date} kind={kind} onBack={onBack}>
        <WorkStageNav stage={stage} finished={isEndedWork(day) && !rerunning} />
      </DayHeader>
      {stage === 'report' && <ReportStage {...stageProps} />}
      {stage === 'setup' && <SetupStage {...stageProps} />}
      {stage === 'preflight' && <PreflightStage {...stageProps} />}
      {stage === 'run' && (
        <RunStage
          {...stageProps}
          onSubmitted={onSubmitted}
          onRerun={() => setRerunAfter(lastRunNo(day))}
        />
      )}
    </>
  );
}

export function WorkDayPage({
  date,
  todayKey,
  onBack,
  onSubmitted,
}: {
  /** 날짜 키(YYYY-MM-DD). 오늘이거나 예정인 날이다(지난 날은 `PastDayPage`). */
  date: string;
  todayKey: string;
  /** '달력' 단추. */
  onBack: () => void;
  /** 보고서를 보내(제출·잠금) 달력으로 나가야 할 때. */
  onSubmitted: () => void;
}) {
  // 서버 progress 가 아직 못 따라온 이동(보고서 → 세팅)을 로컬이 먼저 맡는다. 서버가 따라잡을 때까지 다시 받는다.
  const [localStage, setLocalStage] = useState<WorkStageId>('report');
  const { kind, data, pending, error, refetch } = useOpenDay(date, todayKey, localStage);

  if (data?.progress === 'SUBMITTED') return <PastDayPage date={date} />;

  return (
    // 아래 여백은 떠 있는 하단 메뉴(높이 70 + 바닥에서 14 = 위쪽 끝 84px)와 우측 아래 단추 줄(WorkActionLayer)이 문서·구역 목록 끝을 가리지 않게 비운다(-734).
    // 본문(<main>)이 자기 아래 여백 14px 를 더 두므로 끝까지 내려가면 메뉴 위로 50px 넘게 여유가 남는다.
    <div className={`flex min-h-[calc(100vh-140px)] flex-none flex-col gap-3.5 ${DOCK_CLEARANCE}`}>
      <WorkActionProvider>
        {data ? (
          <OpenedDay
            day={data}
            date={date}
            kind={kind}
            todayKey={todayKey}
            localStage={localStage}
            onLocalStage={setLocalStage}
            onRefresh={() => void refetch()}
            onBack={onBack}
            onSubmitted={onSubmitted}
          />
        ) : (
          <>
            <DayHeader date={date} kind={kind} onBack={onBack} />
            {pending && <p className="text-muted-foreground">불러오는 중입니다…</p>}
            {!pending && error && <OpenFailure error={error} onRetry={() => void refetch()} />}
          </>
        )}
        <WorkActionLayer />
      </WorkActionProvider>
    </div>
  );
}
