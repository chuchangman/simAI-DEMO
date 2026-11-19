import { requestEscalation } from '@/features/events/api';
import {
  escalationErrorMessage,
  isProposalDecided,
  isStaleEscalationError,
  normalizeEscalationResponse,
  resolveAssessmentId,
} from '@/features/events/escalation';
import { LIVE_EVENTS_KEY } from '@/features/events/eventsCache';
import { ec2Now } from '@/features/events/format';
import type { EscalationDecision, EventEscalation, EventItem } from '@/features/events/types';
import { api } from '@/lib/api';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

/** 상향 의견 처리 응답 이력의 Query 키(event_id → EventEscalation[]). */
export const ESCALATION_HISTORY_KEY = ['events', 'escalations'] as const;

const ESCALATION_MUTATION_KEY = ['events', 'escalate'] as const;

export type EscalationHistoryByEvent = Readonly<Record<string, readonly EventEscalation[]>>;

const NONE: EscalationHistoryByEvent = Object.freeze({});
const OPTIONS = { staleTime: Infinity, gcTime: Infinity } as const;

/** 같은 QueryClient 안에서 같은 이벤트로 나가는 중복 요청을 동기 시점부터 막는다. */
const inFlightByClient = new WeakMap<QueryClient, Set<string>>();

function getInFlight(queryClient: QueryClient): Set<string> {
  let set = inFlightByClient.get(queryClient);
  if (!set) {
    set = new Set<string>();
    inFlightByClient.set(queryClient, set);
  }
  return set;
}

export interface EscalateInput {
  event: EventItem;
  decision: EscalationDecision;
  assessmentId?: string | number;
  note?: string;
}

/** 응답으로 받은 상향 처리 결과 한 건을 이벤트별 이력 캐시에 기록한다(이벤트 자체의 severity 는 바꾸지 않는다). */
export function recordEscalationHistory(
  queryClient: QueryClient,
  eventId: string,
  entry: EventEscalation,
) {
  const old = queryClient.getQueryData<EscalationHistoryByEvent>(ESCALATION_HISTORY_KEY) ?? NONE;
  const prev = old[eventId] ?? [];
  const nextKey = entry.escalation_id ?? entry.assessment_job_id;
  const filtered = nextKey
    ? prev.filter((item) => (item.escalation_id ?? item.assessment_job_id) !== nextKey)
    : prev;
  queryClient.setQueryData<EscalationHistoryByEvent>(ESCALATION_HISTORY_KEY, {
    ...old,
    [eventId]: [...filtered, entry],
  });
}

/** 이벤트별 상향 의견 처리 이력(POST 응답 기록). */
export function useEscalationHistory(): EscalationHistoryByEvent {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ESCALATION_HISTORY_KEY,
    queryFn: () =>
      queryClient.getQueryData<EscalationHistoryByEvent>(ESCALATION_HISTORY_KEY) ?? NONE,
    ...OPTIONS,
    retry: false,
    refetchOnMount: false,
  });
  return data ?? NONE;
}

/**
 * 이벤트 하나의 VLM 상향 의견 승인·거절(POST /api/events/{id}/escalation).
 * - 요청 중에는 pending 으로 버튼을 잠그고, 같은 이벤트에 대한 중복 요청을 막는다.
 * - 승인 응답만 보고 화면의 이벤트 등급(event.severity)을 올리지 않는다(AGENTS 규칙 4, CONVENTION).
 *   등급은 서버가 STOMP(/topic/events)나 목록으로 보내는 이벤트 값만 따른다.
 */
export function useEscalateEvent(eventId: string) {
  const queryClient = useQueryClient();
  const history = useEscalationHistory();
  const localItems = history[eventId] ?? [];

  const mutation = useMutation({
    mutationKey: ESCALATION_MUTATION_KEY,
    mutationFn: async (input: EscalateInput) => {
      const targetId = input.event.event_id;
      const assessmentId = input.assessmentId ?? resolveAssessmentId(input.event);
      const inFlight = getInFlight(queryClient);
      inFlight.add(targetId);
      try {
        return await requestEscalation(api, targetId, {
          assessmentId,
          decision: input.decision,
          ...(input.note ? { note: input.note } : {}),
        });
      } finally {
        inFlight.delete(targetId);
      }
    },
    onSuccess: (data, variables) => {
      const targetId = variables.event.event_id;
      const assessmentId = variables.assessmentId ?? resolveAssessmentId(variables.event);
      const actorId = useSessionStore.getState().session?.user.id;
      const now = ec2Now(Date.now(), useRealtimeStore.getState().health?.clockOffsetMs);
      const entry = normalizeEscalationResponse(data, {
        event: variables.event,
        assessmentId,
        decision: variables.decision,
        actorId,
        note: variables.note,
        now,
      });
      recordEscalationHistory(queryClient, targetId, entry);
    },
    onError: (error) => {
      if (isStaleEscalationError(error)) {
        void queryClient.invalidateQueries({ queryKey: LIVE_EVENTS_KEY });
      }
    },
  });

  const sending = useMutationState({
    filters: {
      mutationKey: ESCALATION_MUTATION_KEY,
      status: 'pending',
      predicate: (m) =>
        (m.state.variables as EscalateInput | undefined)?.event.event_id === eventId,
    },
  });

  const pending = sending.length > 0;
  const failed = mutation.isError && mutation.variables?.event.event_id === eventId;

  const escalate = (
    event: EventItem,
    decision: EscalationDecision,
    options?: { assessmentId?: string | number; note?: string },
  ) => {
    const targetId = event.event_id;
    const inFlight = getInFlight(queryClient);
    if (inFlight.has(targetId) || pending) return;
    const currentHistory =
      queryClient.getQueryData<EscalationHistoryByEvent>(ESCALATION_HISTORY_KEY)?.[targetId] ?? [];
    if (isProposalDecided(event, currentHistory)) return;
    inFlight.add(targetId);
    mutation.mutate({
      event,
      decision,
      assessmentId: options?.assessmentId,
      note: options?.note,
    });
  };

  return {
    escalate,
    pending,
    error: failed ? escalationErrorMessage(mutation.error) : undefined,
    localItems,
  };
}
