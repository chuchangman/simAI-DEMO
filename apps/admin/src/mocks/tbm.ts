import { todayIsoDate } from '@/features/tbm/taskInput';
import { dateHhmmToMs, type LayoutDetail, type TbmWorkUnit } from '@/features/tbm/types';
import { MOCK_ZONES, type LayoutZonesHooks } from '@/mocks/zones';
import { http, HttpResponse } from 'msw/http';

// 작업 관리 새 흐름 이전의 작업(오늘의 데모 작업 셋)과 가상 레이아웃 MSW 핸들러. 관제 화면의 작업 목록·구역 mock 과 시험이 쓴다.
// 하루 작업·보고서·서명·제출은 mocks/work.ts 가 맡고, 여기서는 서명 이미지 올리기(POST /api/uploads/sign)만 같이 쓴다.

const INITIAL_LAYOUTS: readonly LayoutDetail[] = [
  {
    layout_id: 101,
    name: '개구부 옆 비계 배치 (z-04)',
    revision: 3,
    layout_version: 'lv-3',
    source: 'PLANNED',
    item_count: 1,
    created_at: 1760572800000,
    updated_at: 1760572800000,
    items: [
      {
        item_id: 'pos-01',
        kind: 'SCAFFOLD',
        center: [6.1, 2.4, 1.2],
        size: [1.0, 2.4, 2.4],
        yaw_rad: 0,
        label: '비계 S1',
      },
    ],
  },
  {
    layout_id: 102,
    name: '자재 반입 동선·주차 배치 (z-02)',
    revision: 1,
    layout_version: 'lv-1',
    source: 'PLANNED',
    item_count: 2,
    created_at: 1760572800000,
    updated_at: 1760572800000,
    items: [
      {
        item_id: 'eq-parking-p1',
        kind: 'EQUIPMENT',
        center: [7.9, 7.9, 0.5],
        size: [2.6, 2.6, 1.0],
        yaw_rad: 0,
        label: '장비 주차 P1',
      },
      {
        item_id: 'eq-forklift-path',
        kind: 'EQUIPMENT',
        center: [6.225, 3.0, 0.45],
        size: [2.75, 0.9, 0.9],
        yaw_rad: 0,
        label: '지게차 동선',
      },
    ],
  },
  {
    layout_id: 103,
    name: '북서쪽 바닥 마감 배치',
    revision: 1,
    layout_version: 'lv-1',
    source: 'PLANNED',
    item_count: 1,
    created_at: 1760572800000,
    updated_at: 1760572800000,
    items: [
      {
        item_id: 'area-m1',
        kind: 'OPENING',
        center: [2.4, 2.8, 0.05],
        size: [3.6, 4.4, 0.1],
        yaw_rad: 0,
        label: '마감 구역 M1',
      },
    ],
  },
];

interface LayoutRevisionRecord {
  layout_id: number;
  revision: number;
  layout_version: string;
  name: string;
  items: LayoutDetail['items'];
  created_at: number;
}

