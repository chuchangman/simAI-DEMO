import {
  fetchReportsByWork,
  isWorkError,
  saveReportForm,
  startReportDraft,
  WORK_ERROR,
  WORK_REPORT_POLL_MS,
} from '@/features/work/api';
import type { ReportForm, ReportsByWork } from '@/features/work/types';
import { isDraftPending, isEndingGenerating } from '@/features/work/workDay';
import { mutationResult } from '@/features/work/workQuery';
import { api } from '@/lib/api';
import {
  WORK_DAYS_KEY,
  WORK_OPEN_DAY_KEY,
  WORK_REPORTS_KEY,
  workReportsKey,
} from '@/lib/queryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// 보고서 훅.

/**
 * 작업의 최신 보고서(undefined 는 받는 중, null 은 보고서 없음).
 * 초안을 기다리는 동안(GENERATING, 또는 setupDone 인데 서버가 아직 PENDING)과 서버가 종료 미팅을 채우는 동안
 * (`wrap_up_status` GENERATING)은 2초마다 다시 받는다 — 세팅이 끝나면 setupDone 을 true 로 넘긴다(작업 항목의 progress 가 SETUP_DONE 이상).
 */
export function useWorkReport(
  workId: string | null | undefined,
  { setupDone = false }: { setupDone?: boolean } = {},
) {
  const enabled = Boolean(workId);
  const query = useQuery({
    queryKey: workReportsKey(workId ?? ''),
    queryFn: ({ signal }) => fetchReportsByWork(api, workId ?? '', signal),
    enabled,
    refetchInterval: (q) => {
      const report = q.state.data?.latest;
      return isDraftPending(report, setupDone) || isEndingGenerating(report)
        ? WORK_REPORT_POLL_MS
        : false;
    },
  });
  return {
    data: enabled ? query.data?.latest : undefined,
    pending: enabled && query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}

/** 양식 저장 변수. form_revision 은 마지막으로 읽은 값이다. */
export interface SaveReportFormVariables {
  reportId: number;
  form: ReportForm;
  form_revision: number;
}

/**
 * 양식을 통째로 저장한다. 성공하면 돌려받은 보고서로 최신 판 캐시를 바꾸고(작업명이 바뀌었을 수 있어 달력·하루 작업도 다시 받는다),
 * 다른 곳에서 먼저 고쳤거나(REPORT_FORM_CONFLICT) 새 판이 생겼으면(REPORT_VERSION_STALE) 보고서를 다시 받게 한다.
 * 제출 뒤에는 REPORT_LOCKED(409)로 거절된다.
 */
export function useSaveReportForm() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ reportId, form, form_revision }: SaveReportFormVariables) =>
      saveReportForm(api, reportId, { form, form_revision }),
    onSuccess: (report) => {
      client.setQueryData<ReportsByWork>(workReportsKey(report.work_id), (prev) =>
        prev && prev.latest?.report_id === report.report_id ? { ...prev, latest: report } : prev,
      );
      void client.invalidateQueries({ queryKey: WORK_DAYS_KEY });
      void client.invalidateQueries({ queryKey: WORK_OPEN_DAY_KEY });
    },
    onError: (error) => {
      if (
        isWorkError(error, WORK_ERROR.REPORT_FORM_CONFLICT) ||
        isWorkError(error, WORK_ERROR.REPORT_VERSION_STALE)
      ) {
        void client.invalidateQueries({ queryKey: WORK_REPORTS_KEY });
      }
    },
  });
  return mutationResult(mutation);
}

/**
 * AI 양식 초안을 요청한다(-624). 세팅 완료(-615) 커밋 뒤 서버가 시작하지만(작업내용을 골랐을 때), 그 전이나 실패(FAILED) 뒤에도
 * 사람이 시작할 수 있게 둔다.
 * 끝나면(이미 생성 중 409 REPORT_IN_PROGRESS 포함) 보고서를 다시 받아 GENERATING 을 보이고, 그 뒤는 useWorkReport 가 2초마다 다시 받는다.
 */
export function useStartReportDraft(workId: string) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (reportId: number) => startReportDraft(api, reportId),
    onSettled: () => void client.invalidateQueries({ queryKey: workReportsKey(workId) }),
  });
  return mutationResult(mutation);
}
