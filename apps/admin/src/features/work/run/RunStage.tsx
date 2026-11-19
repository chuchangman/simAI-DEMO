import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { ALERT } from '@/features/tbm/styles';
import { ConfirmDialog } from '@/features/work/ConfirmDialog';
import { ReportPanel } from '@/features/work/report/ReportPanel';
import { AppliedStatusCard } from '@/features/work/run/AppliedStatusCard';
import { EndAlarmNote } from '@/features/work/run/EndAlarmNote';
import { EndAlertStatus } from '@/features/work/run/EndAlertStatus';
import { EndGpuCard } from '@/features/work/run/EndGpuCard';
import { EndSummaryCard } from '@/features/work/run/EndSummaryCard';
import { EventListCard } from '@/features/work/run/EventListCard';
import { submitBlockReason } from '@/features/work/run/run';
import { sendErrorMessage } from '@/features/work/run/runErrors';
import { RunHistory } from '@/features/work/run/RunHistory';
import { RunStatusCard } from '@/features/work/run/RunStatusCard';
import { useEndRun, useSendReport } from '@/features/work/run/useRunActions';
import { useRunAlarms } from '@/features/work/run/useRunAlarms';
import type { RunStageProps } from '@/features/work/stageProps';
import type { WorkDayItem } from '@/features/work/types';
import { useSignatures } from '@/features/work/useSignatures';
import { useWorkReport } from '@/features/work/useWorkReport';
import { useWorkAction, type WorkActionConfig } from '@/features/work/WorkActionContext';
import { draftWarning, isReportGenerating } from '@/features/work/workDay';
import { lastRun, openRun } from '@/lib/workRuns';
import { useMemo } from 'react';

// 단계 4 '작업 종료'. 서버 진행(progress)이 두 모양을 정한다: 진행 중(IN_PROGRESS) → 종료(ENDED).
// 보낸(SUBMITTED) 뒤에는 날짜 화면이 이 단계 대신 지난 날과 같은 다시 보기 화면을 보인다(WorkDayPage).
// 서명은 작업 전 확인에서 이미 받았다. 단추 줄은 useWorkAction 으로 등록한다(`작업 종료` → `보고서 제출` / `한 번 더 실행`,
// S15P31A101-691: 진행 중의 `다음` 이 실제로는 종료라 이름을 `작업 종료` 로 바꿨다).
// 한 번 더 실행(S15P31A101-696): 같은 날 리허설 뒤 본 시연. 보고서를 내기 전이면 작업 전 확인(서명 재확인·보호구)을 거쳐 실행 2 를 연다.
// 진행 중 화면의 경과·경보 기록·관제 적용은 지금 실행 기준이다.
// 시연 계정(features/demo/demoAccount)은 종료 확인창에 제목만 두고, 종료 뒤에는 보고서만 보인다.

const SPLIT =
  'grid grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)] items-start gap-4 max-[960px]:grid-cols-1';

function FailureNote({ text }: { text: string }) {
  return (
    <p role="alert" className={ALERT}>
      {text}
    </p>
  );
}

