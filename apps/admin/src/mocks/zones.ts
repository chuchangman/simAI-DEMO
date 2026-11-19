import { bodyOf as surfaceBodyOf } from '@/features/surfaces/surfaces';
import type { StaticObjectItem } from '@/features/surfaces/types';
import { itemMakesZone, layoutZonePlans, type LayoutZonePlan } from '@/features/tbm/layoutZones';
import type { LayoutObbItem } from '@/features/tbm/types';
import {
  zoneBodySchema,
  type BundleItem,
  type BundleStatus,
  type ZoneBody,
  type ZoneItem,
} from '@/features/zones/types';
import { DEMO_FLOW } from '@/mocks/demoFlow';
import { hexId } from '@/mocks/hexId';
import { readLiveUser } from '@/mocks/problem';
import type { MockConfig } from '@/mocks/realtimeScenario';
import {
  createStaticObjectStore,
  layoutOriginOf,
  readStaticObjectFields,
  WORK_SURFACE_KIND,
  type LayoutOrigin,
  type StaticObjectFields,
  type StaticObjectStore,
} from '@/mocks/staticObjectStore';
import { http, HttpResponse } from 'msw/http';
import { z } from 'zod';

// 서버 구역·구성 묶음 API(BE -120) 대신 쓰는 mock. 서버 형식과 검사 규칙(docs/design/server-config-bundle.md)을 따른다.
// 이벤트 시나리오(realtimeScenario)의 z-04·z-02 와 맞춘다. 위치는 디자인 데모의 기본 구역을 따른다.
// 작업면 mock(mocks/staticObjects)도 이 파일의 오류 응답·인증 검사를 함께 쓴다. 구역 한 번 저장(POST /api/zones/commit)은
// 구역과 작업면(mocks/staticObjectStore)을 함께 바꾼다.
// 작업을 시작하면 작업 레이아웃 항목으로 구역·작업면을 만드는 서버 일(S15P31A101-553)은 layoutZones 로 흉내 낸다(작업 mock 인
// mocks/tbm 이 시작·진행 중 저장·종료 때 부른다). 그렇게 만든 것은 layout_item_id 가 있고, 구역 API 로 바꾸면 409 LAYOUT_ZONE_LOCKED 다.

/** 처음 구성 묶음(cfg-12)을 발행한 시각(ms). 처음 구역·작업면들은 그 전에 저장했다. */
export const SEEDED_AT = 1_760_342_400_000;
/** 처음 구역·작업면을 저장한 시각(처음 묶음 발행 1분 전). */
export const SEEDED_VALID_FROM = SEEDED_AT - 60_000;
/** 처음 적용된 묶음의 번호(cfg-12). 발행마다 하나씩 늘린다. */
const SEEDED_CONFIG_NUMBER = 12;
const CONFIG_VERSION_PREFIX = 'cfg-';
/** 목록 조회가 주는 최근 묶음 수. */
const BUNDLE_LIST_LIMIT = 20;
/** 묶음이 가리키는 보정 문서 버전·거부 사유(고정 흉내). */
const CALIBRATION_VERSION = 'cal-7';
const REJECT_REASON = 'VALIDATION_FAILED';
/** 발행 요청이 고를 수 있는 규칙 프로필. 안 고르면 현장 기본인 교실 시험이다(S15P31A101-669). */
const RULE_PROFILES = ['OPERATION', 'CLASSROOM_TEST'] as const;
const DEFAULT_RULE_PROFILE = 'CLASSROOM_TEST' satisfies (typeof RULE_PROFILES)[number];
/** Tier 0 가 새 구성 묶음을 받아 ACK 하기까지 걸리는 시간(ms) 흉내. */
const ACK_DELAY_MS = 3_000;
/** 구역 다각형 꼭짓점 수의 범위(서버 검사). */
const MIN_VERTICES = 3;
const MAX_VERTICES = 256;
/** 작업 레이아웃 항목으로 만드는 구역의 값(등급 경고, 입체 판정). 작업면이 붙은 구역도 개구부 유형이다(관제 새 구역과 같다). */
const LAYOUT_ZONE_KIND = 'OPENING';
const LAYOUT_ZONE_SEVERITY = 'HIGH';
const LAYOUT_ZONE_JUDGE_TYPE = 'VOLUME_3D';

interface ErrorSpec {
  status: number;
  detail: string;
}

/** 로그인·권한 오류. 작업면 mock 도 같은 표를 쓴다. */
export const AUTH_ERRORS = {
  UNAUTHORIZED: { status: 401, detail: '로그인이 필요합니다' },
  FORBIDDEN: { status: 403, detail: '권한이 없습니다' },
};

/** 작업 레이아웃으로 만든 구역·작업면을 구역·작업면 API 로 바꾸려 할 때의 오류. 작업면 mock 도 같은 표를 쓴다. */
export const LAYOUT_LOCK_ERRORS = {
  LAYOUT_ZONE_LOCKED: {
    status: 409,
    detail: '작업 레이아웃으로 만든 구역·작업면은 레이아웃으로만 바꿀 수 있습니다',
  },
};

/** 구성 묶음 발행이 실패하는 이유(서버 ConfigBundleService 의 오류 코드). */
export const PUBLISH_FAILURES = {
  CALIBRATION_MISSING: { status: 409, detail: '보정 문서가 없습니다' },
  CURRENT_CALIBRATION_MISSING: { status: 409, detail: '유효한 보정 문서가 없습니다' },
  RULES_MISSING: { status: 409, detail: '유효한 규칙 버전이 없습니다' },
  SITE_NOT_SINGLE: { status: 409, detail: '현장이 하나로 정해지지 않았습니다' },
  PUBLIC_URL_NOT_SET: { status: 503, detail: '서버 공개 주소가 설정되지 않았습니다' },
} as const;
export type PublishFailureCode = keyof typeof PUBLISH_FAILURES;

