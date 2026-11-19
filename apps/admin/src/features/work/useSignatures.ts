import {
  deleteSignature,
  fetchSignatures,
  isWorkError,
  signReport,
  WORK_ERROR,
  type WorkErrorCode,
} from '@/features/work/api';
import { mutationResult } from '@/features/work/workQuery';
import { api } from '@/lib/api';
import { WORK_REPORTS_KEY, workSignaturesKey } from '@/lib/queryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// 서명 훅.

/** 보고서의 서명 목록(참석자). reportId 가 null 이면 받지 않는다. */
export function useSignatures(reportId: number | null | undefined) {
  const enabled = reportId != null;
  const query = useQuery({
    queryKey: workSignaturesKey(reportId ?? 0),
    queryFn: ({ signal }) => fetchSignatures(api, reportId ?? 0, signal),
    enabled,
  });
  return {
    data: enabled ? query.data : undefined,
    pending: enabled && query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}

/** 서명 추가가 거절돼 보고서를 다시 받아야 하는 오류: 새 판이 생겼거나 다른 곳에서 제출했다. */
const ADD_REFETCH_ERRORS = [WORK_ERROR.REPORT_VERSION_STALE, WORK_ERROR.REPORT_LOCKED];
/** 서명 삭제가 거절돼 서명 목록과 보고서를 다시 받아야 하는 오류: 다른 곳에서 제출했거나 서명이 이미 없다. */
const DELETE_REFETCH_ERRORS = [WORK_ERROR.REPORT_LOCKED, WORK_ERROR.SIGNATURE_NOT_FOUND];

const isOneOf = (error: unknown, codes: readonly WorkErrorCode[]) =>
  codes.some((code) => isWorkError(error, code));

/** 서명 추가 변수: image 는 서명 PNG(256KiB 이하), reportVersion 은 서명하는 보고서 판. */
export interface AddSignatureVariables {
  reportId: number;
  reportVersion: number;
  signerName: string;
  image: Blob;
}

/**
 * 서명을 더한다(이미지 올리기 + 서명 추가). 성공하면 서명 목록과 보고서(서명 수)를 다시 받는다.
 * 실패: SignatureUploadError(이미지), 400 INVALID_SIGNATURE, 409 REPORT_VERSION_STALE·REPORT_LOCKED·SIGNATURE_LIMIT_REACHED.
 * 새 판(REPORT_VERSION_STALE)이나 제출 잠금(REPORT_LOCKED)이면 보고서를 다시 받는다.
 */
export function useAddSignature() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ reportId, reportVersion, signerName, image }: AddSignatureVariables) =>
      signReport(api, reportId, { image, signerName, reportVersion }),
    onSuccess: (_result, { reportId }) => {
      void client.invalidateQueries({ queryKey: workSignaturesKey(reportId) });
      void client.invalidateQueries({ queryKey: WORK_REPORTS_KEY });
    },
    onError: (error) => {
      if (isOneOf(error, ADD_REFETCH_ERRORS)) {
        void client.invalidateQueries({ queryKey: WORK_REPORTS_KEY });
      }
    },
  });
  return mutationResult(mutation);
}

/** 서명 삭제 변수. */
export interface DeleteSignatureVariables {
  reportId: number;
  signatureId: string;
}

/**
 * 서명을 지운다(작업 시작 전에만. 시작했으면 409 WORK_INVALID_STATE, 제출했으면 409 REPORT_LOCKED, 서명이 없으면 404 SIGNATURE_NOT_FOUND).
 * 성공하거나 제출 잠금·서명 없음으로 실패하면 서명 목록과 보고서를 다시 받는다.
 */
export function useDeleteSignature() {
  const client = useQueryClient();
  const refetchSigners = (reportId: number) => {
    void client.invalidateQueries({ queryKey: workSignaturesKey(reportId) });
    void client.invalidateQueries({ queryKey: WORK_REPORTS_KEY });
  };
  const mutation = useMutation({
    mutationFn: ({ reportId, signatureId }: DeleteSignatureVariables) =>
      deleteSignature(api, reportId, signatureId),
    onSuccess: (_result, { reportId }) => refetchSigners(reportId),
    onError: (error, { reportId }) => {
      if (isOneOf(error, DELETE_REFETCH_ERRORS)) refetchSigners(reportId);
    },
  });
  return mutationResult(mutation);
}
