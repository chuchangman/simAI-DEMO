import { requestSummary as postSummary } from '@/features/events/api';
import { ec2Now } from '@/features/events/format';
import {
  isSummaryInProgress,
  latestSummary,
  normalizeSummaryResponse,
  summaryErrorMessage,
  type LocalSummaryRecord,
} from '@/features/events/summary';
import type { EventItem } from '@/features/events/types';
import { api } from '@/lib/api';
import { useRealtimeStore } from '@/store/realtime.store';
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

/** 구간 요약 요청 응답(대기·실행) 상태의 Query 키(event_id → LocalSummaryRecord). */
export const SUMMARY_STATE_KEY = ['events', 'summaries'] as const;

const SUMMARY_MUTATION_KEY = ['events', 'summary'] as const;

export type SummaryStateByEvent = Readonly<Record<string, LocalSummaryRecord>>;

const NONE: SummaryStateByEvent = Object.freeze({});
const OPTIONS = { staleTime: Infinity, gcTime: Infinity } as const;

/** 같은 QueryClient 안에서 같은 이벤트로 나가는 중복 요약 요청을 동기 시점부터 막는다. */
const inFlightByClient = new WeakMap<QueryClient, Set<string>>();

function getInFlight(queryClient: QueryClient): Set<string> {
  let set = inFlightByClient.get(queryClient);
  if (!set) {
    set = new Set<string>();
    inFlightByClient.set(queryClient, set);
  }
  return set;
}

export interface RequestSummaryInput {
  event: EventItem;
  seenSummariesRef: EventItem['summaries'];
}

/** 응답으로 받은 구간 요약 대기·실행 상태를 이벤트별 캐시에 기록한다(이벤트 자체의 severity 는 바꾸지 않는다). */
export function recordSummaryState(
  queryClient: QueryClient,
  eventId: string,
  record: LocalSummaryRecord,
) {
  const old = queryClient.getQueryData<SummaryStateByEvent>(SUMMARY_STATE_KEY) ?? NONE;
  queryClient.setQueryData<SummaryStateByEvent>(SUMMARY_STATE_KEY, {
    ...old,
    [eventId]: record,
  });
}

/** 이벤트별 구간 요약 요청 응답 상태(POST 응답 기록). */
export function useSummaryState(): SummaryStateByEvent {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: SUMMARY_STATE_KEY,
    queryFn: () => queryClient.getQueryData<SummaryStateByEvent>(SUMMARY_STATE_KEY) ?? NONE,
    ...OPTIONS,
    retry: false,
    refetchOnMount: false,
  });
  return data ?? NONE;
}

/**
 * 이벤트 하나의 사고 구간 요약 요청(POST /api/events/{id}/summary).
 * - 요청 중에는 pending 으로 잠그고, 같은 이벤트에 대한 중복 클릭·요청을 동기 시점부터 막는다.
 * - 이미 대기(QUEUED)·실행 중(RUNNING)이거나 완료(SUCCEEDED)된 요약이 있으면 중복 요청을 보내지 않는다.
 * - 요약 요청·결과는 AI 설명일 뿐 이벤트 등급(event.severity)이나 경보 상태에 영향을 주지 않는다(AGENTS 규칙 4).
 */
export function useIncidentSummary(eventId: string) {
  const queryClient = useQueryClient();
  const stateByEvent = useSummaryState();
  const localRecord = stateByEvent[eventId];

  const mutation = useMutation({
    mutationKey: SUMMARY_MUTATION_KEY,
    mutationFn: async (input: RequestSummaryInput) => {
      const targetId = input.event.event_id;
      const inFlight = getInFlight(queryClient);
      inFlight.add(targetId);
      try {
        return await postSummary(api, targetId);
      } finally {
        inFlight.delete(targetId);
      }
    },
    onSuccess: (data, variables) => {
      const targetId = variables.event.event_id;
      const now =
        variables.event.updated_at ??
        variables.event.raised_at ??
        ec2Now(Date.now(), useRealtimeStore.getState().health?.clockOffsetMs);
      const record = normalizeSummaryResponse(data, {
        event: variables.event,
        now,
      });
      recordSummaryState(queryClient, targetId, record);
    },
  });

  const sending = useMutationState({
    filters: {
      mutationKey: SUMMARY_MUTATION_KEY,
      status: 'pending',
      predicate: (m) =>
        (m.state.variables as RequestSummaryInput | undefined)?.event.event_id === eventId,
    },
  });

  const pending = sending.length > 0;
  const failed = mutation.isError && mutation.variables?.event.event_id === eventId;

  const requestSummary = (event: EventItem) => {
    const targetId = event.event_id;
    const inFlight = getInFlight(queryClient);
    if (inFlight.has(targetId) || pending) return;
    const currentLocal =
      queryClient.getQueryData<SummaryStateByEvent>(SUMMARY_STATE_KEY)?.[targetId];
    const current = latestSummary(event, currentLocal);
    if (isSummaryInProgress(current) || current?.status === 'SUCCEEDED') return;
    inFlight.add(targetId);
    mutation.mutate({
      event,
      seenSummariesRef: event.summaries,
    });
  };

  return {
    requestSummary,
    pending,
    error: failed ? summaryErrorMessage(mutation.error) : undefined,
    errorSummariesRef: failed ? mutation.variables?.seenSummariesRef : undefined,
    localRecord,
  };
}
