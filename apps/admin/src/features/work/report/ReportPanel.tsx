import {
  demoPaperForm,
  isWorkEnded,
  useDemoReportDraft,
  useDemoReportSync,
} from '@/features/demo/demoReport';
import { useDemoReportEdit } from '@/features/demo/demoReportEdit.store';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { H2, SECONDARY, SWITCH } from '@/features/tbm/styles';
import { draftErrorMessage } from '@/features/work/preflight/preflightErrors';
import { PaperPrint } from '@/features/work/report/PaperPrint';
import { ReportEditDialog } from '@/features/work/report/ReportEditDialog';
import { ReportLoadError } from '@/features/work/report/ReportLoadError';
import { ReportSheet } from '@/features/work/report/ReportSheet';
import { ReportView } from '@/features/work/report/ReportView';
import { usePaperPrint } from '@/features/work/report/usePaperPrint';
import { useReportPaper } from '@/features/work/report/useReportPaper';
import {
  formatDateTime,
  isDrafted,
  isReportLocked,
  reportFormOf,
} from '@/features/work/reportForm';
import type { ReportPanelProps } from '@/features/work/stageProps';
import { useStartReportDraft } from '@/features/work/useWorkReport';
import { isDraftPending, isEndingGenerating } from '@/features/work/workDay';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { Printer, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

// TBM 보고서 종이 하나. 작업의 최신 판과 서명 목록을 스스로 읽어 그리고, 고칠 수 있으면 종이를 눌러 편집 창을 연다.
// 출력은 종이 사본만 인쇄한다. 보고서가 아직 없으면(받는 중) 줄무늬 빈 종이다. 초안·종료 미팅을 쓰는 동안은 종이를 흐리게 가리고 「TBM 생성중..」을 띄운다.
// fit 이면 종이를 틀 높이에 맞춘 A4 한 장(ReportSheet)으로 줄여 보이고, 누르면 큰 창에 원래 크기로 보인다(편집은 그 창의 종이를 눌러서).
// 시연 계정은 초안을 기다리지 않고 잠깐 가렸다가 미리 적어 둔 초안을 보이고, 서버 양식에도 같은 내용을 저장한다(features/demo/demoReport).
// 그 종이는 작업 전 확인(fit)에서만 고칠 수 있고, 누르면 확대 보기 없이 바로 종이 위 편집 창이 열린다. 직접 고쳐 저장한 보고서는 그 값을 그대로 두고 종료 미팅 칸만 맞춘다.
// 종료 미팅 칸은 흐림(종료 미팅 생성 중)이 끝난 뒤에 채운다.

/** '저장했습니다' 가 보이는 시간(ms). */
const SAVED_NOTICE_MS = 2_500;

const ZOOM_TITLE = 'TBM 보고서';
const ZOOM_DIALOG =
  'h-[90vh] w-[min(920px,calc(100vw-48px))] overflow-hidden open:flex open:flex-col';

export function ReportPanel({
  workId,
  editable,
  withPrint = false,
  draftable = false,
  setupDone = false,
  fit = false,
  className,
}: ReportPanelProps & {
  /** 틀 높이에 맞춘 A4 한 장으로 줄여 보이고 누르면 크게 본다(작업 전 확인). 틀(className)의 높이가 정해져 있어야 한다. */
  fit?: boolean;
}) {
  const { query, latest, paper: serverPaper } = useReportPaper(workId);
  const draft = useStartReportDraft(workId);
  const { printing, print } = usePaperPrint();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const demoEdit = useDemoReportEdit(workId);

  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(() => setSaved(false), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const hasTasks = reportFormOf(latest).info.tasks.length > 0;
  // 초안을 쓰는 동안. 작업내용이 없으면 서버가 초안을 시작하지 않으므로(PENDING 그대로) 세팅이 끝났어도 기다리지 않는다 — 종이를 가려 편집을 막지 않게
  const demoDraft = useDemoReportDraft(workId, {
    drafting:
      draft.pending ||
      isDraftPending(latest, setupDone && hasTasks) ||
      latest?.status === 'GENERATING',
    drafted: isDrafted(latest),
    // 고칠 수 있는 종이 = 오늘 작업 흐름(지난 날짜 보고서는 읽기 전용)
    today: editable,
  });
  // 초안이나 종료 미팅을 쓰는 동안 종이를 가린다
  const endingNow = isEndingGenerating(latest);
  const generating = demoDraft.drafting || endingNow;
  // 시연 계정이 미리 적어 둔 초안이 보이는 동안 종이는 그 양식이다(작업을 끝내면 종료 미팅 칸도). 직접 고쳐 저장한 뒤에는 고친 값 그대로이고 종료 미팅 칸만 시연 문구다
  const paper = demoDraft.shown
    ? {
        ...serverPaper,
        form: demoPaperForm(serverPaper.form, serverPaper.catalog, {
          ended: isWorkEnded(latest) && !endingNow,
          edited: demoEdit.edited,
        }),
        drafted: true,
      }
    : serverPaper;
  // 서버 양식을 미리 적어 둔 초안에 맞춰 둔다. 편집 창이 열린 동안은 멈춘다
  useDemoReportSync(latest, {
    catalog: serverPaper.catalog,
    enabled: demoDraft.shown && !editing,
    edited: demoEdit.edited,
  });
  // 시연 계정이 미리 적어 둔 초안은 서버에 같은 양식이 저장돼 있어 작업 전 확인(fit)에서만 고칠 수 있다
  const canEdit =
    editable && latest !== null && !isReportLocked(latest) && (fit || !demoDraft.shown);
  // 미리 적어 둔 초안을 보이는 종이는 확대 보기 없이 바로 편집 창을 연다
  const editDirectly = canEdit && demoDraft.shown;
  const submittedAt = latest?.submitted_at ?? null;
  // 초안이 아직 시작되지 않았거나 실패했을 때만 사람이 요청한다(-624). 작업내용이 없으면 서버가 409 로 거절하므로 미리 끈다
  const draftStatus = latest?.draft_status ?? null;
  const showDraft =
    draftable && canEdit && !demoDraft.shown && (draftStatus === null || draftStatus === 'FAILED');

  return (
    <div className={cn('flex min-h-0 flex-col gap-2.5', className)}>
      {(submittedAt !== null || saved || withPrint || showDraft) && (
        <div className="flex flex-none items-center gap-2.5">
          {submittedAt !== null && (
            <span className="inline-flex items-center rounded-md px-2 py-1 text-[13px] text-ok ring-1 ring-ok/40 ring-inset">
              {`보냄 ${formatDateTime(submittedAt)}`}
            </span>
          )}
          {saved && (
            <span role="status" className="text-[13px] text-muted-foreground">
              저장했습니다
            </span>
          )}
          {showDraft && latest && (
            <Button
              variant="secondary"
              disabled={!hasTasks || draft.pending}
              title={hasTasks ? undefined : '작업내용을 먼저 골라 주세요'}
              onClick={() => draft.mutate(latest.report_id)}
              className={SWITCH}
            >
              <Sparkles />
              {draftStatus === 'FAILED' ? 'AI 초안 다시 만들기' : 'AI 초안 만들기'}
            </Button>
          )}
          {draft.error && (
            <span role="alert" className="text-[13px] text-destructive">
              {draftErrorMessage(draft.error)}
            </span>
          )}
          {withPrint && (
            <Button
              variant="secondary"
              disabled={latest === null}
              onClick={print}
              className={cn(SWITCH, 'ml-auto')}
            >
              <Printer />
              출력
            </Button>
          )}
        </div>
      )}
      {query.error && latest === null && <ReportLoadError onRetry={() => void query.refetch()} />}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          inert={generating}
          className={cn(
            'min-h-0 flex-1 p-1',
            fit ? 'flex flex-col' : 'overflow-auto',
            generating && 'blur-[3px] select-none',
          )}
        >
          {fit ? (
            <ReportSheet
              paper={{ ...paper, editable: canEdit }}
              onOpen={() => {
                // 흐리게 가린 동안(생성 중)은 크게 보지 않는다
                if (generating) return;
                if (editDirectly) setEditing(true);
                else setZoomed(true);
              }}
            />
          ) : (
            <ReportView {...paper} editable={canEdit} onEdit={() => setEditing(true)} />
          )}
        </div>
        {generating && (
          <div role="status" className="absolute inset-0 grid place-items-center">
            <span className="rounded-lg bg-card px-5 py-2.5 text-base font-bold text-foreground shadow-float ring-1 ring-border">
              TBM 생성중..
            </span>
          </div>
        )}
      </div>
      {zoomed && !generating && (
        <ModalDialog
          label={ZOOM_TITLE}
          onClose={() => setZoomed(false)}
          closeOnBackdrop
          className={ZOOM_DIALOG}
        >
          <header className="flex flex-none items-center border-b border-border px-5 py-3">
            <h2 className={H2}>{ZOOM_TITLE}</h2>
          </header>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            <ReportView
              {...paper}
              editable={canEdit}
              onEdit={() => {
                setZoomed(false);
                setEditing(true);
              }}
            />
          </div>
          <footer className="flex flex-none justify-end border-t border-border px-5 py-3">
            <Button variant="secondary" onClick={() => setZoomed(false)} className={SECONDARY}>
              닫기
            </Button>
          </footer>
        </ModalDialog>
      )}
      {editing && latest && (
        <ReportEditDialog
          report={latest}
          initialForm={demoDraft.shown ? paper.form : undefined}
          paper={
            demoDraft.shown ? { leader: paper.leader, signatures: paper.signatures } : undefined
          }
          onClose={() => setEditing(false)}
          onSaved={() => {
            setSaved(true);
            if (demoDraft.shown) demoEdit.markEdited();
          }}
        />
      )}
      {printing && (
        <PaperPrint>
          <ReportView {...paper} variant="print" />
        </PaperPrint>
      )}
    </div>
  );
}