const ERRORS = {
  ...LAYOUT_LOCK_ERRORS,
  INVALID_ZONE: { status: 400, detail: '구역 값이 올바르지 않습니다' },
  INVALID_Z_RANGE: { status: 400, detail: '높이 범위가 올바르지 않습니다' },
  INVALID_POLYGON: { status: 400, detail: '다각형이 올바르지 않습니다' },
  INVALID_RULE_PROFILE: { status: 400, detail: 'rule_profile 이 올바르지 않습니다' },
  INVALID_ZONE_COMMIT: { status: 400, detail: '구역 저장 요청이 올바르지 않습니다' },
  INVALID_STATIC_OBJECT: { status: 400, detail: '작업면·정적 객체 값이 올바르지 않습니다' },
  INVALID_SURFACE_ZONE: { status: 400, detail: '작업면만 구역에 이을 수 있습니다' },
  ZONE_NOT_FOUND: { status: 404, detail: '구역을 찾을 수 없습니다' },
  STATIC_OBJECT_NOT_FOUND: { status: 404, detail: '작업면·정적 객체를 찾을 수 없습니다' },
  SURFACE_ZONE_TAKEN: { status: 409, detail: '구역에 이미 다른 작업면이 이어져 있습니다' },
  CONFIG_BUNDLE_NOT_FOUND: { status: 404, detail: '구성 묶음을 찾을 수 없습니다' },
  ...PUBLISH_FAILURES,
};

/** 오류 표(코드 → 상태·메시지)로 서버 오류 응답(status·detail·code)을 만드는 함수를 만든다. */
export function errorsOf<T extends Record<string, ErrorSpec>>(table: T) {
  return (code: keyof T & string) => {
    const { status, detail } = table[code];
    return HttpResponse.json({ status, detail, code }, { status });
  };
}

const fail = errorsOf(ERRORS);

export const created = (body: Parameters<typeof HttpResponse.json>[0]) =>
  HttpResponse.json(body, { status: 201 });
export const noContent = () => new HttpResponse(null, { status: 204 });

/** 로그인하지 않았거나 토큰이 만료면 401, 쓰기(write)인데 관리자가 아니면 403 응답을 주고 통과하면 undefined 를 주는 검사. */
export function createDeny(now: () => number) {
  const authFail = errorsOf(AUTH_ERRORS);
  return (request: Request, write: boolean) => {
    const user = readLiveUser(request, now());
    if (!user) return authFail('UNAUTHORIZED');
    if (write && user.role !== 'ADMIN') return authFail('FORBIDDEN');
    return undefined;
  };
}

export const MOCK_ZONES = [
  {
    zone_id: 'z-04',
    zone_version: 1,
    name: '개구부 구역',
    zone_kind: 'OPENING',
    eval_type: 'VOLUME_3D',
    polygon_xy: [
      [5.8, 1.2],
      [8.6, 1.2],
      [8.6, 3.8],
      [5.8, 3.8],
    ],
    z_min_m: 0,
    z_max_m: 2.4,
    severity: 'CRITICAL',
    requirements: null,
    has_guardrail: null,
    valid_from: SEEDED_VALID_FROM,
    valid_to: null,
  },
  {
    zone_id: 'z-02',
    zone_version: 1,
    name: '단상 구역',
    zone_kind: 'PLATFORM',
    eval_type: 'VOLUME_3D',
    polygon_xy: [
      [1, 6.2],
      [4, 6.2],
      [4, 8.4],
      [1, 8.4],
    ],
    z_min_m: 0,
    z_max_m: 0.4,
    severity: 'HIGH',
    requirements: null,
    has_guardrail: true,
    valid_from: SEEDED_VALID_FROM,
    valid_to: null,
  },
] satisfies ZoneItem[];

/** 묶음에 싣는 규칙 항목. 규칙 mock 은 따로 없어 발행마다 같은 규칙 버전을 싣는다. */
const RULE_ITEM = {
  item_type: 'RULE',
  item_id: 'R2',
  item_version: 1,
} satisfies BundleItem;

// 처음 묶음(cfg-12)에 실린 작업면. MOCK_STATIC_OBJECTS(mocks/staticObjects.ts)와 같다(그쪽이 이 파일을 가져와 순환하지 않게 적는다).
const SEEDED_SURFACE_ITEMS = [
  { item_type: 'STATIC_OBJECT', item_id: 'ws-0a0c0001', item_version: 1, kind: 'WORK_SURFACE' },
  { item_type: 'STATIC_OBJECT', item_id: 'ws-0a0c0002', item_version: 1, kind: 'WORK_SURFACE' },
] satisfies BundleItem[];

const zoneItem = (zone: Pick<ZoneItem, 'zone_id' | 'zone_version'>) =>
  ({
    item_type: 'ZONE',
    item_id: zone.zone_id,
    item_version: zone.zone_version,
  }) satisfies BundleItem;

const staticObjectItem = (o: StaticObjectItem): BundleItem => ({
  item_type: 'STATIC_OBJECT',
  item_id: o.object_id,
  item_version: o.object_version,
  kind: o.kind,
});

/** Tier 0 의 ACK 로 정해지는 묶음 상태(MISMATCH 는 흉내 내지 않는다). */
type AckStatus = Exclude<BundleStatus, 'MISMATCH'>;

