import { cancelSetupSession, setupSessionKey } from '@/features/setup/api';
import {
  BLOCKING_SETUP_KEY,
  isBlockedBySetupSession,
  monthDayLabel,
  requestBlockingSetup,
} from '@/features/setup/blockingSetup';
import { setupCancelErrorMessage } from '@/features/setup/setupErrorMessage';
import { api } from '@/lib/api';
import { Button } from '@simai/ui/components/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// 현장을 막는 세팅(409 SETUP_ALREADY_IN_PROGRESS) 오류 글 옆에 두는 취소 단추.
// 막는 세션을 찾으면 「{M월 D일} 세팅 취소」 를 보이고, 확인한 뒤 취소하면 오류를 지워(onCancelled) 다시 시도할 수 있게 한다.
// 못 찾으면(오래된 작업·맵 다시 굽기가 막는 경우 등) 아무것도 그리지 않는다.

export function BlockingSetupNotice({
  error,
  onCancelled,
}: {
  /** 거절된 요청의 오류. 막는 세팅 때문이 아니면 아무것도 그리지 않고 세션도 찾지 않는다. */
  error: unknown;
  /** 취소가 끝났다. 거절 오류를 지우는 일은 부르는 쪽이 한다. */
  onCancelled: () => void;
}) {
  const queryClient = useQueryClient();
  const blocked = isBlockedBySetupSession(error);
  const blockingQuery = useQuery({
    queryKey: BLOCKING_SETUP_KEY,
    queryFn: ({ signal }) => requestBlockingSetup(api, new Date(), signal),
    enabled: blocked,
    gcTime: 0,
    retry: false,
  });
  const cancel = useMutation({
    mutationFn: (sessionId: string) => cancelSetupSession(api, sessionId),
    onSuccess: (session) => {
      queryClient.setQueryData(setupSessionKey(session.setup_session_id), session);
      // 취소한 세션이 다음 거절 때 먼저 보이지 않게 찾은 값을 비운다
      queryClient.setQueryData(BLOCKING_SETUP_KEY, null);
      onCancelled();
    },
  });

  const blocking = blockingQuery.data;
  if (!blocked || !blocking) return null;

  const label = monthDayLabel(blocking.date);
  const requestCancel = () => {
    if (cancel.isPending) return;
    if (
      !window.confirm(
        `${label} 작업의 세팅을 취소할까요? 취소하면 그 세팅은 처음부터 다시 해야 합니다.`,
      )
    )
      return;
    cancel.mutate(blocking.sessionId);
  };

  return (
    <>
      <Button size="sm" variant="secondary" disabled={cancel.isPending} onClick={requestCancel}>
        {`${label} 세팅 취소`}
      </Button>
      {cancel.error && (
        <span role="alert" data-testid="blocking-setup-cancel-error">
          {setupCancelErrorMessage(cancel.error)}
        </span>
      )}
    </>
  );
}
