import { CONTROL_ROOM_CHANNEL } from '@/features/events/constants';
import { upsertEvents, type EventEntry } from '@/features/events/entries';
import { ec2Now } from '@/features/events/format';
import { eventItemSchema, type EventAck, type EventItem } from '@/features/events/types';
import { ApiError } from '@/lib/http';
import type { Realtime } from '@/lib/stomp';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import type { QueryClient } from '@tanstack/react-query';

/** 관제 화면 LIVE 이벤트 목록의 Query 키. 데이터는 LiveEvents. */
export const LIVE_EVENTS_KEY = ['events', 'live'] as const;

/** 끊긴 화면에서 누른 확인의 서버 전송을 기다리는 것. 연결이 다시 열리면 보낸다. */
export interface PendingAck {
  eventId: string;
  /** 확인 버튼을 누를 때 화면이 보던 상태. */
  eventSequence: number | undefined;
  /** 화면에 먼저 써 둔 임시 확인(isLocalAck)의 ack_id. */
  ackId: string;
  /** 누른 사용자. 다른 계정으로 바뀐 뒤에는 그 계정의 토큰으로 보내지 않는다. */
  actorId: string;
}

export interface LiveEvents {
  entries: EventEntry[];
  /**
   * REST 목록(GET /api/events)을 받아 합쳤는지. STOMP 로 먼저 받은 것만 있거나 재연결한 뒤에는 false 다.
   * 데이터가 있다고 목록을 받은 것은 아니라서 따로 둔다. false 면 useLiveEvents 가 받을 때까지 다시 시도한다.
   */
  loaded: boolean;
  /** 서버에 아직 못 보낸 확인. 이벤트 캐시와 같이 사용자가 끝나면 지워지므로 다른 사용자의 것이 남지 않는다. */
  pendingAcks?: readonly PendingAck[];
}

/** 확인 요청 하나를 서버에 보낸다. 앱은 requestAck(api, …)를 넘긴다. 이 파일이 REST 인스턴스(env)를 읽지 않게 주입한다. */
export type SendAck = (eventId: string, eventSequence: number | undefined) => Promise<unknown>;

/** 서버에 보내기 전에 화면에만 써 둔 확인의 ack_id 접두사. 서버가 준 ack_id 와 섞이지 않는다. */
const LOCAL_ACK_PREFIX = 'local-';

export const isLocalAck = (ack: EventAck) => ack.ack_id.startsWith(LOCAL_ACK_PREFIX);

/** 이벤트들을 캐시에 반영한다. 아직 목록을 받기 전이어도 받은 것부터 쌓는다(목록이 오면 순서대로 합친다). */
export function applyEvents(queryClient: QueryClient, items: readonly EventItem[]) {
  queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, (old) => {
    const entries = upsertEvents(old?.entries ?? [], items);
    return old && entries === old.entries ? old : { ...old, entries, loaded: old?.loaded ?? false };
  });
}

/** 지금 EC2 시계(ms)의 추정값. 끊긴 화면이라 마지막 health 로 잰 시계 차이를 쓴다. */
const estimateEc2Now = () => ec2Now(Date.now(), useRealtimeStore.getState().health?.clockOffsetMs);

/** 이벤트에 확인 한 건을 덧붙인다. */
const withAck = (entry: EventEntry, ack: EventAck): EventEntry => ({
  ...entry,
  event: { ...entry.event, acks: [...(entry.event.acks ?? []), ack] },
});

/**
 * 끊긴 화면(EC2 와 이어지지 않아 REST 도 실패)에서 누른 확인을 화면 상태에 먼저 쓴다. 배너와 경보음이 바로 멈춘다.
 * 서버에는 아직 없으므로 PendingAck 로 남겨 두고, 연결이 다시 열리면 bindEventsCache 가 보낸 뒤 서버 상태로 바꾼다.
 * 로그인한 반장·관리자가 없거나 캐시에 그 이벤트가 없으면 쓰지 않고 false 를 돌려준다.
 */
export function writeLocalAck(
  queryClient: QueryClient,
  eventId: string,
  eventSequence: number | undefined,
): boolean {
  const user = useSessionStore.getState().session?.user;
  const target = queryClient
    .getQueryData<LiveEvents>(LIVE_EVENTS_KEY)
    ?.entries.find((e) => e.event.event_id === eventId);
  if (!user || user.role === 'VIEWER' || !target) return false;
  const at = estimateEc2Now();
  const ack: EventAck = {
    ack_id: `${LOCAL_ACK_PREFIX}${eventId}-${at}`,
    channel: CONTROL_ROOM_CHANNEL,
    actor_role: user.role,
    actor_id: user.id,
    // 시계가 어긋나도 지금 보이는 경보 단계 뒤의 확인으로 센다(그래야 화면의 경보가 멈춘다).
    acked_at: Math.max(at, target.stageStartedAt ?? 0),
  };
  queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, (old) => {
    if (!old) return old;
    const others = (old.pendingAcks ?? []).filter((p) => p.eventId !== eventId);
    return {
      ...old,
      entries: old.entries.map((e) => (e.event.event_id === eventId ? withAck(e, ack) : e)),
      pendingAcks: [...others, { eventId, eventSequence, ackId: ack.ack_id, actorId: user.id }],
    };
  });
  return true;
}

function withoutLocalAcks(entry: EventEntry): EventEntry {
  const acks = entry.event.acks;
  if (!acks?.some(isLocalAck)) return entry;
  return { ...entry, event: { ...entry.event, acks: acks.filter((a) => !isLocalAck(a)) } };
}

