import {
  staticObjectBodySchema,
  type StaticObjectBody,
  type StaticObjectItem,
} from '@/features/surfaces/types';
import { hexId } from '@/mocks/hexId';

// 작업면·정적 객체 mock 의 저장소(상태)와 값 검사. 작업면 API mock(mocks/staticObjects)과 구역 한 번 저장(mocks/zones 의
// POST /api/zones/commit)이 함께 쓴다. 구역 mock 을 가져오지 않아(순환 방지) 오류 응답은 만들지 않고 결과만 돌려준다.

/** 작업면 ID 접두. 그 밖의 정적 객체(장애물)는 so- 다. */
const WORK_SURFACE_ID_PREFIX = 'ws';
const OBSTACLE_ID_PREFIX = 'so';
export const WORK_SURFACE_KIND = 'WORK_SURFACE';

/** 중심·크기·회전이 모두 유한한 수이고 크기가 양수다. */
const isValidObb = ({ center, size, yaw_rad }: StaticObjectBody['obb']) =>
  [...center, ...size, yaw_rad].every(Number.isFinite) && size.every((v) => v > 0);

/** 상판 높이(float4 로 저장한 값): 있으면 유한해야 하고, 작업면은 반드시 있고 양수여야 한다. */
function isValidTop(kind: StaticObjectBody['kind'], stored: number | null): boolean {
  if (stored === null) return kind !== WORK_SURFACE_KIND;
  return Number.isFinite(stored) && (kind !== WORK_SURFACE_KIND || stored > 0);
}

const isValidSigma = (sigma: number | null) =>
  sigma === null || (Number.isFinite(sigma) && sigma >= 0);

/** 서버(StaticObjectRepository.check)와 같은 검사를 통과한 저장할 칸. */
export interface StaticObjectFields {
  kind: StaticObjectBody['kind'];
  name: string | null;
  obb: StaticObjectBody['obb'];
  top_height_m: number | null;
  sigma: number | null;
}

/** 요청 본문(JSON 값)을 서버와 같은 규칙으로 검사한다. 통과하면 저장할 칸, 아니면 undefined. */
export function readStaticObjectFields(value: unknown): StaticObjectFields | undefined {
  const body = staticObjectBodySchema.safeParse(value);
  if (!body.success) return undefined;
  const { kind, obb, top_height_m: top, top_height_sigma_m: sigma } = body.data;
  // 서버는 real(float4) 열에 들어간 값으로 상판을 검사하고 그 값을 돌려준다.
  const stored = top === null ? null : Math.fround(top);
  if (!isValidObb(obb) || !isValidTop(kind, stored) || !isValidSigma(sigma)) return undefined;
  return { kind, name: body.data.name?.trim() || null, obb, top_height_m: stored, sigma };
}

/** 작업 시작 때 작업 레이아웃 항목으로 만든 작업면·구역의 출처(서버 work_id·layout_id·layout_item_id 열). 상시 것에는 없다. */
export interface LayoutOrigin {
  work_id: string;
  layout_id: number;
  layout_item_id: string;
}

/** 항목에 실린 출처. 상시 작업면·구역이면 undefined. */
export function layoutOriginOf(item: {
  work_id?: string | null;
  layout_id?: number | null;
  layout_item_id?: string | null;
}): LayoutOrigin | undefined {
  const { work_id: workId, layout_id: layoutId, layout_item_id: itemId } = item;
  return workId != null && layoutId != null && itemId != null
    ? { work_id: workId, layout_id: layoutId, layout_item_id: itemId }
    : undefined;
}

const itemOf = (
  id: string,
  version: number,
  f: StaticObjectFields,
  zoneId: string | null,
  t: number,
  origin?: LayoutOrigin,
): StaticObjectItem => ({
  object_id: id,
  object_version: version,
  kind: f.kind,
  name: f.name,
  obb: f.obb,
  top_height_m: f.top_height_m,
  ...(f.sigma === null ? {} : { top_height_sigma_m: f.sigma }),
  zone_id: zoneId,
  ...(origin ?? {}),
  valid_from: t,
  valid_to: null,
});

