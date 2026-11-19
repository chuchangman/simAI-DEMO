import type { Http } from '@/lib/http';
import { z } from 'zod';

// CCTV 원격 시청 REST(관리자만, 서버 domain/cctv, S15P31A101-400). http 를 인자로 받아 env 없이 시험한다.

const ticketSchema = z.object({
  ticket: z.string().min(1),
  expires_at_ms: z.number().int(),
  path: z.string().startsWith('/'),
});

/**
 * 시청 WebSocket 주소. 서버가 준 경로(/ws/cctv/view)를 STOMP 주소(같은 EC2, ws·wss)의 출처에 붙이고 입장권을 싣는다.
 * 입장권은 60초 안에 한 번만 쓰므로 연결마다 새로 받는다.
 */
export function remoteViewUrl(stompUrl: string, path: string, ticket: string): string {
  const url = new URL(path, stompUrl);
  url.search = new URLSearchParams({ ticket }).toString();
  url.hash = '';
  return url.toString();
}

export async function requestRemoteViewUrl(http: Http, stompUrl: string): Promise<string> {
  const issued = await http('/api/cctv/remote/tickets', { method: 'POST', schema: ticketSchema });
  return remoteViewUrl(stompUrl, issued.path, issued.ticket);
}
