import { YAW_LIMIT_RAD } from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import { createContext } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';

// PLANNED 가상 배치(S15P31A101-186). TBM 계획에서 쓰는 가상 개구부·고소 작업면(옛 비계·장비 포함)을 3D 에 놓고 고친다.
//
// - 배치 목록은 FE 가 가진다(계획 화면 상태·저장·평가는 FE -62·BE -30). Viewer 는 받은 목록을 PLANNED 모드에서만 그리고,
//   편집 결과를 World 값으로 돌려준다(saved: false). 받은 목록을 스스로 바꾸지 않는다.
// - LIVE World·Tier 0 판정·위험 이벤트·구역·정적 객체와 섞지 않는다. 데이터는 이 Store 에만 있고 LIVE 데이터 Store 에 넣지 않는다.
// - 형상은 World(m, +Z 위) OBB 다: center 3D 중심, size 지역 X'·Y'·높이 전체 길이(> 0), yawRad +Z 축 회전([-π, π]).
//   세 종류 모두 같은 OBB 이고 종류는 표시와 결과에만 실린다(개구부를 바닥 구멍으로 그리는 등 종류별 의미 해석은 하지 않는다).

export const PLANNED_KINDS = ['OPENING', 'WORK_SURFACE', 'SCAFFOLD', 'EQUIPMENT'] as const;
export type PlannedKind = (typeof PLANNED_KINDS)[number];

/** PLANNED 가상 객체 형상(World m·rad). 정적 객체 OBB 와 같은 모양이다. */
export interface PlannedGeometry {
  center: [number, number, number];
  size: [number, number, number];
  yawRad: number;
}

/** FE 가 넘기는 가상 객체 하나. label 은 장면 이름표에만 쓴다. */
export interface PlannedObjectInput {
  id: string;
  kind: PlannedKind;
  geometry: PlannedGeometry;
  label?: string | null;
}

/** FE 가 넘기는 가상 배치. layoutId 는 FE 계획 식별자(없으면 null)이고 결과에 그대로 돌려준다. */
export interface PlannedLayoutInput {
  layoutId?: string | null;
  objects: readonly PlannedObjectInput[];
}

export interface PlannedObjectView extends PlannedGeometry {
  id: string;
  kind: PlannedKind;
  label: string | null;
}

export interface PlannedSnapshot {
  layoutId: string | null;
  objects: readonly PlannedObjectView[];
  /** 형식이 틀리거나 ID 가 겹쳐 뺀 항목과 이유. */
  invalid: readonly { id: string | null; reason: string }[];
}

