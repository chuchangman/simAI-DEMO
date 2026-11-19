import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { useDemoReportShown } from '@/features/demo/demoReport';
import { useGpuGate } from '@/features/gpu/useGpuGate';
import type { StartPpe } from '@/features/work/api';
import { LayoutPreview } from '@/features/work/preflight/LayoutPreview';
import {
  isSetupFinished,
  NO_CHECKS,
  type PreflightChecks,
} from '@/features/work/preflight/preflight';
import { PreflightConfirmDialog } from '@/features/work/preflight/PreflightConfirmDialog';
import { isSetupRequiredError, startErrorMessage } from '@/features/work/preflight/preflightErrors';
import { PreflightZoneList } from '@/features/work/preflight/PreflightZoneList';
import { RerunNotice } from '@/features/work/preflight/RerunNotice';
import { SignDialog } from '@/features/work/preflight/SignDialog';
import { SignerCard } from '@/features/work/preflight/SignerCard';
import { useSigners } from '@/features/work/preflight/useSigners';
import { useStartWarnings } from '@/features/work/preflight/useStartWarnings';
import { WatchSummaryCard } from '@/features/work/preflight/WatchSummaryCard';
import { ZoneEditDialog } from '@/features/work/preflight/ZoneEditDialog';
import { ReportPanel } from '@/features/work/report/ReportPanel';
import type { WorkStageProps } from '@/features/work/stageProps';
import { useWorkReport } from '@/features/work/useWorkReport';
import { useStartWork } from '@/features/work/useWorkRun';
import { useWorkAction, type WorkActionConfig } from '@/features/work/WorkActionContext';
import { draftWarning } from '@/features/work/workDay';
import { useZones } from '@/features/zones/useZones';
import { cn } from '@simai/ui/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

// 단계 3 '작업 전 확인': 왼쪽에 TBM 보고서(고칠 수 있고 출력도 된다), 오른쪽에 가상 레이아웃(3D)·참석자 서명·구역 목록.
// 아래 오른쪽 단추 '다음'을 누르면 확인창(보고서·레이아웃 확인 + 서명 1명 이상)이 뜨고, '작업 시작'이 서버 작업을 시작한다.
// 시작에 성공하면 실시간 관제(/live)로 간다. 관제 화면은 이번 작업 설정이 현장에 적용될 때까지 「관제 준비 중」을 보이고 적용되면
// 「관제 중」이 된다(S15P31A101-692). 작업 관리로 돌아오면 서버 진행 값(IN_PROGRESS)대로 작업 종료 단계가 열린다.
// 오른쪽에는 워치(이름·기기·연결) 요약도 둔다(-692, 시작을 막지 않는다).
// 한 번 더 실행(S15P31A101-696, rerunNo)이면 맨 위에 실행 번호와 카메라 재점검 안내를 두고, 확인창의 체크·서명·보호구를 다시 받는다.
// 「작업 종료로」 보조 단추가 종료 화면으로 돌아간다(서버는 아무것도 바뀌지 않았다).
// 시연 계정(features/demo/demoAccount)은 워치 요약을 보이지 않고, 「다음」이 확인창 없이 바로 작업을 시작한다(실패하면 그때 확인창을 열어 오류를 보인다).

type Dialog = 'confirm' | 'sign' | null;

/**
 * 본문 높이: 화면에서 상단 바(60)·본문 위 여백(14)·날짜 머리줄(28)·간격(14)·하단 메뉴 비움(96)을 뺀 만큼이라 페이지가
 * 스크롤되지 않는다. 넓은 화면은 두 칸이 이 높이를 나눠 쓰고(종이는 이 높이에 맞춘 A4 한 장), 좁은 화면은 종이 칸만 이 높이다.
 */
const BODY_GRID =
  'grid items-start gap-4 min-[960px]:h-[max(360px,calc(100dvh-212px))] min-[960px]:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)] min-[960px]:items-stretch';
const REPORT_COLUMN =
  'flex h-[max(360px,calc(100dvh-212px))] min-h-0 min-w-0 flex-col min-[960px]:h-auto';
/**
 * 오른쪽 칸: 3D 레이아웃이 남는 높이를 채운다. 카드는 내용보다 작게 줄지 않고(잘리지 않게), 그래도 넘치는 낮은 화면에서만 칸 안에서
 * 스크롤한다.
 */
const SIDE_COLUMN = 'flex min-h-0 min-w-0 flex-col gap-3 *:shrink-0 min-[960px]:overflow-y-auto';

