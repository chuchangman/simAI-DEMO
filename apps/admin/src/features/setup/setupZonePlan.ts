import { hasChangeOpinion } from '@/features/setup/setupUx';
import { zoneHeightChangesSummarySchema } from '@/features/setup/types';
import { staticObjectItemSchema, type StaticObjectBody } from '@/features/surfaces/types';
import {
  zoneAiOpinionSchema,
  zoneHeightChangeSchema,
  zoneItemSchema,
  type ZoneBody,
  type ZoneCommitRequest,
  type ZoneCommitResult,
  type ZoneItem,
} from '@/features/zones/types';
import { z } from 'zod';

// 세팅 중 구역 목록(-612 GET·PUT /api/setup-sessions/{id}/zones)을 구역 편집 화면이 쓰는 모양으로 바꾸는 순수 계산(S15P31A101-615).
// 세팅 구역 단계는 관제 구역(zones/commit)을 바로 바꾸지 않고 이 목록을 고친다. 세팅 완료가 목록을 한 번에 관제 구역으로 적용한다.
// - 화면의 구역 목록은 목록 기준이다: zone_id 항목은 지금 관제 구역(본문이 있으면 그 본문으로), 새 항목은 임시 ID(setup-new-<순번>).
// - 화면의 저장 요청(ZoneCommitRequest)은 목록 고치기로 바꾼다: 만들기 → 항목 추가, 새 버전 → 본문 바꾸기, 보관 → 항목 빼기.
// - 확인 필요(needs_review, S15P31A101-629): 새 모델 + World 이어짐 세팅이 지금 관제 구역으로 채운 항목은 사람이 확인·수정·삭제하기
//   전까지 true 다. 고치면(본문·작업면) 확인한 것으로 본다. 화면 구역에는 needs_review 를 실어 목록 카드·3D 가 구별해 그린다.

export const SETUP_NEW_ZONE_PREFIX = 'setup-new-';
const SETUP_NEW_SURFACE_PREFIX = 'setup-surface-';

const looseRecord = z.record(z.string(), z.unknown());

/** 목록 항목(서버 SetupZonePlanService.Item). zone·surface 는 구역·작업면 본문(서버가 검사한다). */
export const setupZonePlanItemSchema = z.object({
  zone_id: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  source: z.enum(['AI', 'MANUAL']),
  candidate_id: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  zone: looseRecord.nullish().transform((v) => (v ?? null) as ZoneBody | null),
  surface: looseRecord.nullish().transform((v) => (v ?? null) as StaticObjectBody | null),
  /** 사람이 아직 확인하지 않은 이어 쓴 구역(S15P31A101-629). 없으면 확인된 것. */
  needs_review: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  /** 이어 쓴 구역의 상면 높이 차이 판정(S15P31A101-630). 조회·저장 응답에만 붙고 PUT 요청 본문에는 보내지 않는다. */
  height_change: zoneHeightChangeSchema.nullish().catch(null),
  /** 변경 의심 구역의 AI 의견과 전후 사진(S15P31A101-631). 조회·저장 응답에만 붙고 PUT 요청 본문에는 보내지 않는다. */
  ai_opinion: zoneAiOpinionSchema.nullish().catch(null),
});
export type SetupZonePlanItem = z.infer<typeof setupZonePlanItemSchema>;

export const setupZonePlanViewSchema = z
  .object({
    setup_session_id: z.string(),
    items: z.array(setupZonePlanItemSchema).default([]),
    revision: z.number().int().min(0),
    updated_at: z.number().nullish(),
    zone_height_changes: zoneHeightChangesSummarySchema.nullish().catch(null),
  })
  .loose();
export type SetupZonePlanView = z.infer<typeof setupZonePlanViewSchema>;

/** 화면이 저장할 때 새 항목에 붙일 출처(AI 초안 수락이면 AI + 후보 ID). */
export interface PlanItemOrigin {
  source: 'AI' | 'MANUAL';
  candidateId: string | null;
}

