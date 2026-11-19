import type { StaticObjectItem } from '@/features/surfaces/types';
import { DEMO_FLOW } from '@/mocks/demoFlow';
import {
  createStaticObjectStore,
  readStaticObjectFields,
  WORK_SURFACE_KIND,
  type StaticObjectStore,
} from '@/mocks/staticObjectStore';
import {
  AUTH_ERRORS,
  created,
  createDeny,
  errorsOf,
  LAYOUT_LOCK_ERRORS,
  noContent,
  SEEDED_VALID_FROM,
} from '@/mocks/zones';
import { http, HttpResponse } from 'msw/http';

// 서버 작업면·정적 객체 API(BE -120 geometry 도메인) 대신 쓰는 mock. 서버 검사 규칙(StaticObjectRepository.check)을 따른다.
// 단상은 이벤트 시나리오의 z-02(단상 구역)와 같은 자리, 책상은 3D 뷰어 하네스의 데모 책상 자리다.
// 오류 응답·인증 검사는 구역 mock(mocks/zones)과 함께 쓰고, 상태와 값 검사는 staticObjectStore 에 있다.

const ERRORS = {
  ...AUTH_ERRORS,
  ...LAYOUT_LOCK_ERRORS,
  INVALID_STATIC_OBJECT: { status: 400, detail: '작업면·정적 객체 값이 올바르지 않습니다' },
  INVALID_SURFACE_ZONE: { status: 400, detail: '작업면만 구역에 이을 수 있습니다' },
  STATIC_OBJECT_NOT_FOUND: { status: 404, detail: '작업면·정적 객체를 찾을 수 없습니다' },
};
const fail = errorsOf(ERRORS);

export const MOCK_STATIC_OBJECTS = [
  {
    object_id: 'ws-0a0c0001',
    object_version: 1,
    kind: 'WORK_SURFACE',
    name: '단상 작업면',
    obb: { center: [2.5, 7.3, 0.2], size: [3, 2.2, 0.4], yaw_rad: 0 },
    top_height_m: Math.fround(0.4),
    zone_id: 'z-02',
    valid_from: SEEDED_VALID_FROM,
    valid_to: null,
  },
  {
    object_id: 'ws-0a0c0002',
    object_version: 1,
    kind: 'WORK_SURFACE',
    name: '책상',
    obb: { center: [5, 4.6, 0.37], size: [1.2, 0.6, 0.74], yaw_rad: -0.2618 },
    top_height_m: Math.fround(0.74),
    zone_id: null,
    valid_from: SEEDED_VALID_FROM,
    valid_to: null,
  },
] satisfies StaticObjectItem[];

/**
 * 요청 본문(JSON 값)의 zone_id. 없으면 undefined(이전 연결을 그대로 둔다), 빈 글자면 null(푼다), 값이 있으면 그 구역에 잇는다.
 * 구역이 지금 있는지·그 구역에 다른 작업면이 있는지는 보지 않는다(구역 한 번 저장 mock 이 그 검사를 한다).
 */
function zoneIdOf(value: unknown): string | null | undefined {
  const zoneId = typeof value === 'object' && value !== null ? Reflect.get(value, 'zone_id') : null;
  if (typeof zoneId !== 'string') return undefined;
  return zoneId.trim() || null;
}

export interface StaticObjectsMock {
  handlers: ReturnType<typeof http.get>[];
  /** 지금 버전(보관하지 않은 작업면·정적 객체). */
  current(): StaticObjectItem[];
  /** 구역 mock 의 한 번 저장(POST /api/zones/commit)이 구역과 함께 바꾸는 저장소. */
  store: StaticObjectStore;
}

