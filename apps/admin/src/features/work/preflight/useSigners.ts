import type { WorkSignature } from '@/features/work/types';
import { useAddSignature, useDeleteSignature, useSignatures } from '@/features/work/useSignatures';
import { useWorkReport } from '@/features/work/useWorkReport';
import { useCallback, useMemo } from 'react';

// 작업 전 확인의 서명자. 작업의 최신 보고서(id·판)와 그 서명 목록, 추가·삭제를 한 묶음으로 준다.
// 보고서가 아직 없으면 ready 가 false 라 서명을 받지 않는다.

const NONE: WorkSignature[] = [];

/** setupDone 은 서버가 세팅을 끝냈는지: 끝났는데 초안이 아직 PENDING 이면 초안이 시작되길 기다리며 보고서를 다시 받는다. */
export function useSigners(workId: string, setupDone: boolean) {
  const report = useWorkReport(workId, { setupDone });
  const latest = report.data ?? null;
  const reportId = latest?.report_id ?? null;
  const list = useSignatures(reportId);
  const {
    mutateAsync: addSignature,
    pending: adding,
    error: addError,
    reset: resetAdd,
  } = useAddSignature();
  const {
    mutateAsync: deleteSignature,
    pending: removing,
    error: removeError,
    reset: resetRemove,
  } = useDeleteSignature();

  // 결재(APPROVER)는 쓰지 않는다. 참석자만 센다.
  const signers = useMemo(
    () => (list.data ?? NONE).filter((signature) => signature.signer_role === 'PARTICIPANT'),
    [list.data],
  );

  /** 서명 한 명을 더한다. 성공하면 true, 실패하면 false(이유는 addError). */
  const add = useCallback(
    async (signerName: string, image: Blob): Promise<boolean> => {
      if (!latest) return false;
      try {
        await addSignature({
          reportId: latest.report_id,
          reportVersion: latest.report_version,
          signerName,
          image,
        });
        return true;
      } catch {
        return false;
      }
    },
    [latest, addSignature],
  );

  /** 서명 한 명을 지운다(작업 시작 전에만). 성공하면 true, 실패하면 false(이유는 removeError). */
  const remove = useCallback(
    async (signatureId: string): Promise<boolean> => {
      if (reportId == null) return false;
      try {
        await deleteSignature({ reportId, signatureId });
        return true;
      } catch {
        return false;
      }
    },
    [reportId, deleteSignature],
  );

  /** 남아 있는 추가·삭제 실패 안내를 지운다(창을 다시 열 때). */
  const resetErrors = useCallback(() => {
    resetAdd();
    resetRemove();
  }, [resetAdd, resetRemove]);

  return {
    /** 서명을 받을 보고서가 있는지. */
    ready: latest != null,
    signers,
    count: signers.length,
    adding,
    removing,
    addError,
    removeError,
    add,
    remove,
    resetErrors,
  };
}

/** `useSigners` 가 주는 묶음. 서명 카드·서명 창이 같은 값을 읽는다. */
export type SignersState = ReturnType<typeof useSigners>;