function validateLayoutPayload(body: Record<string, unknown> | null):
  | {
      ok: true;
      name: string;
      items: LayoutDetail['items'];
      revision: number | undefined;
    }
  | {
      ok: false;
      detail: string;
    } {
  if (!body || typeof body.name !== 'string') {
    return { ok: false, detail: 'name 은 필수입니다.' };
  }
  const name = body.name.trim();
  if (name.length === 0 || name.length > 100) {
    return { ok: false, detail: 'name 은 1~100 자여야 합니다.' };
  }
  if (!Array.isArray(body.items)) {
    return { ok: false, detail: 'items 배열이 필요합니다.' };
  }
  if (body.items.length > 200) {
    return { ok: false, detail: 'items 는 200 개 이하여야 합니다.' };
  }
  const ids = new Set<string>();
  const items: LayoutDetail['items'] = [];
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, detail: 'item 형식이 올바르지 않습니다.' };
    }
    const item = raw as Record<string, unknown>;
    const itemId = typeof item.item_id === 'string' ? item.item_id.trim() : '';
    if (!itemId || itemId.length > 64) {
      return { ok: false, detail: 'item_id 가 필요합니다.' };
    }
    if (ids.has(itemId)) {
      return { ok: false, detail: `중복된 item_id: ${itemId}` };
    }
    ids.add(itemId);
    const kind = item.kind;
    if (
      kind !== 'OPENING' &&
      kind !== 'SCAFFOLD' &&
      kind !== 'EQUIPMENT' &&
      kind !== 'WORK_SURFACE'
    ) {
      return { ok: false, detail: `지원하지 않는 kind: ${String(kind)}` };
    }
    const center = item.center;
    if (
      !Array.isArray(center) ||
      center.length !== 3 ||
      !center.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000)
    ) {
      return { ok: false, detail: `center 는 3 개의 유한 숫자여야 합니다: ${itemId}` };
    }
    const size = item.size;
    if (
      !Array.isArray(size) ||
      size.length !== 3 ||
      !size.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10000)
    ) {
      return { ok: false, detail: `size 는 3 개의 양수여야 합니다: ${itemId}` };
    }
    const yawRad = item.yaw_rad === undefined ? 0 : item.yaw_rad;
    if (typeof yawRad !== 'number' || !Number.isFinite(yawRad) || Math.abs(yawRad) > 3.1415927) {
      return { ok: false, detail: `yaw_rad 는 [-π, π] 범위여야 합니다: ${itemId}` };
    }
    let label: string | null = null;
    if (item.label !== undefined && item.label !== null) {
      if (typeof item.label !== 'string') {
        return { ok: false, detail: `label 형식이 올바르지 않습니다: ${itemId}` };
      }
      const trimmed = item.label.trim();
      if (trimmed.length > 100) {
        return { ok: false, detail: `label 은 100 자 이하여야 합니다: ${itemId}` };
      }
      label = trimmed.length > 0 ? trimmed : null;
    }
    items.push({
      item_id: itemId,
      kind,
      center: [center[0] as number, center[1] as number, center[2] as number],
      size: [size[0] as number, size[1] as number, size[2] as number],
      yaw_rad: yawRad,
      label,
      source_zone_id: typeof item.source_zone_id === 'string' ? item.source_zone_id : null,
    });
  }
  const revision = typeof body.revision === 'number' ? body.revision : undefined;
  return { ok: true, name, items, revision };
}

/** 처음에 있는 작업. 날짜는 오늘이라 개발 서버를 언제 열어도 오늘 작업이 있어 관제 대기 화면이 뜨지 않는다. */
const initialWorks = (date: string): TbmWorkUnit[] => [
  {
    work_id: '1',
    date,
    name: '개구부 옆 비계 설치',
    from_ms: dateHhmmToMs(date, '09:00'),
    to_ms: dateHhmmToMs(date, '12:00'),
    zone_id: 'z-04',
    place: null,
    planned_people: 4,
    lead: 'A조',
    layout_id: 101,
    work_type: 'SCAFFOLD_INSTALL',
    event_counts: { CRITICAL: 1, HIGH: 1 },
  },
  {
    work_id: '2',
    date,
    name: '자재 반입 · 정리',
    from_ms: dateHhmmToMs(date, '10:00'),
    to_ms: dateHhmmToMs(date, '11:30'),
    zone_id: 'z-02',
    place: null,
    planned_people: 3,
    lead: 'B조',
    layout_id: 102,
    work_type: 'MATERIAL_HANDLING',
    event_counts: { CRITICAL: 0, HIGH: 2 },
  },
  {
    work_id: '3',
    date,
    name: '바닥 마감',
    from_ms: dateHhmmToMs(date, '13:00'),
    to_ms: dateHhmmToMs(date, '17:00'),
    zone_id: null,
    place: '북서쪽 바닥',
    planned_people: 2,
    lead: 'A조',
    layout_id: 103,
    work_type: 'FLOOR_FINISHING',
    event_counts: { CRITICAL: 0, HIGH: 0 },
  },
];

export interface CreateTbmMockOptions {
  /**
   * true 이면 GET /api/work-units?days=... 요청을 다음 핸들러(createHistoryMock)에 넘긴다.
   */
  deferDaysToHistory?: boolean;
  /**
   * 작업 관리의 날짜 작업(createWorkMock 의 workItems). 서버는 날짜 작업도 같은 목록에 진행 값(progress)과 함께 주므로,
   * 관제가 읽는 GET /api/work-units(범위 없음)에 이 목의 작업 뒤로 이어 붙인다. 없으면 이 목의 작업만 준다.
   */
  dailyWorks?: () => readonly TbmWorkUnit[];
}

/** 서버처럼(WorkUnitRepository) 구역 작업의 place 가 비어 있으면 구역의 이름을 채워 내려 준다. */
const withZonePlace = (work: TbmWorkUnit): TbmWorkUnit =>
  work.place === null && work.zone_id !== null
    ? { ...work, place: MOCK_ZONES.find((zone) => zone.zone_id === work.zone_id)?.name ?? null }
    : work;