/** 저장소 상태 사본. 한 번 저장이 중간에 실패하면 되돌리는 데 쓴다(상태는 바뀔 때마다 새로 만들어 참조만 들고 있으면 된다). */
export interface StaticObjectSnapshot {
  versions: StaticObjectItem[];
  issued: number;
}

export interface StaticObjectStore {
  /** 지금 버전(보관하지 않은 작업면·정적 객체). */
  current(): StaticObjectItem[];
  /** 한 객체의 모든 버전(보관한 것 포함, 옛 것부터). 없으면 빈 목록. */
  versionsOf(objectId: string): StaticObjectItem[];
  /** 지금 버전. 없거나 보관했으면 undefined. */
  find(objectId: string): StaticObjectItem | undefined;
  /** 이 구역에 이어진 지금 작업면. */
  linkedTo(zoneId: string): StaticObjectItem | undefined;
  /** origin 은 작업 레이아웃 항목으로 만든 작업면이면 그 출처다(새 버전은 이를 그대로 이어받는다). */
  create(
    fields: StaticObjectFields,
    zoneId: string | null,
    t: number,
    origin?: LayoutOrigin,
  ): StaticObjectItem;
  /**
   * 새 버전. zoneId 가 undefined 면 이전 연결을 그대로 두고(장애물로 바꾸면 푼다), null 이면 푼다. 지금 버전이 없으면
   * undefined. 이어받은 구역이 보관됐는지는 보지 않는다(구역 mock 이 아닌 저장소라 모른다). 레이아웃 출처는 그대로 이어받는다.
   */
  update(
    objectId: string,
    fields: StaticObjectFields,
    zoneId: string | null | undefined,
    t: number,
  ): StaticObjectItem | undefined;
  /** 지금 버전을 닫는다. 이미 보관했으면 그대로 성공이고, 처음부터 없는 ID 면 false 다. */
  archive(objectId: string, t: number): boolean;
  snapshot(): StaticObjectSnapshot;
  restore(snapshot: StaticObjectSnapshot): void;
}

export function createStaticObjectStore(seed: readonly StaticObjectItem[]): StaticObjectStore {
  // 지금 버전과 닫힌 버전. 지금 버전은 valid_to 가 null 이다.
  let versions: StaticObjectItem[] = structuredClone([...seed]);
  let issued = 0;

  const current = () => versions.filter((o) => o.valid_to === null);
  const find = (objectId: string) => current().find((o) => o.object_id === objectId);
  /** target 의 valid_to 를 t 로 닫은 전체 버전 목록. */
  const closed = (target: StaticObjectItem, t: number) =>
    versions.map((o) => (o === target ? { ...o, valid_to: t } : o));

  return {
    current,
    versionsOf: (objectId) => versions.filter((o) => o.object_id === objectId),
    find,
    linkedTo: (zoneId) => current().find((o) => o.zone_id === zoneId),
    create: (fields, zoneId, t, origin) => {
      // 서버는 작업면이면 ws-, 아니면 so- 뒤에 8 hex 를 고른다.
      const prefix =
        fields.kind === WORK_SURFACE_KIND ? WORK_SURFACE_ID_PREFIX : OBSTACLE_ID_PREFIX;
      const item = itemOf(hexId(prefix, ++issued), 1, fields, zoneId, t, origin);
      versions = [...versions, item];
      return item;
    },
    update: (objectId, fields, zoneId, t) => {
      const before = find(objectId);
      if (!before) return undefined;
      const kept = fields.kind === WORK_SURFACE_KIND ? (before.zone_id ?? null) : null;
      const item = itemOf(
        objectId,
        before.object_version + 1,
        fields,
        zoneId === undefined ? kept : zoneId,
        t,
        layoutOriginOf(before),
      );
      versions = [...closed(before, t), item];
      return item;
    },
    archive: (objectId, t) => {
      if (!versions.some((o) => o.object_id === objectId)) return false;
      const before = find(objectId);
      // 이미 보관했으면(두 번 누름·재시도) 그대로 성공이다.
      if (before) versions = closed(before, t);
      return true;
    },
    snapshot: () => ({ versions, issued }),
    restore: (snapshot) => {
      ({ versions, issued } = snapshot);
    },
  };
}