/**
 * 다시 보낸 확인이 끝났다(성공이거나 서버가 거절). 임시 확인과 보낼 것 목록을 지우고, 서버가 돌려준 이벤트가 있으면
 * 그 자리에 반영한다. 임시 확인은 합치기가 지우지 않는 확인이라 서버의 진짜 확인이 들어오기 전에 같이 바꾼다.
 */
function settleLocalAck(queryClient: QueryClient, ackId: string, server?: EventItem) {
  queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, (old) => {
    const pending = old?.pendingAcks?.find((p) => p.ackId === ackId);
    if (!old || !pending) return old;
    const cleared = old.entries.map((e) =>
      e.event.event_id === pending.eventId ? withoutLocalAcks(e) : e,
    );
    return {
      ...old,
      entries: server ? upsertEvents(cleared, [server]) : cleared,
      pendingAcks: old.pendingAcks?.filter((p) => p.ackId !== ackId),
    };
  });
}

const isClientError = (error: unknown) =>
  error instanceof ApiError && error.kind === 'HTTP' && error.status >= 400 && error.status < 500;

/** 확인 하나를 서버에 보내고 정리한다. 서버 상태를 다시 받아야 하면 true. */
async function resendOne(
  queryClient: QueryClient,
  sendAck: SendAck,
  sending: Set<string>,
  pending: PendingAck,
): Promise<boolean> {
  // 이전 사용자가 누른 것은 지금 토큰으로 보내지 않는다.
  if (pending.actorId !== useSessionStore.getState().session?.user.id) {
    settleLocalAck(queryClient, pending.ackId);
    return false;
  }
  sending.add(pending.ackId);
  try {
    const event = eventItemSchema.safeParse(await sendAck(pending.eventId, pending.eventSequence));
    settleLocalAck(queryClient, pending.ackId, event.success ? event.data : undefined);
    return !event.success;
  } catch (error) {
    if (!isClientError(error)) return false;
    settleLocalAck(queryClient, pending.ackId);
    return true;
  } finally {
    sending.delete(pending.ackId);
  }
}

/**
 * 남아 있는 확인을 서버에 보낸다. 서버가 받으면(응답의 이벤트를 반영) 거절하면(4xx: 이미 해소됨·상태가 바뀜 등) 목록에서 뺀다.
 * 연결 실패·5xx 는 다음에 연결이 열릴 때 다시 보낸다. 서버 상태를 다시 받아야 하면 true 를 돌려준다.
 */
async function resendPendingAcks(
  queryClient: QueryClient,
  sendAck: SendAck,
  sending: Set<string>,
): Promise<boolean> {
  const pending = queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.pendingAcks ?? [];
  const refetches = await Promise.all(
    pending
      .filter((p) => !sending.has(p.ackId))
      .map((p) => resendOne(queryClient, sendAck, sending, p)),
  );
  return refetches.some(Boolean);
}

/**
 * 실시간 연결을 이벤트 캐시에 잇는다(CONVENTION: 화면이 따로 쓰는 메시지는 Query 캐시를 갱신한다).
 * - /topic/events → 캐시에 합친다(event_sequence 순서).
 * - 연결이 열릴 때마다 목록을 다시 받는다. 서버에는 STOMP 다시 받기(재생 위치)가 없어 끊긴 동안에 놓친 전이는 목록으로만 채운다.
 *   목록을 받는 사이 STOMP 로 온 이벤트는 받은 뒤 합치므로 지워지지 않는다(useLiveEvents).
 * - sendAck 을 주면, 끊긴 화면에서 누른 확인(writeLocalAck)을 연결이 열릴 때 서버로 보낸다. 주지 않으면 보내지 않고 남겨 둔다.
 * - viewer_health.held_events_revision 이 바뀌면 목록을 다시 받는다(S15P31A101-595). Tier 0 가 들고 있는 이벤트 집합이 전이 없이
 *   한꺼번에 바뀐 것이라(재동기화 스냅샷·Tier 0 꺼짐) 이벤트마다 오는 메시지가 없다. 처음 받은 판은 기준으로만 삼는다.
 * 해제 함수를 돌려준다.
 */
export function bindEventsCache(
  realtime: Pick<Realtime, 'on'>,
  queryClient: QueryClient,
  sendAck?: SendAck,
) {
  const sending = new Set<string>();
  const reload = () => void queryClient.invalidateQueries({ queryKey: LIVE_EVENTS_KEY });
  const offEvent = realtime.on('riskEvent', (event) => applyEvents(queryClient, [event]));
  let heldRevision = useRealtimeStore.getState().health?.payload.held_events_revision;
  const offHealth = useRealtimeStore.subscribe((state) => {
    const revision = state.health?.payload.held_events_revision;
    if (revision === undefined || revision === heldRevision) return;
    const known = heldRevision !== undefined;
    heldRevision = revision;
    if (known) reload();
  });
  const offOpen = realtime.on('open', () => {
    // 다시 받을 때까지는 끊긴 동안 놓친 것이 있을 수 있다. 실패하면 받을 때까지 다시 시도한다.
    queryClient.setQueryData<LiveEvents>(
      LIVE_EVENTS_KEY,
      (old) => old && { ...old, loaded: false },
    );
    reload();
    // 확인은 목록과 따로 보낸다. 서버가 늦어도 목록이 기다리지 않는다. 거절당해 상태가 달라졌으면 목록을 한 번 더 받는다.
    if (sendAck) {
      void resendPendingAcks(queryClient, sendAck, sending).then((stale) => stale && reload());
    }
  });
  return () => {
    offEvent();
    offOpen();
    offHealth();
  };
}
