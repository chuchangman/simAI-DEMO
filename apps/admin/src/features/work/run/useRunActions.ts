import { useEndWork, useSubmitReport } from '@/features/work/useWorkRun';
import { useCallback, useState } from 'react';

// 작업 종료 단계의 동작 훅: 종료 확인창, 보고서 보내기 확인창. 요청 결과는 화면이 pending 과 실패(failed·error)로만 본다.
// 종료 미팅(`review.ending`)은 서버가 종료 뒤 채운다(화면이 채워 저장하지 않는다).

const ignore = () => undefined;

/** 작업 종료: `작업 종료` 가 확인창을 열고(request), 확인하면 종료를 요청한다. 성공하면 창을 닫는다(진행이 ENDED 로 바뀐다). */
export function useEndRun(workId: string) {
  const { mutateAsync, pending, error, reset } = useEndWork();
  const [open, setOpen] = useState(false);
  const request = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);
  const cancel = useCallback(() => setOpen(false), []);
  const confirm = useCallback(() => {
    mutateAsync(workId).then(() => setOpen(false), ignore);
  }, [mutateAsync, workId]);
  return { open, pending, failed: error !== null, request, cancel, confirm };
}

/**
 * 보고서 제출: `보고서 제출` 이 확인창을 열고(request), 확인하면 제출한다. 성공하면 창을 닫고 onSubmitted 를 부른다.
 * 제출하면 진행이 SUBMITTED 로 바뀌어 이 화면이 사라질 수 있어 mutate 콜백이 아니라 약속(await)으로 이어 받는다.
 */
export function useSendReport(onSubmitted: () => void) {
  const { mutateAsync, pending, error, reset } = useSubmitReport();
  const [open, setOpen] = useState(false);
  const request = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);
  const cancel = useCallback(() => setOpen(false), []);
  const confirm = useCallback(
    (reportId: number) => {
      mutateAsync(reportId).then(() => {
        setOpen(false);
        onSubmitted();
      }, ignore);
    },
    [mutateAsync, onSubmitted],
  );
  return { open, pending, error, request, cancel, confirm };
}
