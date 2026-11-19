import { CONTROL_ROOM_CHANNEL } from '@/features/events/constants';
import { isActive } from '@/features/events/entries';
import {
  eventsPageSchema,
  type EscalationDecision,
  type EventItem,
  type EventsPage,
} from '@/features/events/types';
import type { Http } from '@/lib/http';
import { z } from 'zod';

/** 쪽마다 받는 이벤트 수(명세 12.6 최대 100). */
export const EVENTS_PAGE_SIZE = 100;

/** 최대로 받는 쪽 수. 오래된 해소 이벤트가 아주 많아도 로그인마다 요청이 끝없이 늘지 않게 한다. */
export const EVENTS_MAX_PAGES = 5;

/** 다음 쪽이 더 있는지. totalElements 가 없으면 쪽이 꽉 찼는지로 본다. */
function hasNextPage(result: EventsPage, page: number): boolean {
  if (result.content.length === 0) return false;
  const size = result.size ?? EVENTS_PAGE_SIZE;
  if (result.totalElements === undefined) return result.content.length >= size;
  return ((result.number ?? page) + 1) * size < result.totalElements;
}

/**
 * 관제 화면이 처음(재연결 때도) 받는 이벤트 목록. 이후는 /topic/events 로 갱신한다.
 * 서버는 해소 전 이벤트를 먼저, 그 안에서 최신순으로 준다(S15P31A101-621). 그래서 진행 중 이벤트가 하나도 없는 쪽을 만나면 뒤에는
 * 해소된 것뿐이라 멈춘다. 쪽이 끝나거나 EVENTS_MAX_PAGES 에 닿아도 멈춘다.
 * 다음 쪽은 앞 쪽의 내용을 보고 정하므로 차례로 받는다.
 */
export async function requestEvents(
  http: Http,
  signal?: AbortSignal,
): Promise<{ content: EventItem[] }> {
  const content: EventItem[] = [];
  for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
    const result = await http(`/api/events?page=${page}&size=${EVENTS_PAGE_SIZE}`, {
      schema: eventsPageSchema,
      signal,
    });
    content.push(...result.content);
    if (!hasNextPage(result, page) || !result.content.some(isActive)) break;
  }
  return { content };
}

/**
 * 운영자 확인(ACK). 본문의 event_sequence 는 확인 버튼을 누를 때 화면이 보던 상태다(계약 event_ack, EC2 가 Tier 0 로 넘김).
 * channel 은 관제 화면이라 CONTROL_ROOM 이다. 서버는 갱신된 이벤트 전체(새 acks 포함)를 돌려주고,
 * 실패는 ProblemDetail 의 code(EVENT_NOT_FOUND·EVENT_RESOLVED·INVALID_EVENT_SEQUENCE·INVALID_ACK_CHANNEL)로 알린다.
 * 응답을 읽는 쪽이 이벤트 형식인지 따로 본다. 확인은 서버에 반영됐는데 응답 형식 탓에 실패로 보이지 않게 z.unknown 으로 받는다.
 */
export function requestAck(http: Http, eventId: string, eventSequence: number | undefined) {
  return http(`/api/events/${encodeURIComponent(eventId)}/ack`, {
    method: 'POST',
    body: {
      ...(eventSequence === undefined ? {} : { event_sequence: eventSequence }),
      channel: CONTROL_ROOM_CHANNEL,
    },
    schema: z.unknown(),
  });
}

export interface EscalationRequestBody {
  assessmentId: string | number;
  decision: EscalationDecision;
  note?: string;
}

/**
 * VLM 상향 의견 승인·거절(명세 5.4, 12.6 POST /api/events/{id}/escalation).
 * 본문은 assessmentId 와 decision(APPROVED·REJECTED)을 싣는다.
 * 등급 정본은 Tier 0 전이라, 이 응답만으로 화면 이벤트 등급을 바꾸지 않고 STOMP /topic/events 전이를 기다린다.
 */
export function requestEscalation(http: Http, eventId: string, body: EscalationRequestBody) {
  return http(`/api/events/${encodeURIComponent(eventId)}/escalation`, {
    method: 'POST',
    body: {
      assessmentId: body.assessmentId,
      decision: body.decision,
      ...(body.note ? { note: body.note } : {}),
    },
    schema: z.unknown(),
  });
}

/**
 * 사고 구간 요약 요청(명세 5.4, 12.6 POST /api/events/{id}/summary).
 * 본문 없이 보내고, 응답(202 QUEUED 또는 이미 진행 중이면 200)은 summary_id·job_id·status 를 싣는다.
 * 완료·실패 결과와 summaries 배열 갱신은 STOMP /topic/events 전이로 받는다.
 */
export function requestSummary(http: Http, eventId: string) {
  return http(`/api/events/${encodeURIComponent(eventId)}/summary`, {
    method: 'POST',
    schema: z.unknown(),
  });
}