/** 목록을 고칠 수 없는 요청(목록에 없는 구역, 기존 작업면만 지우기). 서버에 보내지 않는다. */
export class SetupZonePlanEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupZonePlanEditError';
  }
}

function parseZones(raw: readonly unknown[] | undefined): Map<string, ZoneItem> {
  const out = new Map<string, ZoneItem>();
  for (const item of raw ?? []) {
    const parsed = zoneItemSchema.safeParse(item);
    if (parsed.success) out.set(parsed.data.zone_id, parsed.data);
  }
  return out;
}

/** 항목의 화면 ID: 이어 쓰는 구역이면 그 zone_id, 새 구역이면 임시 ID. */
export function planItemViewId(items: readonly SetupZonePlanItem[], index: number): string {
  const item = items[index];
  return item?.zone_id ?? `${SETUP_NEW_ZONE_PREFIX}${index}`;
}

function indexOfViewId(items: readonly SetupZonePlanItem[], viewId: string): number {
  if (viewId.startsWith(SETUP_NEW_ZONE_PREFIX)) {
    const index = Number(viewId.slice(SETUP_NEW_ZONE_PREFIX.length));
    return Number.isInteger(index) && items[index] && items[index].zone_id === null ? index : -1;
  }
  return items.findIndex((item) => item.zone_id === viewId);
}

function zoneViewOf(
  items: readonly SetupZonePlanItem[],
  index: number,
  live: Map<string, ZoneItem>,
): ZoneItem | null {
  const item = items[index]!;
  const current = item.zone_id ? live.get(item.zone_id) : undefined;
  if (item.zone_id && !current && !item.zone) return null;
  if (!item.zone) {
    return current
      ? {
          ...current,
          needs_review: item.needs_review,
          height_change: item.height_change ?? null,
          ai_opinion: item.ai_opinion ?? null,
        }
      : null;
  }
  const merged = {
    ...(current ?? {}),
    ...item.zone,
    zone_id: planItemViewId(items, index),
    zone_version: current?.zone_version ?? 1,
    valid_from: current?.valid_from ?? 0,
    valid_to: null,
    needs_review: item.needs_review,
    height_change: item.height_change ?? null,
    ai_opinion: item.ai_opinion ?? null,
  };
  const parsed = zoneItemSchema.safeParse(merged);
  return parsed.success ? parsed.data : null;
}

/** 화면 구역 목록(GET /api/zones 와 같은 모양): 목록의 항목만, 이어 쓰는 구역은 지금 관제 구역에 본문을 덮는다. */
export function planZonesView(
  plan: SetupZonePlanView,
  liveZones: readonly unknown[] | undefined,
): ZoneItem[] {
  const live = parseZones(liveZones);
  return plan.items.flatMap((_, index) => {
    const view = zoneViewOf(plan.items, index, live);
    return view ? [view] : [];
  });
}

/**
 * 화면 정적 객체 목록(GET /api/static-objects 와 같은 모양). 장애물·구역 없는 작업면은 그대로, 구역에 이은 작업면은 그 구역이
 * 목록에 있을 때만 둔다(목록에 없는 구역은 완료 때 작업면과 함께 보관된다). 항목의 작업면 본문은 이은 작업면을 덮거나 새로 만든다.
 */
export function planStaticObjectsView(
  plan: SetupZonePlanView,
  liveObjects: readonly unknown[] | undefined,
): unknown[] {
  const listed = new Map<string, number>();
  plan.items.forEach((item, index) => {
    if (item.zone_id) listed.set(item.zone_id, index);
  });
  const out: unknown[] = [];
  const replaced = new Set<number>();
  for (const raw of liveObjects ?? []) {
    const parsed = staticObjectItemSchema.safeParse(raw);
    const zoneId = parsed.success ? (parsed.data.zone_id ?? null) : null;
    if (!parsed.success || zoneId === null) {
      out.push(raw);
      continue;
    }
    const index = listed.get(zoneId);
    if (index === undefined) continue;
    const body = plan.items[index]!.surface;
    if (body) {
      out.push({ ...parsed.data, ...body, zone_id: zoneId });
      replaced.add(index);
    } else {
      out.push(raw);
    }
  }
  plan.items.forEach((item, index) => {
    if (!item.surface || replaced.has(index)) return;
    out.push({
      ...item.surface,
      object_id: `${SETUP_NEW_SURFACE_PREFIX}${index}`,
      object_version: 1,
      zone_id: planItemViewId(plan.items, index),
      valid_from: 0,
      valid_to: null,
    });
  });
  return out;
}