export function createTbmMock(options: CreateTbmMockOptions = {}) {
  const layouts: LayoutDetail[] = INITIAL_LAYOUTS.map((l) => ({
    ...l,
    items: l.items.map((i) => ({ ...i })),
  }));
  const layoutRevisions = new Map<string, LayoutRevisionRecord>();
  for (const l of layouts) {
    layoutRevisions.set(`${l.layout_id}:${l.revision}`, {
      layout_id: l.layout_id,
      revision: l.revision,
      layout_version: `lv-${l.revision}`,
      name: l.name,
      items: l.items.map((i) => ({ ...i })),
      created_at: l.updated_at ?? l.created_at ?? 1760572800000,
    });
  }
  const today = todayIsoDate();
  const works: TbmWorkUnit[] = initialWorks(today).map((w) => ({ ...w, status: 'PLANNED' }));

  let layoutZones: LayoutZonesHooks | undefined;
  let nextLayoutSeq = 104;
  const uploadedSignatures = new Map<string, Uint8Array>();

  const handlers = [
    http.post('*/api/uploads/sign', async ({ request }) => {
      const body = (await request.json()) as { purpose?: string };
      if (body.purpose !== 'REPORT_SIGNATURE') return undefined;
      const key = crypto.randomUUID();
      return HttpResponse.json({
        object_key: `signatures/${key}.png`,
        upload_url: new URL(`/mock-signature-upload/${key}`, request.url).toString(),
        headers: { 'Content-Type': 'image/png' },
      });
    }),
    http.put('*/mock-signature-upload/:key', async ({ request, params }) => {
      uploadedSignatures.set(String(params.key), new Uint8Array(await request.arrayBuffer()));
      return new HttpResponse(null, { status: 200 });
    }),
    http.get(
      '*/mock-signature-image/:key',
      ({ params }) =>
        new HttpResponse(uploadedSignatures.get(String(params.key)) ?? null, {
          headers: { 'Content-Type': 'image/png' },
        }),
    ),
    http.get('*/api/layouts', () =>
      HttpResponse.json(
        layouts.map(({ items, ...summary }) => ({
          ...summary,
          layout_version: summary.layout_version ?? `lv-${summary.revision}`,
          source: summary.source ?? 'PLANNED',
          item_count: items.length,
        })),
      ),
    ),

    http.get('*/api/layouts/:id/revisions/:revision', ({ params }) => {
      const id = Number(params.id);
      const rev = Number(params.revision);
      const record = layoutRevisions.get(`${id}:${rev}`);
      if (!record) {
        return HttpResponse.json(
          {
            status: 404,
            code: 'LAYOUT_NOT_FOUND',
            detail: `레이아웃 리비전이 없습니다: ${id}#${rev}`,
          },
          { status: 404 },
        );
      }
      return HttpResponse.json(record);
    }),

    http.get('*/api/layouts/:id', ({ params }) => {
      const id = Number(params.id);
      const layout = layouts.find((l) => l.layout_id === id);
      if (!layout) {
        return HttpResponse.json(
          { status: 404, code: 'LAYOUT_NOT_FOUND', detail: `레이아웃이 없습니다: ${id}` },
          { status: 404 },
        );
      }
      return HttpResponse.json(layout);
    }),

    http.post('*/api/layouts', async ({ request }) => {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const validated = validateLayoutPayload(body);
      if (!validated.ok) {
        return HttpResponse.json(
          { status: 400, code: 'INVALID_LAYOUT', detail: validated.detail },
          { status: 400 },
        );
      }
      const now = Date.now();
      const created: LayoutDetail = {
        layout_id: nextLayoutSeq++,
        name: validated.name,
        revision: 1,
        layout_version: 'lv-1',
        source: 'PLANNED',
        item_count: validated.items.length,
        created_at: now,
        updated_at: now,
        items: validated.items,
      };
      layouts.unshift(created);
      layoutRevisions.set(`${created.layout_id}:1`, {
        layout_id: created.layout_id,
        revision: 1,
        layout_version: 'lv-1',
        name: created.name,
        items: created.items.map((i) => ({ ...i })),
        created_at: now,
      });
      return HttpResponse.json(created, { status: 201 });
    }),

    http.put('*/api/layouts/:id', async ({ params, request }) => {
      const id = Number(params.id);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const validated = validateLayoutPayload(body);
      if (!validated.ok) {
        return HttpResponse.json(
          { status: 400, code: 'INVALID_LAYOUT', detail: validated.detail },
          { status: 400 },
        );
      }
      const idx = layouts.findIndex((l) => l.layout_id === id);
      if (idx < 0) {
        return HttpResponse.json(
          { status: 404, code: 'LAYOUT_NOT_FOUND', detail: `레이아웃이 없습니다: ${id}` },
          { status: 404 },
        );
      }
      const current = layouts[idx]!;
      if (validated.revision !== undefined && validated.revision !== current.revision) {
        return HttpResponse.json(
          {
            status: 409,
            code: 'LAYOUT_REVISION_CONFLICT',
            detail: `revision 충돌: 요청=${validated.revision}`,
          },
          { status: 409 },
        );
      }
      const nextRevision = current.revision + 1;
      const now = Date.now();
      const updated: LayoutDetail = {
        ...current,
        name: validated.name,
        revision: nextRevision,
        layout_version: `lv-${nextRevision}`,
        source: current.source ?? 'PLANNED',
        item_count: validated.items.length,
        updated_at: now,
        items: validated.items,
      };
      layouts[idx] = updated;
      const activeWork = works.find((w) => w.status === 'IN_PROGRESS' && w.layout_id === id);
      if (activeWork)
        layoutZones?.sync({ workId: activeWork.work_id, layoutId: id, items: updated.items });
      layoutRevisions.set(`${updated.layout_id}:${nextRevision}`, {
        layout_id: updated.layout_id,
        revision: nextRevision,
        layout_version: `lv-${nextRevision}`,
        name: updated.name,
        items: updated.items.map((i) => ({ ...i })),
        created_at: now,
      });
      return HttpResponse.json(updated, { status: 200 });
    }),

    http.post('*/api/work-units/:id/start', ({ params }) => {
      const work = works.find((w) => w.work_id === String(params.id));
      if (!work) return HttpResponse.json({ code: 'WORK_NOT_FOUND' }, { status: 404 });
      const active = works.find((w) => w.status === 'IN_PROGRESS');
      if (active)
        return HttpResponse.json(
          { code: 'WORK_ALREADY_IN_PROGRESS', detail: active.name },
          { status: 409 },
        );
      if (work.status !== 'PLANNED')
        return HttpResponse.json({ code: 'WORK_INVALID_STATE' }, { status: 409 });
      if (work.layout_id == null) {
        const now = Date.now();
        const layout: LayoutDetail = {
          layout_id: nextLayoutSeq++,
          name: work.name,
          revision: 1,
          layout_version: 'lv-1',
          source: 'PLANNED',
          item_count: 0,
          created_at: now,
          updated_at: now,
          items: [],
        };
        layouts.unshift(layout);
        layoutRevisions.set(`${layout.layout_id}:1`, {
          layout_id: layout.layout_id,
          revision: 1,
          layout_version: 'lv-1',
          name: layout.name,
          items: [],
          created_at: now,
        });
        work.layout_id = layout.layout_id;
      }
      const layout = layouts.find((l) => l.layout_id === work.layout_id);
      if (layout)
        layoutZones?.sync({
          workId: work.work_id,
          layoutId: layout.layout_id,
          items: layout.items,
        });
      work.status = 'IN_PROGRESS';
      work.actual_started_at = Date.now();
      return HttpResponse.json(work);
    }),
    http.post('*/api/work-units/:id/end', ({ params }) => {
      const work = works.find((w) => w.work_id === String(params.id));
      if (!work || work.status !== 'IN_PROGRESS')
        return HttpResponse.json({ code: 'WORK_INVALID_STATE' }, { status: 409 });
      layoutZones?.end(work.work_id);
      work.status = 'DONE';
      work.actual_ended_at = Date.now();
      // 이 mock 에는 보고서가 없다(작업 종료가 만드는 보고서 판은 mocks/work.ts 의 하루 작업 쪽에만 있다).
      return HttpResponse.json(
        { work_unit: work, wrap_up: { status: 'SKIPPED', report_id: null, reason: 'NO_REPORT' } },
        { status: 202 },
      );
    }),

    http.get('*/api/work-units', ({ request }) => {
      const url = new URL(request.url);
      if (options.deferDaysToHistory && url.searchParams.has('days')) {
        return undefined;
      }
      return HttpResponse.json({
        works: [...works.map(withZonePlace), ...(options.dailyWorks?.() ?? [])],
      });
    }),
  ];

  return {
    handlers,
    bindLayoutZones(hooks: LayoutZonesHooks) {
      layoutZones = hooks;
    },
    works,
    layouts,
  };
}