/** 상단 바에 보이는 동기화 상태. 거부된 묶음이 최신이면 현장은 이전 묶음을 쓰고 있어 STALE 이다. */
const SYNC_BY_STATUS: Record<AckStatus, MockConfig['sync']> = {
  APPLIED: 'CURRENT',
  PENDING: 'PENDING',
  REJECTED: 'STALE',
};

/** 바닥 다각형 넓이(신발끈 공식). 닫는 점은 빼고 센다. */
function area(points: readonly (readonly [number, number])[]): number {
  let sum = 0;
  points.forEach(([x0, y0], i) => {
    const [x1, y1] = points[(i + 1) % points.length]!;
    sum += x0 * y1 - x1 * y0;
  });
  return Math.abs(sum) / 2;
}

/** 닫는 점(첫 점과 같은 끝 점)은 빼고 돌려준다. 서버는 열린 고리로 저장한다. */
function openRing(points: ZoneBody['polygon_xy']): ZoneBody['polygon_xy'] {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? points.slice(0, -1) : points;
}

const isValidRing = (ring: ZoneBody['polygon_xy']) =>
  ring.length >= MIN_VERTICES && ring.length <= MAX_VERTICES && area(ring) > 0;

/** 높이 범위: 있으면 최저 < 최고, 3D 부피 판정은 둘 다 있어야 한다. */
function isValidZRange({ z_min_m: min, z_max_m: max, eval_type }: ZoneBody): boolean {
  if (eval_type === 'VOLUME_3D' && (min === null || max === null)) return false;
  return min === null || max === null || min < max;
}

/** 서버(ZoneRepository.check)와 같은 검사. 통과하면 저장할 칸, 아니면 오류 응답. */
function checkZoneBody(value: unknown) {
  const body = zoneBodySchema.safeParse(value);
  if (!body.success || !body.data.name.trim() || !body.data.zone_kind.trim())
    return fail('INVALID_ZONE');
  if (!isValidZRange(body.data)) return fail('INVALID_Z_RANGE');
  const ring = openRing(body.data.polygon_xy);
  if (!isValidRing(ring)) return fail('INVALID_POLYGON');
  return {
    ...body.data,
    name: body.data.name.trim(),
    zone_kind: body.data.zone_kind.trim(),
    polygon_xy: ring,
  };
}

type ZoneFields = Exclude<ReturnType<typeof checkZoneBody>, Response>;

/**
 * 레이아웃 저장 때의 항목 형상 검사(서버가 저장 때 ZoneRepository.check 와 같이 미리 본다: 다각형 유효·넓이>0·높이 최저<최고).
 * 구역을 만드는 항목 중 못 넘는 첫 항목의 안내 글, 모두 넘으면 null. 이름이 비면 기본 이름을 쓰므로 이름은 보지 않는다.
 */
export function layoutShapeProblem(items: readonly LayoutObbItem[]): string | null {
  for (const item of items) {
    if (!itemMakesZone(item)) continue;
    const [plan] = layoutZonePlans([item]);
    if (!plan) return `구역 형상이 올바르지 않습니다: ${item.item_id}`;
    const { polygon_xy: ring, z_min_m: min, z_max_m: max } = plan.shape;
    if (!isValidRing(ring)) return `구역 다각형이 올바르지 않습니다: ${item.item_id}`;
    if (min === null || max === null || !(min < max))
      return `구역 높이 범위가 올바르지 않습니다: ${item.item_id}`;
  }
  return null;
}

/** 요청 본문의 rule_profile. 본문이 객체가 아니면 없는 것으로 본다. */
function profileOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null ? Reflect.get(body, 'rule_profile') : undefined;
}

/** 없거나 null 이면 기본 프로필을 쓰므로 통과다. */
const isValidProfile = (profile: unknown) =>
  profile === undefined || profile === null || RULE_PROFILES.some((p) => p === profile);

/** 한 번 저장 요청의 모양(서버 ZoneCommitRequest). 본문(body)의 값 검사는 저장할 때 구역·작업면 규칙으로 한다. */
const commitRequestSchema = z.object({
  zone: z.object({
    op: z.enum(['CREATE', 'UPDATE', 'ARCHIVE', 'KEEP']),
    zone_id: z.string().nullish(),
    body: z.unknown().optional(),
  }),
  surface: z
    .object({
      op: z.enum(['CREATE', 'UPDATE', 'REPLACE', 'ARCHIVE']),
      object_id: z.string().nullish(),
      body: z.unknown().optional(),
    })
    .nullish(),
  publish: z.boolean().nullish(),
  setup_session_id: z.string().nullish(),
});

/** 한 번 저장 요청에서 모양 검사를 통과한 구역·작업면 변경. op 별로 필요한 칸만 남는다. */
type ZonePlan =
  | { op: 'CREATE'; body: unknown }
  | { op: 'UPDATE'; id: string; body: unknown }
  | { op: 'ARCHIVE' | 'KEEP'; id: string };
type SurfacePlan =
  | { op: 'CREATE'; body: unknown }
  | { op: 'UPDATE' | 'REPLACE'; id: string; body: unknown }
  | { op: 'ARCHIVE'; id: string };
interface CommitPlan {
  zone: ZonePlan;
  surface: SurfacePlan | null;
  publish: boolean;
  /** 이 저장이 속한 세팅 세션(세팅 화면이 구역을 저장할 때만 있다). */
  setupSessionId: string | null;
}