export function PreflightStage({ day, onBackToSetup, rerunNo, onCancelRerun }: WorkStageProps) {
  const workId = day.work_id;
  // 작업 시작은 세팅 완료 뒤다(서버 setup_completed_at → progress SETUP_DONE, -642). 날짜 화면은 그때만 이 단계를 연다
  const setupDone = isSetupFinished(day.progress);
  const signers = useSigners(workId, setupDone);
  const start = useStartWork();
  // 확인창의 AI 초안 경고(-625). ReportPanel 과 같은 쿼리라 요청이 더 나가지 않는다
  const { data: report } = useWorkReport(workId);
  const demo = useIsDemoAccount();
  // 시연 계정이 미리 적어 둔 초안을 보였으면 초안 경고를 띄우지 않는다(features/demo/demoReport)
  const demoReportShown = useDemoReportShown(workId);
  const { zones, raw: zonesRaw, failed: zonesFailed } = useZones();
  const [checks, setChecks] = useState<PreflightChecks>(NO_CHECKS);
  // 작업 중 보호구 요구(S15P31A101-654). 기본 필수, 끄면 그 장비는 R9·R11 을 판정하지 않는다
  const [ppe, setPpe] = useState<StartPpe>(() => ({
    helmet: day.helmet ?? 'REQUIRED',
    vest: day.vest ?? 'REQUIRED',
  }));
  const [dialog, setDialog] = useState<Dialog>(null);
  // 확인창의 경고 줄(보호구 상태 미수신·워치 0대, -730). 창이 열려 있을 때만 PPE 수신을 묻는다
  const startWarnings = useStartWarnings(ppe, dialog === 'confirm');
  // 편집 창을 연 구역(없으면 창이 닫혀 있다).
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);

  const navigate = useNavigate();
  const { reset: resetStart, mutateAsync: startWork } = start;
  // 작업 시작(= 관제 시작)에는 GPU 가 필요하다. 꺼져 있거나 준비 중이면 GPU 경고창을 띄우고 연결되면 이어서 시작한다(S15P31A101-702)
  const gpuGate = useGpuGate();
  const closeDialog = useCallback(() => setDialog(null), []);
  // 요청 중에는 확인창의 '작업 시작'이 pending 으로 잠겨 같은 시작을 두 번 보내지 않는다.
  // 결과는 약속으로 받는다: 시작에 성공하면 진행 값이 바뀌어 이 단계가 먼저 내려가고, 그러면 mutate 에 건 onSuccess 는 불리지 않아 관제로 가지 못했다
  const sendStart = useCallback(
    () =>
      void startWork({ workId, ppe }).then(
        () => {
          closeDialog();
          void navigate({ to: '/live' });
        },
        // 시연 계정은 확인창 없이 시작하므로 실패하면 확인창을 열어 오류를 보인다
        () => {
          if (demo) setDialog('confirm');
        },
      ),
    [startWork, workId, ppe, closeDialog, navigate, demo],
  );
  const { guard } = gpuGate;
  const beginWork = useCallback(() => guard(sendStart), [guard, sendStart]);

  // 아래 오른쪽 단추 '다음': 지난 시작 실패 안내를 지우고 확인창을 연다(시연 계정은 창 없이 바로 시작한다). 값이 같으면 다시 등록하지 않게 한 번만 만든다.
  const openConfirm = useCallback(() => {
    resetStart();
    if (demo) beginWork();
    else setDialog('confirm');
  }, [demo, resetStart, beginWork]);
  const action = useMemo<WorkActionConfig>(
    () => ({
      label: '다음',
      enabled: true,
      onClick: openConfirm,
      // 시작 요청 중에는 눌러도 같은 시작을 다시 보내지 않는다(확인창이 없는 시연 계정)
      pending: start.pending,
      secondary: onCancelRerun ? [{ label: '작업 종료로', onClick: onCancelRerun }] : undefined,
    }),
    [openConfirm, start.pending, onCancelRerun],
  );
  useWorkAction(action);

  const loaded = zonesRaw !== undefined;

  return (
    <div
      data-fit-height
      className={cn(
        BODY_GRID,
        rerunNo === undefined
          ? 'min-[960px]:grid-rows-[minmax(0,1fr)]'
          : 'min-[960px]:grid-rows-[auto_minmax(0,1fr)]',
      )}
    >
      {rerunNo !== undefined && <RerunNotice runNo={rerunNo} />}
      <div className={REPORT_COLUMN}>
        <ReportPanel
          workId={workId}
          editable
          withPrint
          draftable
          setupDone={setupDone}
          fit
          className="flex-1"
        />
      </div>
      <div className={SIDE_COLUMN}>
        <LayoutPreview
          zoneCount={loaded ? zones.length : null}
          zonesRaw={zonesRaw}
          onPickZone={setEditingZoneId}
        />
        <SignerCard signers={signers} onSign={() => setDialog('sign')} />
        {!demo && <WatchSummaryCard />}
        <PreflightZoneList
          zones={zones}
          loaded={loaded}
          failed={zonesFailed}
          onOpen={setEditingZoneId}
        />
      </div>
      {dialog === 'confirm' && (
        <PreflightConfirmDialog
          checks={checks}
          onChecksChange={setChecks}
          ppe={ppe}
          onPpeChange={setPpe}
          signerCount={signers.count}
          pending={start.pending}
          error={start.error ? startErrorMessage(start.error) : null}
          draftWarning={demoReportShown ? null : draftWarning(report)}
          warnings={startWarnings}
          setupCompleted={setupDone}
          setupBlocked={isSetupRequiredError(start.error)}
          onGoSetup={
            onBackToSetup &&
            (() => {
              closeDialog();
              onBackToSetup();
            })
          }
          onSign={() => setDialog('sign')}
          onStart={beginWork}
          onCancel={closeDialog}
        />
      )}
      {dialog === 'sign' && <SignDialog signers={signers} onClose={closeDialog} />}
      {gpuGate.dialog}
      {editingZoneId !== null && (
        <ZoneEditDialog zoneId={editingZoneId} onClose={() => setEditingZoneId(null)} />
      )}
    </div>
  );
}
