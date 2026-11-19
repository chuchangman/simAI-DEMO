// 레이어 표시·피킹 코어(S15P31A101-234). 데이터 보유(Source·Store)와 화면별 표시를 나눈다.
// FE 는 데이터를 화면 수명과 상관없이 넘기고, 화면마다 어떤 레이어를 보이고 고르게 할지만 이 값으로 정한다.
// 화면별 값(관제·구역·작업면)은 FE 가 정한다. 여기에는 값의 의미와 기본값만 둔다(기본값 = 기존 동작).
//
// hidden      그리지 않는다. 장면 대상에서도 내려가 선택·초점·편집이 안 된다(선택돼 있었으면 풀린다).
// visible     그리지만 클릭을 받지 않는다(광선이 지나간다). 명령(select·focus)으로는 고를 수 있고 편집은 안 된다.
// interactive 그리고 클릭·선택·편집을 받는다.
//
// 사람(관측)과 위험 강조는 레이어로 끄지 않는다. 피킹 순서는 바꾸지 않는다: 광선의 가까운 대상부터,
// 투명 구역·작업면·장애물은 광선 위 사람을 먼저 고른다(personOnRay). 우선순위 정책 변경은 FE 합의 뒤에 한다.

export const VIEWER_LAYER_KEYS = ['zones', 'workSurfaces', 'obstacles'] as const;
export type ViewerLayerKey = (typeof VIEWER_LAYER_KEYS)[number];

export const VIEWER_LAYER_MODES = ['hidden', 'visible', 'interactive'] as const;
export type ViewerLayerMode = (typeof VIEWER_LAYER_MODES)[number];

/** 바꿀 레이어만 적는다. 적지 않은 레이어는 interactive(기존 동작)다. */
export type ViewerLayers = Partial<Record<ViewerLayerKey, ViewerLayerMode>>;
export type ResolvedLayers = Readonly<Record<ViewerLayerKey, ViewerLayerMode>>;

export const DEFAULT_LAYERS: ResolvedLayers = Object.freeze({
  zones: 'interactive',
  workSurfaces: 'interactive',
  obstacles: 'interactive',
});

const isMode = (value: unknown): value is ViewerLayerMode =>
  VIEWER_LAYER_MODES.some((mode) => mode === value);

/** 입력을 레이어 값으로 정리한다. 모르는 레이어·값은 무시하고 기본값을 쓴다(예외를 던지지 않는다). */
export function resolveLayers(input: unknown): ResolvedLayers {
  if (typeof input !== 'object' || input === null) return DEFAULT_LAYERS;
  const out = { ...DEFAULT_LAYERS };
  for (const key of VIEWER_LAYER_KEYS) {
    const value: unknown = Reflect.get(input, key);
    if (isMode(value)) out[key] = value;
  }
  return VIEWER_LAYER_KEYS.every((key) => out[key] === DEFAULT_LAYERS[key])
    ? DEFAULT_LAYERS
    : Object.freeze(out);
}

export const sameLayers = (a: ResolvedLayers, b: ResolvedLayers) =>
  VIEWER_LAYER_KEYS.every((key) => a[key] === b[key]);