const isPresent = (value: unknown) => value !== undefined && value !== null;
/** 앞뒤 공백을 뺀 ID. 비었으면 null. */
const idOrNull = (id: string | null | undefined) => id?.trim() || null;

type CommitRequest = z.infer<typeof commitRequestSchema>;

/** 구역 op 는 CREATE(body, ID 없음)·UPDATE(ID+body)·ARCHIVE·KEEP(ID, body 없음). 틀리면 undefined. */
function zonePlanOf({ op, zone_id, body }: CommitRequest['zone']): ZonePlan | undefined {
  const id = idOrNull(zone_id);
  switch (op) {
    case 'CREATE':
      return id === null && isPresent(body) ? { op, body } : undefined;
    case 'UPDATE':
      return id !== null && isPresent(body) ? { op, id, body } : undefined;
    default:
      return id !== null && !isPresent(body) ? { op, id } : undefined;
  }
}

/** 작업면 op 는 CREATE(body, ID 없음)·UPDATE·REPLACE(ID+body)·ARCHIVE(ID, body 없음). 틀리면 undefined. */
function surfacePlanOf({
  op,
  object_id,
  body,
}: NonNullable<CommitRequest['surface']>): SurfacePlan | undefined {
  const id = idOrNull(object_id);
  switch (op) {
    case 'CREATE':
      return id === null && isPresent(body) ? { op, body } : undefined;
    case 'ARCHIVE':
      return id !== null && !isPresent(body) ? { op, id } : undefined;
    default:
      return id !== null && isPresent(body) ? { op, id, body } : undefined;
  }
}

/**
 * 서버 ZoneCommitService.plan 과 같은 모양 검사. 구역 ARCHIVE 에는 작업면을 붙이지 않고(이은 작업면도 함께 보관), 작업면 없는
 * KEEP 은 바꾸는 것이 없어 거절한다. 틀리면 undefined.
 */
function planOf(value: unknown): CommitPlan | undefined {
  const parsed = commitRequestSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const request = parsed.data;
  const zone = zonePlanOf(request.zone);
  if (!zone) return undefined;
  const publish = request.publish !== false;
  const setupSessionId = idOrNull(request.setup_session_id);
  if (!request.surface) {
    return zone.op === 'KEEP' ? undefined : { zone, surface: null, publish, setupSessionId };
  }
  const surface = surfacePlanOf(request.surface);
  return surface && zone.op !== 'ARCHIVE' ? { zone, surface, publish, setupSessionId } : undefined;
}

/** 한 번 저장이 바꾼 것(응답의 zone·surface·archived_surface_id 가 된다). */
interface CommitChanges {
  zoneId: string;
  zone: ZoneItem | null;
  surface: StaticObjectItem | null;
  archivedSurfaceId: string | null;
}

interface MockBundle {
  config_version: string;
  previous_config_version: string | null;
  issued_at: number;
  /** 이 시각부터 Tier 0 의 config_ack 가 있다. */
  ack_at: number;
  rejected: boolean;
  /** 발행 때 실린 구역·규칙·작업면(서버 config_bundle_item). */
  items: BundleItem[];
}

/** 작업 레이아웃에서 구역·작업면을 맞추는 요청(진행 중인 작업 하나). */
export interface LayoutZonesSync {
  workId: string;
  layoutId: number;
  /** 레이아웃의 지금 항목 전부. 이 항목들로 구역·작업면을 맞춘다. */
  items: readonly LayoutObbItem[];
  /** 맞추는 시각(ms). 없으면 구역 mock 의 지금 시각이다. */
  now?: number;
}

/** 작업 시작·진행 중 레이아웃 저장·종료 때 서버가 하는 일. 작업 mock(mocks/tbm)이 묶어서(bindLayoutZones) 부른다. */
export interface LayoutZonesHooks {
  /**
   * 레이아웃 항목으로 이 작업의 구역·작업면을 맞추고 묶음을 발행한다. 항목 ID(layout_item_id)로 지금 것과 견줘, 사라진 항목은
   * 끝내고(valid_to) 바뀐 항목은 새 버전, 새 항목은 새로 만든다. 같은 입력을 되풀이해도 구역이 늘지 않는다.
   */
  sync(input: LayoutZonesSync): void;
  /** 이 작업의 레이아웃 구역·작업면을 모두 끝내고(valid_to) 묶음을 발행한다. at 이 없으면 구역 mock 의 지금 시각이다. */
  end(workId: string, at?: number): void;
}

export interface ZonesMock {
  handlers: ReturnType<typeof http.get>[];
  /** 작업 시작·진행 중 저장·종료 때 레이아웃 항목으로 구역·작업면을 만들고 끝낸다(서버 WorkSessionService 의 일을 흉내 낸다). */
  layoutZones: LayoutZonesHooks;
  /** 상단 바 /topic/health 의 구성 묶음 상태(서버 ViewerHealthService 의 config 를 흉내 낸다). */
  config(): MockConfig;
  /** 지금 유효한 구역(세팅 mock 의 목록 채우기가 읽는다, S15P31A101-629). */
  currentZones(): readonly ZoneItem[];
  /** simAI-DEMO: 세팅 완료가 만든 새 구역을 관제 구역에 더하고 구성 묶음을 발행한다. */
  addZones(fields: readonly unknown[]): void;
  /** 다음 발행을 Tier 0 가 거부한다(REJECTED, 이전 묶음을 계속 쓴다). */
  rejectNextBundle(): void;
  /** 다음 발행 요청 하나를 서버 오류로 거절한다(묶음은 만들지 않는다). 409(보정·규칙·현장)·503(공개 주소). 기본은 보정 문서 없음이다. */
  failNextPublish(code?: PublishFailureCode): void;
}

