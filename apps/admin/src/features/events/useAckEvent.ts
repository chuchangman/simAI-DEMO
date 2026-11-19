import { ackErrorMessage, isStaleAckError } from '@/features/events/ack';
import { requestAck } from '@/features/events/api';
import { applyEvents, LIVE_EVENTS_KEY, writeLocalAck } from '@/features/events/eventsCache';
import { eventItemSchema } from '@/features/events/types';
import { api } from '@/lib/api';
import { ApiError, NETWORK_ERROR } from '@/lib/http';
import { isLinkAlive, useRealtimeStore } from '@/store/realtime.store';
import {
  useMutation,
  useMutationState,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

const ACK_MUTATION_KEY = ['events', 'ack'] as const;

interface AckInput {
  eventId: string;
  /** 확인 버튼을 누를 때 화면이 보던 상태. */
  eventSequence: number | undefined;
}

// 연결을 못 했거나 서버가 오류(5xx)로 답했다. 서버가 요청을 검사해 거절한 4xx 는 끊김과 상관없다.
const isUnreachable = (error: unknown) =>
  error instanceof ApiError && (error.status === NETWORK_ERROR || error.status >= 500);

/**
 * 확인 요청을 보낸다. 끊긴 화면에서 연결 실패·5xx 로 실패하면 확인을 화면 상태에만 먼저 쓰고(writeLocalAck) undefined 를 돌려준다.
 * 요청이 끝난 시점의 연결 상태로 본다. 요청이 시간 초과까지 가는 사이 끊겼을 수 있다.
 */
async function sendAck(queryClient: QueryClient, input: AckInput) {
  try {
    return await requestAck(api, input.eventId, input.eventSequence);
  } catch (error) {
    const cut = !isLinkAlive(useRealtimeStore.getState(), Date.now());
    if (
      cut &&
      isUnreachable(error) &&
      writeLocalAck(queryClient, input.eventId, input.eventSequence)
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * 이벤트 하나의 경보 확인(ACK). 낙관적 갱신을 하지 않는다(CONVENTION). 응답이 갱신된 이벤트면 바로 반영하고,
 * 아니면 서버가 다시 보내는 /topic/events 로 그린다.
 * 같은 이벤트의 확인 버튼이 배너·카드·상세에 함께 있다. 어느 버튼으로 보냈든 보내는 중이면 모두 막는다.
 *
 * 끊긴 화면에서 쓴 확인은 연결이 다시 열릴 때 bindEventsCache 가 서버에 보낸다. 이어져 있을 때의 실패는 그대로 실패 문구로 보인다.
 * 그래야 멈춘 화면의 배너와 경보음이 바로 멎는다(sendAck).
 */
export function useAckEvent(eventId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ACK_MUTATION_KEY,
    mutationFn: (input: AckInput) => sendAck(queryClient, input),
    onSuccess: (data) => {
      const event = eventItemSchema.safeParse(data);
      if (event.success) applyEvents(queryClient, [event.data]);
    },
    // 화면이 모르는 서버 상태 때문에 거절당했다. 목록을 다시 받아 카드가 새 상태를 보이게 한다.
    onError: (error) => {
      if (isStaleAckError(error)) void queryClient.invalidateQueries({ queryKey: LIVE_EVENTS_KEY });
    },
  });
  const sending = useMutationState({
    filters: {
      mutationKey: ACK_MUTATION_KEY,
      status: 'pending',
      predicate: (m) => (m.state.variables as AckInput | undefined)?.eventId === eventId,
    },
  });
  // 배너는 같은 버튼으로 다음 경보를 보인다. 이 이벤트로 보낸 요청의 실패만 보인다.
  const failed = mutation.isError && mutation.variables.eventId === eventId;
  return {
    ack: (eventSequence: number | undefined) => mutation.mutate({ eventId, eventSequence }),
    pending: sending.length > 0,
    error: failed ? ackErrorMessage(mutation.error) : undefined,
  };
}