function surfaceBodyOf(request: ZoneCommitRequest): StaticObjectBody | null | undefined {
  const surface = request.surface;
  if (!surface) return undefined;
  if (surface.op === 'ARCHIVE') return null;
  return surface.body;
}

/**
 * 화면의 저장 요청을 목록 고치기로 바꾼다. 돌려주는 result 는 zones/commit 응답 모양이다(화면이 고른 구역을 열 수 있게 화면 ID 와
 * 바뀐 구역을 싣는다. 묶음은 없다).
 */
export function applyCommitToPlan(
  plan: SetupZonePlanView,
  liveZones: readonly unknown[] | undefined,
  request: ZoneCommitRequest,
  origin: PlanItemOrigin = { source: 'MANUAL', candidateId: null },
): { items: SetupZonePlanItem[]; result: ZoneCommitResult } {
  const items = plan.items.map((item) => ({ ...item }));
  const surfaceBody = surfaceBodyOf(request);
  let index: number;
  if (request.zone.op === 'CREATE') {
    items.push({
      zone_id: null,
      source: origin.source,
      candidate_id: origin.candidateId,
      zone: request.zone.body,
      surface: surfaceBody ?? null,
      needs_review: false,
    });
    index = items.length - 1;
  } else {
    index = indexOfViewId(items, request.zone.zone_id);
    if (index < 0) throw new SetupZonePlanEditError('세팅 구역 목록에 없는 구역입니다');
    if (request.zone.op === 'ARCHIVE') {
      items.splice(index, 1);
      return {
        items,
        result: {
          zone_id: request.zone.zone_id,
          zone: null,
          surface: null,
          archived_surface_id: null,
          bundle: null,
        },
      };
    }
    const item = items[index]!;
    if (request.zone.op === 'UPDATE') item.zone = request.zone.body;
    if (surfaceBody === null && item.zone_id !== null) {
      // 목록은 '작업면만 지우기'를 나타내지 못한다(-612 남은 일). 구역을 빼거나 새 구역으로 다시 그린다
      throw new SetupZonePlanEditError('세팅 중에는 기존 구역의 작업면만 따로 지울 수 없습니다');
    }
    if (surfaceBody !== undefined) item.surface = surfaceBody;
    // 고친 구역은 사람이 본 것이다(서버도 본문·작업면이 있는 항목의 확인 필요를 지운다)
    if (request.zone.op === 'UPDATE' || surfaceBody !== undefined) item.needs_review = false;
  }
  return {
    items,
    result: {
      zone_id: planItemViewId(items, index),
      zone: zoneViewOf(items, index, parseZones(liveZones)),
      surface: null,
      archived_surface_id: null,
      bundle: null,
    },
  };
}

/** 지금 관제 구역을 목록 항목으로(zone_id 를 이어 쓰고 본문은 비운다: 완료 때 그대로 둔다). 이미 목록에 있는 구역은 뺀다. */
export function liveZonesAsItems(
  liveZones: readonly unknown[] | undefined,
  existing: readonly SetupZonePlanItem[] = [],
): SetupZonePlanItem[] {
  const have = new Set(existing.flatMap((item) => (item.zone_id ? [item.zone_id] : [])));
  return [...parseZones(liveZones).keys()]
    .filter((zoneId) => !have.has(zoneId))
    .map((zoneId) => ({
      zone_id: zoneId,
      source: 'MANUAL',
      candidate_id: null,
      zone: null,
      surface: null,
      needs_review: false,
    }));
}