/**
 * 구역 조회·만들기·새 버전·보관(삭제)과 구성 묶음 발행·조회, 구역·작업면 한 번 저장(POST /api/zones/commit). 로그인하지 않았거나
 * 실서버 토큰이 만료면 401, 쓰기는 관리자만(아니면 403)이다. 작업 레이아웃 항목으로 만든 구역·작업면(layoutZones)을 이 API 들로
 * 바꾸면 409 LAYOUT_ZONE_LOCKED 다.
 * 새 버전은 지금 버전을 닫고 다음 버전을 더한다(서버처럼 고치기 시작한 버전은 보지 않는다). 보관은 지금 버전의 valid_to 만 닫는다
 * (이력은 남고, 다시 보관해도 204, 보관한 구역을 고치면 404). 상태는 이 mock 이 살아 있는 동안만 둔다.
 * 처음에는 두 구역 v1·규칙·작업면 둘을 담은 cfg-12 가 현장에 적용되어 있다. 발행하는 묶음은 그때 유효한 구역과 staticObjects 가
 * 가진 지금 작업면·정적 객체(구역 mock 은 작업면 저장소를 들고 있지 않아 밖에서 받는다)와 규칙을 싣는다. 한 번 저장은 구역·
 * 작업면을 바꾸고 묶음까지 만들다가 어디서든 실패하면 둘 다 요청 전 상태로 되돌린다(서버 한 트랜잭션).
 */