/** 1. 진행 중: 왼쪽 보고서(제출 전까지 고칠 수 있다), 오른쪽 작업 현황·경보 기록·관제 적용 상태. `작업 종료` 가 종료를 묻는다. */
function RunningView({ day }: { day: WorkDayItem }) {
  const end = useEndRun(day.work_id);
  // 지금 실행의 시작(실행 2 면 실행 2 시작). 옛 서버(runs 없음)는 작업 시작이다
  const runStart =
    openRun({ runs: day.runs, startedAt: day.actual_started_at, endedAt: null })?.started_at ??
    day.actual_started_at;
  const { data: report } = useWorkReport(day.work_id);
  const signers = useSignatures(report?.report_id).data;
  // 종료 확인창의 「미확인 위험 경보 n건」: 서버가 준 이벤트 목록·확인 기록으로 센다(막지 않고 알린다, -734)
  const alarms = useRunAlarms(runStart);
  const demo = useIsDemoAccount();
  const action = useMemo<WorkActionConfig>(
    () => ({
      label: '작업 종료',
      enabled: !end.pending,
      pending: end.pending,
      onClick: end.request,
    }),
    [end.pending, end.request],
  );
  useWorkAction(action);
  return (
    <>
      <div className={SPLIT}>
        <div className="min-w-0">
          <ReportPanel workId={day.work_id} editable withPrint />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <RunStatusCard day={day} signerCount={signers?.length} />
          <EventListCard startedAt={runStart} zoneId={day.zone_id} />
          <AppliedStatusCard workId={day.work_id} startedAt={runStart} />
        </div>
      </div>
      {end.open && (
        <ConfirmDialog
          title="작업을 종료할까요?"
          description={
            demo ? undefined : '종료한 뒤 보고서를 내기 전이면 한 번 더 실행할 수 있습니다.'
          }
          confirmLabel="종료"
          pending={end.pending}
          onConfirm={end.confirm}
          onCancel={end.cancel}
        >
          {!demo && <EndAlarmNote alarms={alarms} />}
          {end.failed && <FailureNote text="작업을 종료하지 못했습니다. 다시 시도해 주세요." />}
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * 2. 종료: 위에 현장 경보 종료 확인(종료 묶음 적용, -692)과 실행 기록, 아래 종료 미팅이 든 보고서(보내기 전까지 고칠 수 있다).
 * `보고서 제출` 이 보낼지 묻고, `한 번 더 실행` 은 작업 전 확인으로 간다(S15P31A101-696, 보고서는 하루 끝에 한 번 낸다).
 * 종료 미팅은 서버가 채운다(`wrap_up_status` GENERATING 인 동안 보고서를 다시 받는다). 서버는 종료 미팅이나 AI 초안(`status`)을
 * 쓰는 중이면 제출을 받지 않으므로(409 REPORT_NOT_READY) `보고서 제출` 은 그동안 꺼 둔다.
 */
function EndedView({
  day,
  onSubmitted,
  onRerun,
}: {
  day: WorkDayItem;
  onSubmitted: () => void;
  onRerun?: () => void;
}) {
  const { data: report, error: reportError } = useWorkReport(day.work_id);
  const demo = useIsDemoAccount();
  const send = useSendReport(onSubmitted);
  const reportId = report?.report_id;
  const filling = isReportGenerating(report);
  // 꺼진 이유는 단추 옆에 늘 보인다(문서 속 흐린 글이나 hover 에 기대지 않는다, -734)
  const blockedBy = submitBlockReason(report, reportError !== null);
  const endedAt =
    lastRun({ runs: day.runs, startedAt: day.actual_started_at, endedAt: day.actual_ended_at })
      ?.ended_at ?? day.actual_ended_at;
  const action = useMemo<WorkActionConfig>(
    () => ({
      label: '보고서 제출',
      enabled: reportId !== undefined && !filling && !send.pending,
      pending: send.pending,
      onClick: send.request,
      reason: blockedBy ?? undefined,
      secondary: onRerun
        ? [{ label: '한 번 더 실행', onClick: onRerun, disabled: send.pending }]
        : undefined,
    }),
    [reportId, filling, blockedBy, send.pending, send.request, onRerun],
  );
  useWorkAction(action);
  return (
    <>
      {!demo && (
        <>
          <EndAlertStatus workId={day.work_id} endedAt={endedAt} />
          <RunHistory day={day} />
          <div className="grid items-start gap-3 min-[960px]:grid-cols-2">
            <EndSummaryCard day={day} />
            <EndGpuCard canRerun={onRerun !== undefined} />
          </div>
        </>
      )}
      <div className="min-w-0">
        <ReportPanel workId={day.work_id} editable withPrint />
      </div>
      {send.open && reportId !== undefined && (
        <ConfirmDialog
          title="보고서를 제출할까요?"
          description="제출한 뒤에는 고칠 수 없습니다."
          confirmLabel="제출"
          pending={send.pending}
          onConfirm={() => send.confirm(reportId)}
          onCancel={send.cancel}
        >
          {/* AI 초안이 끝나지 않았으면 위험·대책·점검 칸이 빈 채 잠길 수 있다(-625). 막지는 않는다 */}
          {draftWarning(report) && (
            <p className="text-[13px] text-sev-caution">{draftWarning(report)}</p>
          )}
          {send.error && <FailureNote text={sendErrorMessage(send.error)} />}
        </ConfirmDialog>
      )}
    </>
  );
}

export function RunStage({ day, onSubmitted, onRerun }: RunStageProps) {
  switch (day.progress) {
    case 'IN_PROGRESS':
      return <RunningView day={day} />;
    case 'ENDED':
      return <EndedView day={day} onSubmitted={onSubmitted} onRerun={onRerun} />;
    default:
      return null;
  }
}