/**
 * 작업면·정적 객체 조회·만들기·새 버전·보관(삭제). 로그인하지 않았거나 실서버 토큰이 만료면 401, 쓰기는 관리자만(아니면 403)이다.
 * 작업 레이아웃 항목으로 만든 작업면(layout_item_id 가 있다)을 고치거나 보관하면 409 LAYOUT_ZONE_LOCKED 다(구역 mock 의 layoutZones 가 만든다).
 * 새 버전은 지금 버전을 닫고 다음 버전을 더한다(서버처럼 고치기 시작한 버전은 보지 않는다). 새 버전 본문에 zone_id 가 없으면
 * 이전 연결을 그대로 두고 빈 글자면 푼다. 보관은 지금 버전의 valid_to 만 닫는다(이력은 남고, 다시 보관해도 204, 보관한 객체를
 * 고치면 404). 상태는 이 mock 이 살아 있는 동안만 둔다.
 */
export function createStaticObjectsMock({
  now = Date.now,
}: { now?: () => number } = {}): StaticObjectsMock {
  // simAI-DEMO: 시연 흐름은 처음 작업면을 비운다(mocks/demoFlow.ts)
  const store = createStaticObjectStore(DEMO_FLOW ? [] : MOCK_STATIC_OBJECTS);
  const deny = createDeny(now);
  /** 작업 레이아웃 항목으로 만든 작업면인가(보관한 것 포함). 그런 작업면은 작업 레이아웃으로만 바꾼다. */
  const isLayoutSurface = (objectId: string) =>
    store.versionsOf(objectId).some((o) => o.layout_item_id != null);
  /** 작업면이 아닌 객체를 구역에 이을 수 없다(서버 StaticObjectRepository.link). */
  const linksNonSurface = (kind: string, zoneId: string | null | undefined) =>
    kind !== WORK_SURFACE_KIND && typeof zoneId === 'string';

  const handlers = [
    http.get(
      '*/api/static-objects',
      ({ request }) => deny(request, false) ?? HttpResponse.json(store.current()),
    ),
    http.get('*/api/static-objects/:objectId/versions', ({ request, params }) => {
      const denied = deny(request, false);
      if (denied) return denied;
      const list = store.versionsOf(String(params.objectId));
      return list.length > 0 ? HttpResponse.json(list) : fail('STATIC_OBJECT_NOT_FOUND');
    }),
    http.post('*/api/static-objects', async ({ request }) => {
      const denied = deny(request, true);
      if (denied) return denied;
      const raw: unknown = await request.json().catch(() => undefined);
      const fields = readStaticObjectFields(raw);
      if (!fields) return fail('INVALID_STATIC_OBJECT');
      const zoneId = zoneIdOf(raw) ?? null;
      if (linksNonSurface(fields.kind, zoneId)) return fail('INVALID_SURFACE_ZONE');
      return created(store.create(fields, zoneId, now()));
    }),
    http.put('*/api/static-objects/:objectId', async ({ request, params }) => {
      const denied = deny(request, true);
      if (denied) return denied;
      if (isLayoutSurface(String(params.objectId))) return fail('LAYOUT_ZONE_LOCKED');
      const raw: unknown = await request.json().catch(() => undefined);
      const fields = readStaticObjectFields(raw);
      if (!fields) return fail('INVALID_STATIC_OBJECT');
      const zoneId = zoneIdOf(raw);
      if (linksNonSurface(fields.kind, zoneId)) return fail('INVALID_SURFACE_ZONE');
      // 보관한 객체는 지금 버전이 없어 없는 객체와 같이 404 다(서버도 보관한 ID 는 고칠 수 없다).
      const item = store.update(String(params.objectId), fields, zoneId, now());
      return item ? HttpResponse.json(item) : fail('STATIC_OBJECT_NOT_FOUND');
    }),
    http.delete('*/api/static-objects/:objectId', ({ request, params }) => {
      const denied = deny(request, true);
      if (denied) return denied;
      if (isLayoutSurface(String(params.objectId))) return fail('LAYOUT_ZONE_LOCKED');
      return store.archive(String(params.objectId), now())
        ? noContent()
        : fail('STATIC_OBJECT_NOT_FOUND');
    }),
  ];

  return { handlers, current: store.current, store };
}