/** PUT 본문 항목(서버 Item 모양 그대로). */
export function toPlanRequestItems(items: readonly SetupZonePlanItem[]) {
  return items.map(({ zone_id, source, candidate_id, zone, surface, needs_review }) => ({
    zone_id,
    source,
    candidate_id,
    zone,
    surface,
    needs_review,
  }));
}

/** 확인이 필요한 항목 수(S15P31A101-629). 0 이어야 세팅을 완료할 수 있다. */
export function pendingReviewCount(plan: SetupZonePlanView | undefined): number {
  return plan ? plan.items.filter((item) => item.needs_review).length : 0;
}

/** AI 의견을 기다리는 동안 다시 받을 간격(ms). */
export const OPINION_PENDING_REFETCH_MS = 5_000;
/** 전·후 사진 서명 주소가 끝나기 이만큼 전에 목록을 다시 받는다(ms). */
const OPINION_URL_MARGIN_MS = 30_000;
const OPINION_URL_MIN_REFETCH_MS = 15_000;

/**
 * 구역 목록을 다시 받을 간격(S15P31A101-631). AI 의견이 대기 중(PENDING)이면 짧게, 전·후 사진 서명 주소가 있으면 끝나기 전에,
 * 둘 다 없으면 다시 받지 않는다(false).
 */
export function planRefetchIntervalMs(
  plan: SetupZonePlanView | undefined,
  now: number = Date.now(),
): number | false {
  if (!plan) return false;
  const opinions = plan.items.map((item) => item.ai_opinion).filter((o) => o != null);
  if (opinions.some((o) => o.status === 'PENDING')) return OPINION_PENDING_REFETCH_MS;
  const expiries = opinions
    .map((o) => o.image_expires_at_ms)
    .filter((t): t is number => typeof t === 'number');
  if (expiries.length === 0) return false;
  return Math.max(Math.min(...expiries) - now - OPINION_URL_MARGIN_MS, OPINION_URL_MIN_REFETCH_MS);
}

/** 확인이 필요한 항목 중 높이 차이 판정이 '변화 없음(UNCHANGED)'인 구역 수(S15P31A101-630). */
export function unchangedPendingReviewCount(plan: SetupZonePlanView | undefined): number {
  return plan
    ? plan.items.filter(
        (item) =>
          item.needs_review &&
          item.height_change?.status === 'UNCHANGED' &&
          !hasChangeOpinion(item.ai_opinion),
      ).length
    : 0;
}

/** 화면 ID 들(없으면 모두)의 확인 필요를 지운 목록. 바뀐 것이 없으면 null. */
export function confirmPlanItems(
  items: readonly SetupZonePlanItem[],
  viewIds?: readonly string[],
): SetupZonePlanItem[] | null {
  const targets = viewIds ? new Set(viewIds) : null;
  let changed = false;
  const next = items.map((item, index) => {
    if (!item.needs_review || (targets && !targets.has(planItemViewId(items, index)))) return item;
    changed = true;
    return { ...item, needs_review: false };
  });
  return changed ? next : null;
}

/** 높이 차이 판정이 '변화 없음(UNCHANGED)'인 미확인 항목만 한 번에 확인한다(S15P31A101-630). 변경 의심·모름은 그대로 남는다. */
export function confirmUnchangedPlanItems(
  items: readonly SetupZonePlanItem[],
): SetupZonePlanItem[] | null {
  let changed = false;
  const next = items.map((item) => {
    if (
      !item.needs_review ||
      item.height_change?.status !== 'UNCHANGED' ||
      hasChangeOpinion(item.ai_opinion)
    )
      return item;
    changed = true;
    return { ...item, needs_review: false };
  });
  return changed ? next : null;
}

/** 화면 ID 의 항목을 뺀 목록(완료 때 그 구역은 보관된다). 목록에 없으면 null. */
export function removePlanItem(
  items: readonly SetupZonePlanItem[],
  viewId: string,
): SetupZonePlanItem[] | null {
  const index = indexOfViewId(items, viewId);
  return index < 0 ? null : items.filter((_, i) => i !== index);
}