export const NO_PLANNED: PlannedSnapshot = Object.freeze({
  layoutId: null,
  objects: [],
  invalid: [],
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
const triple = (value: unknown): [number, number, number] | null =>
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
    ? [value[0] as number, value[1] as number, value[2] as number]
    : null;

export const isPlannedKind = (value: unknown): value is PlannedKind =>
  PLANNED_KINDS.some((kind) => kind === value);

/** 형상 검사. 유한수, 크기 > 0, yaw 는 [-π, π] 라디안(도 값을 걸러 낸다). 틀리면 이유. 값을 고쳐 받지 않는다. */
export function plannedGeometryProblem(geometry: unknown): string | null {
  const center = triple(field(geometry, 'center'));
  if (!center) return 'center 는 유한수 3개여야 한다';
  const size = triple(field(geometry, 'size'));
  if (!size || !size.every((v) => v > 0)) return 'size 는 양수 3개여야 한다';
  const yaw = field(geometry, 'yawRad');
  if (!isFiniteNumber(yaw) || Math.abs(yaw) > YAW_LIMIT_RAD) {
    return 'yawRad 는 [-π, π] 라디안이어야 한다';
  }
  return null;
}

/** 가상 객체 ID 검사. 빈 문자열이 아니어야 한다. */
export function plannedIdProblem(id: unknown): string | null {
  return typeof id === 'string' && id.trim() !== '' ? null : 'id 가 비었다';
}

function readObject(item: unknown): { object: PlannedObjectView } | { reason: string } {
  const id = field(item, 'id');
  const idProblem = plannedIdProblem(id);
  if (idProblem) return { reason: idProblem };
  const kind = field(item, 'kind');
  if (!isPlannedKind(kind))
    return { reason: 'kind 는 OPENING·WORK_SURFACE·SCAFFOLD·EQUIPMENT 중 하나여야 한다' };
  const geometry = field(item, 'geometry');
  const problem = plannedGeometryProblem(geometry);
  if (problem) return { reason: problem };
  const label = field(item, 'label');
  return {
    object: {
      id: id as string,
      kind,
      center: triple(field(geometry, 'center'))!,
      size: triple(field(geometry, 'size'))!,
      yawRad: field(geometry, 'yawRad') as number,
      label: typeof label === 'string' && label !== '' ? label : null,
    },
  };
}

/**
 * 가상 배치를 검사한다. 없거나 null 이면 빈 배치다. 형식이 틀린 항목은 이유와 함께 뺀다.
 * 같은 id 가 둘 이상이면 어느 쪽이 맞는지 알 수 없어 그 id 를 모두 뺀다(장면 대상은 id 하나에 하나다).
 */
export function readPlannedLayout(input: unknown): PlannedSnapshot {
  if (input === null || input === undefined) return NO_PLANNED;
  const objects = field(input, 'objects');
  const rawLayoutId = field(input, 'layoutId');
  const layoutId = typeof rawLayoutId === 'string' && rawLayoutId !== '' ? rawLayoutId : null;
  if (!Array.isArray(objects)) {
    return { layoutId, objects: [], invalid: [{ id: null, reason: 'objects 가 배열이 아니다' }] };
  }
  const count = new Map<string, number>();
  for (const item of objects) {
    const id = field(item, 'id');
    if (typeof id === 'string') count.set(id, (count.get(id) ?? 0) + 1);
  }
  const views: PlannedObjectView[] = [];
  const invalid: { id: string | null; reason: string }[] = [];
  for (const item of objects) {
    const raw = field(item, 'id');
    const id = typeof raw === 'string' ? raw : null;
    if (id !== null && count.get(id)! > 1) {
      invalid.push({ id, reason: 'id 중복' });
      continue;
    }
    const checked = readObject(item);
    if ('reason' in checked) invalid.push({ id, reason: checked.reason });
    else views.push(checked.object);
  }
  return { layoutId, objects: views, invalid };
}

/** 바깥에 넘길 평범한 형상 사본. */
export const plannedJson = (g: PlannedGeometry): PlannedGeometry => ({
  center: [g.center[0], g.center[1], g.center[2]],
  size: [g.size[0], g.size[1], g.size[2]],
  yawRad: g.yawRad,
});

export const samePlannedGeometry = (a: PlannedGeometry, b: PlannedGeometry, epsilon = 1e-9) => {
  const near = (x: number, y: number) => Math.abs(x - y) <= epsilon;
  return (
    a.center.every((v, i) => near(v, b.center[i]!)) &&
    a.size.every((v, i) => near(v, b.size[i]!)) &&
    near(a.yawRad, b.yawRad)
  );
};

// ---- Store: 뷰어 인스턴스마다 하나. 입력(FE 배치)만 두고 LIVE 데이터 Store 와 따로 둔다 ----

export interface PlannedState {
  input: PlannedLayoutInput | null;
  snapshot: PlannedSnapshot;
  setInput(input: PlannedLayoutInput | null | undefined): void;
}

export type PlannedStore = StoreApi<PlannedState>;

export function createPlannedStore(): PlannedStore {
  return createStore<PlannedState>()((set, get) => ({
    input: null,
    snapshot: NO_PLANNED,
    setInput: (input) => {
      const next = input ?? null;
      if (get().input === next) return;
      set({ input: next, snapshot: readPlannedLayout(next) });
    },
  }));
}

export const PlannedStoreContext = createContext<PlannedStore | null>(null);
