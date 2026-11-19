import {
  staticObjectItemSchema,
  staticObjectsResponseSchema,
  type StaticObjectBody,
} from '@/features/surfaces/types';
import type { Http } from '@/lib/http';
import { z } from 'zod';

// 작업면·정적 객체 목록 조회 키. 3D 틀, 구역·작업면 편집, 저장이 함께 쓴다.
export const STATIC_OBJECTS_KEY = ['static-objects'] as const;

// http 를 인자로 받는다. 테스트가 env 없이 createHttp 로 부를 수 있게 한다.
export function requestStaticObjects(http: Http, signal?: AbortSignal) {
  return http('/api/static-objects', { schema: staticObjectsResponseSchema, signal });
}

/** 새 작업면(v1). ID(ws-<8 hex>)는 서버가 정한다. */
export function createStaticObject(http: Http, body: StaticObjectBody) {
  return http('/api/static-objects', { method: 'POST', body, schema: staticObjectItemSchema });
}

/**
 * 새 버전(명세 11.1, 덮어쓰지 않는다). 서버는 지금 버전을 닫고 다음 버전을 더한다. 고치기 시작한 버전은 받지 않아
 * 같은 순간 부딪친 저장만 409(CONCURRENT_EDIT)다.
 */
export function updateStaticObject(http: Http, objectId: string, body: StaticObjectBody) {
  return http(`/api/static-objects/${encodeURIComponent(objectId)}`, {
    method: 'PUT',
    body,
    schema: staticObjectItemSchema,
  });
}

/**
 * 작업면·정적 객체 보관(삭제, 관리자). 서버는 행을 지우지 않고 지금 버전의 valid_to 만 닫는다(204, 본문 없음). 목록과 다음
 * 묶음에서 빠지고 이미 발행한 묶음은 다음 발행 전까지 현장에서 그대로 쓰인다. 이미 보관한 객체는 다시 눌러도 204, 없는 ID 는 404 다.
 */
export async function deleteStaticObject(http: Http, objectId: string): Promise<void> {
  await http(`/api/static-objects/${encodeURIComponent(objectId)}`, {
    method: 'DELETE',
    schema: z.void(),
  });
}
