import { isWorkError, WORK_ERROR } from '@/features/work/api';
import { isReportLocked } from '@/features/work/reportForm';
import type { ReportForm, WorkReport } from '@/features/work/types';
import { useSaveReportForm, useWorkReport } from '@/features/work/useWorkReport';
import { useState } from 'react';

/** 저장이 끝나지 못했을 때 편집 창에 보이는 글. */
export const REPORT_EDIT_NOTICE = {
  locked: '제출한 보고서는 고칠 수 없습니다',
  conflict: '다른 곳에서 먼저 고쳐서 최신 내용을 다시 불러왔습니다',
  failed: '저장하지 못했습니다',
} as const;

const isConflict = (error: unknown) =>
  isWorkError(error, WORK_ERROR.REPORT_FORM_CONFLICT) ||
  isWorkError(error, WORK_ERROR.REPORT_VERSION_STALE);

/**
 * 보고서 편집 창의 저장. 편집은 창을 연 때 받아 둔 판(`base`)을 기준으로 하고 그 `form_revision` 으로 저장한다.
 * - 다른 곳에서 먼저 고쳤거나(REPORT_FORM_CONFLICT) 새 판이 생겼으면(REPORT_VERSION_STALE) 보고서를 다시 받아 그 판으로 창을 새로 채우고 알린다
 *   (`generation` 이 바뀌면 부르는 쪽이 입력 상태를 처음부터 다시 만든다).
 * - 제출해 잠겼으면(REPORT_LOCKED) 읽기 전용(`locked`)이 되고 보고서를 다시 받아 종이도 잠근다.
 * 저장이 되면 `onSaved` 를 알리고 창을 닫는다.
 */
export function useReportEdit(
  report: WorkReport,
  { onSaved, onClose }: { onSaved?: () => void; onClose: () => void },
) {
  const { refetch } = useWorkReport(report.work_id);
  const save = useSaveReportForm();
  const [base, setBase] = useState(report);
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  /**
   * 보고서를 다시 받아 그 판으로 창을 새로 채운다. 받지 못하면 undefined. 저장 충돌·새 판 오류가 나면 저장 훅이 이미 보고서를
   * 다시 받기 시작했으므로(useSaveReportForm 의 onError) 그 요청에 합류한다(cancelRefetch: false) — 취소하고 새로 보내지 않는다.
   */
  async function reload() {
    const fresh = (await refetch({ cancelRefetch: false })).data?.latest ?? undefined;
    if (fresh) {
      setBase(fresh);
      setGeneration((count) => count + 1);
    }
    return fresh;
  }

  function lock() {
    setLocked(true);
    setNotice(REPORT_EDIT_NOTICE.locked);
  }

  async function submit(form: ReportForm) {
    setNotice(null);
    try {
      await save.mutateAsync({
        reportId: base.report_id,
        form,
        form_revision: base.form_revision,
      });
    } catch (error) {
      if (isWorkError(error, WORK_ERROR.REPORT_LOCKED)) {
        lock();
        // 종이도 잠그려고 보고서를 다시 받는다.
        void refetch();
      } else if (isConflict(error)) {
        const fresh = await reload();
        if (fresh && isReportLocked(fresh)) lock();
        else setNotice(REPORT_EDIT_NOTICE.conflict);
      } else setNotice(REPORT_EDIT_NOTICE.failed);
      return;
    }
    onSaved?.();
    onClose();
  }

  return { base, generation, notice, locked, pending: save.pending, submit };
}