export function createZonesMock({
  now = Date.now,
  ackDelayMs = ACK_DELAY_MS,
  staticObjects = createStaticObjectStore([]),
  onCommit,
}: {
  now?: () => number;
  ackDelayMs?: number;
  staticObjects?: StaticObjectStore;
  /**
   * 세팅 세션에 속한 구역 한 번 저장(POST /api/zones/commit 의 setup_session_id)이 묶음 발행까지 성공한 뒤 부른다(세션 id, 저장한
   * 시각 ms). 개발 서버가 세팅 mock 의 세션을 끝내는 데 쓴다.
   */
  onCommit?: (setupSessionId: string, at: number) => void;
} = {}): ZonesMock {
  // 지금 버전과 닫힌 버전. 지금 버전은 valid_to 가 null 이다.
  // simAI-DEMO: 시연 흐름은 처음 구역을 비운다(mocks/demoFlow.ts)
  let versions: ZoneItem[] = DEMO_FLOW ? [] : structuredClone(MOCK_ZONES);
  let issued = 0;
  let bundleNumber = SEEDED_CONFIG_NUMBER;
  // 새것부터.
  const bundles: MockBundle[] = [
    {
      config_version: `${CONFIG_VERSION_PREFIX}${bundleNumber}`,
      previous_config_version: null,
      issued_at: SEEDED_AT,
      ack_at: SEEDED_AT,
      rejected: false,
      items: DEMO_FLOW
        ? [RULE_ITEM]
        : [...MOCK_ZONES.map(zoneItem), RULE_ITEM, ...SEEDED_SURFACE_ITEMS],
    },
  ];
  let rejectNext = false;
  let failNext: PublishFailureCode | null = null;

  const deny = createDeny(now);
  const current = () => versions.filter((z) => z.valid_to === null);
  /** target 의 valid_to 를 t 로 닫은 전체 버전 목록. */
  const closed = (target: ZoneItem, t: number) =>
    versions.map((z) => (z === target ? { ...z, valid_to: t } : z));
  const findCurrent = (zoneId: string) => current().find((z) => z.zone_id === zoneId);

  /** 새 구역(v1)을 더한다. origin 은 작업 레이아웃 항목으로 만드는 구역의 출처다. */
  const addZone = (fields: ZoneFields, t: number, origin?: LayoutOrigin): ZoneItem => {
    const zone: ZoneItem = {
      ...fields,
      zone_id: hexId('z', ++issued),
      zone_version: 1,
      ...(origin ?? {}),
      valid_from: t,
      valid_to: null,
    };
    versions = [...versions, zone];
    return zone;
  };
  /** before 의 지금 버전을 닫고 다음 버전을 더한다. 레이아웃 출처는 origin 이 있으면 그것을, 없으면 before 의 것을 이어받는다. */
  const addVersion = (
    before: ZoneItem,
    fields: ZoneFields,
    t: number,
    origin?: LayoutOrigin,
  ): ZoneItem => {
    const zone: ZoneItem = {
      ...fields,
      zone_id: before.zone_id,
      zone_version: before.zone_version + 1,
      ...(origin ?? layoutOriginOf(before) ?? {}),
      valid_from: t,
      valid_to: null,
    };
    versions = [...closed(before, t), zone];
    return zone;
  };
  /** 구역을 보관한다. 이미 보관했으면(두 번 누름·재시도) 그대로 성공이고, 처음부터 없는 ID 면 false 다. */
  const archiveZone = (zoneId: string, t: number): boolean => {
    if (!versions.some((z) => z.zone_id === zoneId)) return false;
    const before = findCurrent(zoneId);
    if (before) versions = closed(before, t);
    return true;
  };
  /** 구역을 보관하고 이은 작업면도 함께 보관한다. 이은 작업면 ID(없으면 null)를 돌려준다. */
  const archiveWithSurface = (zoneId: string, t: number): string | null => {
    archiveZone(zoneId, t);
    const linked = staticObjects.linkedTo(zoneId);
    if (linked) staticObjects.archive(linked.object_id, t);
    return linked?.object_id ?? null;
  };

  const statusAt = (bundle: MockBundle, t: number): AckStatus => {
    if (t < bundle.ack_at) return 'PENDING';
    return bundle.rejected ? 'REJECTED' : 'APPLIED';
  };
  /** t 에 Tier 0 가 쓰고 있는 묶음(가장 최근에 적용된 것). */
  const activeAt = (t: number) => bundles.find((b) => statusAt(b, t) === 'APPLIED') ?? null;
  const lastAckOf = (bundle: MockBundle, status: AckStatus) =>
    status === 'PENDING'
      ? null
      : {
          result: status,
          // 그 묶음의 ACK 때 Tier 0 가 쓰던 묶음이다(뒤에 다른 묶음이 적용돼도 바뀌지 않는다).
          active_config_version: activeAt(bundle.ack_at)?.config_version ?? null,
          reject_reason: status === 'REJECTED' ? REJECT_REASON : null,
        };
  const view = (bundle: MockBundle) => {
    const status = statusAt(bundle, now());
    return {
      config_version: bundle.config_version,
      previous_config_version: bundle.previous_config_version,
      issued_at: bundle.issued_at,
      bundle_hash: `sha256:mock-${bundle.config_version}`,
      calibration_version: CALIBRATION_VERSION,
      rule_profile: DEFAULT_RULE_PROFILE,
      status,
      applied_at: status === 'APPLIED' ? bundle.ack_at : null,
      items: bundle.items,
      last_ack: lastAckOf(bundle, status),
    };
  };

  /** 서버처럼 그때 유효한 구역·작업면(보관한 것은 빠진다)과 규칙을 싣는다. */
  const bundleItems = (): BundleItem[] => [
    ...current().map(zoneItem),
    RULE_ITEM,
    ...staticObjects.current().map(staticObjectItem),
  ];
  /** 다음 번호의 묶음을 t 에 발행해 맨 앞에 더한다. */
  const publish = (t: number) => {
    const bundle: MockBundle = {
      config_version: `${CONFIG_VERSION_PREFIX}${++bundleNumber}`,
      previous_config_version: bundles[0]!.config_version,
      issued_at: t,
      ack_at: t + ackDelayMs,
      rejected: rejectNext,
      items: bundleItems(),
    };
    rejectNext = false;
    bundles.unshift(bundle);
    return bundle;
  };

  // 작업 레이아웃 구역·작업면. 작업 레이아웃 항목으로 만든 것은 layout_item_id 가 있고, 구역·작업면 API 로는 바꿀 수 없다.
  /** 작업 레이아웃 항목으로 만든 구역인가(보관한 것 포함). */
  const isLayoutZone = (zoneId: string) =>
    versions.some((z) => z.zone_id === zoneId && z.layout_item_id != null);
  const isLayoutSurface = (objectId: string) =>
    staticObjects.versionsOf(objectId).some((o) => o.layout_item_id != null);
  /** 한 번 저장이 레이아웃 구역·작업면을 고치거나 보관하려 하는가. */
  const touchesLayout = ({ zone, surface }: CommitPlan) =>
    (zone.op !== 'CREATE' && isLayoutZone(zone.id)) ||
    (surface !== null && surface.op !== 'CREATE' && isLayoutSurface(surface.id));

  /** 레이아웃 항목이 만들 구역 칸. 등급은 늘 경고, 판정은 입체다. */
  const layoutZoneFields = (plan: LayoutZonePlan): ZoneFields => ({
    name: plan.name,
    zone_kind: LAYOUT_ZONE_KIND,
    eval_type: LAYOUT_ZONE_JUDGE_TYPE,
    polygon_xy: plan.shape.polygon_xy,
    z_min_m: plan.shape.z_min_m,
    z_max_m: plan.shape.z_max_m,
    severity: LAYOUT_ZONE_SEVERITY,
    has_guardrail: null,
    requirements: null,
  });
  /** 구역이 계획과 같은가(이름·모양·높이·레이아웃). */
  const sameLayoutZone = (zone: ZoneItem, fields: ZoneFields, layoutId: number) =>
    zone.layout_id === layoutId &&
    zone.name === fields.name &&
    zone.z_min_m === fields.z_min_m &&
    zone.z_max_m === fields.z_max_m &&
    JSON.stringify(zone.polygon_xy) === JSON.stringify(fields.polygon_xy);
  const sameLayoutSurface = (surface: StaticObjectItem, fields: StaticObjectFields) =>
    surface.name === fields.name &&
    surface.top_height_m === fields.top_height_m &&
    JSON.stringify(surface.obb) === JSON.stringify(fields.obb);

  /** 구역에 이은 작업면을 계획대로 맞춘다: 없으면 만들고, 달라졌으면 새 버전, 계획에 작업면이 없으면 보관한다. */
  const syncLayoutSurface = (
    zone: ZoneItem,
    plan: LayoutZonePlan,
    origin: LayoutOrigin,
    t: number,
  ) => {
    const linked = staticObjects.linkedTo(zone.zone_id);
    const fields = plan.surface
      ? readStaticObjectFields(surfaceBodyOf(null, plan.name, plan.surface))
      : undefined;
    if (!fields) {
      if (linked) staticObjects.archive(linked.object_id, t);
    } else if (!linked) {
      staticObjects.create(fields, zone.zone_id, t, origin);
    } else if (!sameLayoutSurface(linked, fields)) {
      staticObjects.update(linked.object_id, fields, zone.zone_id, t);
    }
  };

  const layoutZones: LayoutZonesHooks = {
    sync: ({ workId, layoutId, items, now: at }) => {
      const t = at ?? now();
      const plans = layoutZonePlans(items);
      const wanted = new Set(plans.map((p) => p.itemId));
      const ofWork = (z: ZoneItem) => z.work_id === workId && z.layout_item_id != null;
      // 사라진 항목의 구역·작업면은 끝낸다.
      for (const zone of current().filter(ofWork)) {
        if (!wanted.has(zone.layout_item_id!)) archiveWithSurface(zone.zone_id, t);
      }
      for (const plan of plans) {
        const origin = { work_id: workId, layout_id: layoutId, layout_item_id: plan.itemId };
        const fields = layoutZoneFields(plan);
        const before = current().find((z) => ofWork(z) && z.layout_item_id === plan.itemId);
        let zone = before;
        if (!zone) zone = addZone(fields, t, origin);
        else if (!sameLayoutZone(zone, fields, layoutId))
          zone = addVersion(zone, fields, t, origin);
        syncLayoutSurface(zone, plan, origin, t);
      }
      publish(t);
    },
    end: (workId, at) => {
      const t = at ?? now();
      for (const zone of current().filter((z) => z.work_id === workId)) {
        archiveWithSurface(zone.zone_id, t);
      }
      for (const surface of staticObjects.current().filter((o) => o.work_id === workId)) {
        staticObjects.archive(surface.object_id, t);
      }
      publish(t);
    },
  };

  /** 구역을 이은 지금 작업면 ID. 이은 구역이 보관됐으면 이은 것으로 보지 않는다(서버 StaticObjectRepository.zoneOf). */
  const currentZoneOf = (objectId: string) => {
    const zoneId = staticObjects.find(objectId)?.zone_id;
    return zoneId && findCurrent(zoneId) ? zoneId : null;
  };
  /** 작업면을 이을 수 있는지 검사한다(서버 link). 작업면만 잇고, 구역에는 다른 지금 작업면이 없어야 한다. self 는 새 버전을 만드는 자기 자신. */
  const linkFailure = (kind: string, zoneId: string, self: string | null) => {
    if (kind !== WORK_SURFACE_KIND) return fail('INVALID_SURFACE_ZONE');
    const taken = staticObjects.current().some((o) => o.zone_id === zoneId && o.object_id !== self);
    return taken ? fail('SURFACE_ZONE_TAKEN') : undefined;
  };
  const createSurface = (body: unknown, zoneId: string, t: number) => {
    const fields = readStaticObjectFields(body);
    if (!fields) return fail('INVALID_STATIC_OBJECT');
    return linkFailure(fields.kind, zoneId, null) ?? staticObjects.create(fields, zoneId, t);
  };

  /** 한 번 저장의 구역 단계. ARCHIVE 는 이은 작업면도 함께 보관한다. */
  const applyZone = (zone: ZonePlan, t: number): CommitChanges | Response => {
    const unchanged = (zoneId: string): CommitChanges => ({
      zoneId,
      zone: null,
      surface: null,
      archivedSurfaceId: null,
    });
    if (zone.op === 'CREATE') {
      const fields = checkZoneBody(zone.body);
      if (fields instanceof Response) return fields;
      const added = addZone(fields, t);
      return { ...unchanged(added.zone_id), zone: added };
    }
    if (zone.op === 'UPDATE') {
      const before = findCurrent(zone.id);
      if (!before) return fail('ZONE_NOT_FOUND');
      const fields = checkZoneBody(zone.body);
      if (fields instanceof Response) return fields;
      return { ...unchanged(zone.id), zone: addVersion(before, fields, t) };
    }
    if (zone.op === 'ARCHIVE') {
      if (!versions.some((z) => z.zone_id === zone.id)) return fail('ZONE_NOT_FOUND');
      return { ...unchanged(zone.id), archivedSurfaceId: archiveWithSurface(zone.id, t) };
    }
    return findCurrent(zone.id) ? unchanged(zone.id) : fail('ZONE_NOT_FOUND');
  };

  /** 한 번 저장의 작업면 단계. 이 구역에 잇는다. */
  const applySurface = (
    surface: SurfacePlan,
    changes: CommitChanges,
    t: number,
  ): CommitChanges | Response => {
    const { zoneId } = changes;
    // 다른 구역에 이어진 작업면은 이 구역 저장으로 바꾸거나 가져오지 않는다(보관한 구역에 걸린 것은 가져올 수 있다).
    const owner = surface.op === 'CREATE' ? null : currentZoneOf(surface.id);
    if (owner !== null && owner !== zoneId) return fail('SURFACE_ZONE_TAKEN');
    if (surface.op === 'CREATE') {
      const added = createSurface(surface.body, zoneId, t);
      return added instanceof Response ? added : { ...changes, surface: added };
    }
    if (surface.op === 'ARCHIVE') {
      if (!staticObjects.archive(surface.id, t)) return fail('STATIC_OBJECT_NOT_FOUND');
      return { ...changes, archivedSurfaceId: surface.id };
    }
    if (surface.op === 'REPLACE') {
      if (!staticObjects.archive(surface.id, t)) return fail('STATIC_OBJECT_NOT_FOUND');
      const added = createSurface(surface.body, zoneId, t);
      return added instanceof Response
        ? added
        : { ...changes, surface: added, archivedSurfaceId: surface.id };
    }
    const fields = readStaticObjectFields(surface.body);
    if (!fields) return fail('INVALID_STATIC_OBJECT');
    if (!staticObjects.find(surface.id)) return fail('STATIC_OBJECT_NOT_FOUND');
    const failure = linkFailure(fields.kind, zoneId, surface.id);
    if (failure) return failure;
    return { ...changes, surface: staticObjects.update(surface.id, fields, zoneId, t) ?? null };
  };

  /**
   * 한 번 저장: 구역 → 작업면 → (publish 면) 묶음. 어느 단계든 실패하면 구역·작업면을 요청 전 상태로 되돌리고 오류를 준다
   * (서버 한 트랜잭션). failNextPublish 로 정한 오류는 묶음을 만들 때 난다(publish 가 false 면 묶음을 만들지 않아 나지 않는다).
   */
  const commit = (plan: CommitPlan, t: number): Response => {
    const backup = { versions, issued, surfaces: staticObjects.snapshot() };
    const rollback = (failure: Response) => {
      ({ versions, issued } = backup);
      staticObjects.restore(backup.surfaces);
      return failure;
    };
    let changes = applyZone(plan.zone, t);
    if (changes instanceof Response) return rollback(changes);
    if (plan.surface) changes = applySurface(plan.surface, changes, t);
    if (changes instanceof Response) return rollback(changes);
    if (plan.publish && failNext !== null) {
      const code = failNext;
      failNext = null;
      return rollback(fail(code));
    }
    const bundle = plan.publish ? view(publish(t)) : null;
    return HttpResponse.json({
      zone_id: changes.zoneId,
      zone: changes.zone,
      surface: changes.surface,
      archived_surface_id: changes.archivedSurfaceId,
      bundle,
    });
  };

  const handlers = [
    http.get('*/api/zones', ({ request }) => deny(request, false) ?? HttpResponse.json(current())),
    http.get('*/api/zones/:zoneId/versions', ({ request, params }) => {
      const denied = deny(request, false);
      if (denied) return denied;
      const list = versions.filter((z) => z.zone_id === params.zoneId);
      return list.length > 0 ? HttpResponse.json(list) : fail('ZONE_NOT_FOUND');
    }),
    http.post('*/api/zones', async ({ request }) => {
      const denied = deny(request, true);
      if (denied) return denied;
      const fields = checkZoneBody(await request.json().catch(() => undefined));
      if (fields instanceof Response) return fields;
      return created(addZone(fields, now()));
    }),
    http.put('*/api/zones/:zoneId', async ({ request, params }) => {
      const denied = deny(request, true);
      if (denied) return denied;
      if (isLayoutZone(String(params.zoneId))) return fail('LAYOUT_ZONE_LOCKED');
      const before = findCurrent(String(params.zoneId));
      if (!before) return fail('ZONE_NOT_FOUND');
      const fields = checkZoneBody(await request.json().catch(() => undefined));
      if (fields instanceof Response) return fields;
      return HttpResponse.json(addVersion(before, fields, now()));
    }),
    http.delete('*/api/zones/:zoneId', ({ request, params }) => {
      const denied = deny(request, true);
      if (denied) return denied;
      if (isLayoutZone(String(params.zoneId))) return fail('LAYOUT_ZONE_LOCKED');
      return archiveZone(String(params.zoneId), now()) ? noContent() : fail('ZONE_NOT_FOUND');
    }),
    http.post('*/api/zones/commit', async ({ request }) => {
      const denied = deny(request, true);
      if (denied) return denied;
      const plan = planOf(await request.json().catch(() => undefined));
      if (!plan) return fail('INVALID_ZONE_COMMIT');
      if (touchesLayout(plan)) return fail('LAYOUT_ZONE_LOCKED');
      const at = now();
      const response = commit(plan, at);
      if (response.ok && plan.publish && plan.setupSessionId !== null)
        onCommit?.(plan.setupSessionId, at);
      return response;
    }),
    http.post('*/api/config-bundles', async ({ request }) => {
      const denied = deny(request, true);
      if (denied) return denied;
      const body: unknown = await request.json().catch(() => null);
      if (!isValidProfile(profileOf(body))) return fail('INVALID_RULE_PROFILE');
      if (failNext !== null) {
        const code = failNext;
        failNext = null;
        return fail(code);
      }
      return created(view(publish(now())));
    }),
    http.get('*/api/config-bundles', ({ request }) => {
      return (
        deny(request, false) ?? HttpResponse.json(bundles.slice(0, BUNDLE_LIST_LIMIT).map(view))
      );
    }),
    http.get('*/api/config-bundles/:version', ({ request, params }) => {
      const denied = deny(request, false);
      if (denied) return denied;
      const bundle = bundles.find((b) => b.config_version === params.version);
      return bundle ? HttpResponse.json(view(bundle)) : fail('CONFIG_BUNDLE_NOT_FOUND');
    }),
  ];

  return {
    handlers,
    layoutZones,
    config: () => {
      const t = now();
      const latest = bundles[0]!;
      return {
        published_version: latest.config_version,
        applied_version: activeAt(t)?.config_version ?? null,
        sync: SYNC_BY_STATUS[statusAt(latest, t)],
      };
    },
    currentZones: () => current(),
    // simAI-DEMO
    addZones: (fields) => {
      if (fields.length === 0) return;
      const t = now();
      fields.forEach((f) => addZone(f as ZoneFields, t));
      // 서버처럼 새 구역을 실은 구성 묶음을 발행한다(관제 적용 상태의 구역 수)
      publish(t);
    },
    rejectNextBundle: () => {
      rejectNext = true;
    },
    failNextPublish: (code = 'CALIBRATION_MISSING') => {
      failNext = code;
    },
  };
}
