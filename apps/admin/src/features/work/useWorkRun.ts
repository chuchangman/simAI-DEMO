import {
  endWork,
  isWorkError,
  startWork,
  submitReport,
  WORK_ERROR,
  type StartPpe,
  type WorkErrorCode,
} from '@/features/work/api';
import { invalidateAfterRun, invalidateWork, mutationResult } from '@/features/work/workQuery';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';

// 작업 시작·종료와 보고서 제출. 성공하면 작업 관리 캐시(달력·하루 작업·보고서·서명)와 히스토리 목록을 다시 받게 한다.
// 변수는 작업 id(문자열) 또는 보고서 id(숫자) 하나다. 요청은 한 번에 하나만 보내도록 화면이 pending 으로 단추를 막는다.

/**
 * 작업 시작. 날짜가 오늘이 아니면 409 WORK_NOT_TODAY, 세팅을 완료하지 않았으면 409 WORK_SETUP_NOT_COMPLETED,
 * 서명이 없으면 409 WORK_NO_SIGNATURE, 진행 중인 다른 작업이 있으면 409 WORK_ALREADY_IN_PROGRESS(serverMessage 에 그 작업 이름).
 * 세팅 완료 전이라 거절되면 화면이 옛 진행 값을 보고 있으므로 하루 작업을 다시 받아 단계를 서버에 맞춘다(-642).
 */
export function useStartWork() {
  const client = useQueryClient();
  const mutation = useMutation({
    // 변수는 작업 id, 또는 작업 id 와 안전모·조끼 요구(S15P31A101-654)
    mutationFn: (vars: string | { workId: string; ppe: StartPpe }) =>
      typeof vars === 'string' ? startWork(api, vars) : startWork(api, vars.workId, vars.ppe),
    onSuccess: () => invalidateAfterRun(client),
    onError: (error) => {
      if (isWorkError(error, WORK_ERROR.SETUP_NOT_COMPLETED)) void invalidateWork(client);
    },
  });
  return mutationResult(mutation);
}

/** 작업 종료. 날짜 작업은 새 판 없이 같은 보고서의 종료 미팅을 서버가 채운다(보고서 wrap_up_status GENERATING → SUCCEEDED, 보고서는 다시 받아 latest 를 쓴다). */
export function useEndWork() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (workId: string) => endWork(api, workId),
    onSuccess: () => invalidateAfterRun(client),
  });
  return mutationResult(mutation);
}

/** 제출이 거절돼 보고서를 다시 받아야 하는 오류: 초안·종료 미팅을 쓰는 중이거나, 다른 곳에서 이미 제출했거나, 작업이 아직 안 끝났다. */
const SUBMIT_REFETCH_ERRORS: readonly WorkErrorCode[] = [
  WORK_ERROR.REPORT_NOT_READY,
  WORK_ERROR.REPORT_LOCKED,
  WORK_ERROR.INVALID_STATE,
];

/**
 * 보고서 제출·잠금. 작업이 끝난 뒤에만(아니면 409 WORK_INVALID_STATE), 이미 제출했으면 409 REPORT_LOCKED,
 * 초안이나 종료 미팅을 쓰는 중이면 409 REPORT_NOT_READY. 이 세 가지로 거절되면 화면이 옛 상태일 수 있어 보고서를 다시 받는다.
 */
export function useSubmitReport() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (reportId: number) => submitReport(api, reportId),
    onSuccess: () => invalidateWork(client),
    onError: (error) => {
      if (SUBMIT_REFETCH_ERRORS.some((code) => isWorkError(error, code))) invalidateWork(client);
    },
  });
  return mutationResult(mutation);
}
