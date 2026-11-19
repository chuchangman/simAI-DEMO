// 개발 보기 프리셋. FE 임시 목업과 Spatial 진단 도구 중 무엇을 화면에 띄울지만 고른다.
// 뷰어 업무 모드(LIVE·PLANNED·REPLAY), 선택, 시점, Canvas 와는 무관하다. 보기를 바꿔도 이것들은 그대로다.

export const DEV_VIEWS = [
  { key: '3d', label: '3D만 보기', hint: '3D 장면만', mockUi: false, spatial: false },
  {
    key: 'mock',
    label: 'FE 목업 검증',
    hint: '상단·하단 메뉴·업무 패널',
    mockUi: true,
    spatial: false,
  },
  {
    key: 'world',
    label: 'Spatial 정합 검증',
    hint: 'World 기준점·진단',
    mockUi: false,
    spatial: true,
  },
  {
    key: 'combined',
    label: '통합 검증',
    hint: 'FE 목업 + Spatial 진단',
    mockUi: true,
    spatial: true,
  },
] as const;

export type DevView = (typeof DEV_VIEWS)[number];
export type DevViewKey = DevView['key'];

const VIEW_PARAM = 'view';
// 예전 주소 플래그. 보기를 바꾸면 지워서 다시 살아나지 않게 한다.
const LEGACY_PARAMS = ['mockUi', 'worldDebug', 'debug'];

const isDevViewKey = (value: string): value is DevViewKey => DEV_VIEWS.some((v) => v.key === value);

export function devViewOf(key: DevViewKey): DevView {
  return DEV_VIEWS.find((v) => v.key === key)!;
}

/**
 * 주소에서 보기를 고른다.
 * 1. view=3d|mock|world|combined 가 있으면 그것이 우선이다(대소문자 무시).
 * 2. view 가 없거나 모르는 값이면 예전 플래그로 정한다.
 *    - FE 목업: mockUi 가 0·false·off 일 때만 끈다. 없으면 켠다.
 *    - Spatial 진단: worldDebug=1 또는 debug=1 이면 켠다.
 *    예) mockUi=1&worldDebug=1&debug=1 → 통합, mockUi=0&worldDebug=1&debug=1 → Spatial 정합,
 *        mockUi=1·주소 없음 → FE 목업, mockUi=0 → 3D만, debug=1 단독 → 통합, mockUi=0&debug=1 → Spatial 정합.
 */
export function readDevView(search: string): DevViewKey {
  const params = new URLSearchParams(search);
  const view = params.get(VIEW_PARAM)?.toLowerCase();
  if (view && isDevViewKey(view)) return view;

  const mockValue = params.get('mockUi');
  const mockUi = mockValue === null || !['0', 'false', 'off'].includes(mockValue.toLowerCase());
  const spatial = params.get('worldDebug') === '1' || params.get('debug') === '1';
  return DEV_VIEWS.find((v) => v.mockUi === mockUi && v.spatial === spatial)!.key;
}

/** 처음 열 때 Spatial 진단을 펼칠지. FE 가 없는 Spatial 정합 보기이거나 예전 debug=1 주소면 펼친다. */
export function readDiagnosticsOpen(search: string): boolean {
  return readDevView(search) === 'world' || new URLSearchParams(search).get('debug') === '1';
}

/** view 만 남기고 예전 플래그는 지운 주소. 다른 매개변수와 해시는 그대로 둔다. */
export function withDevView(href: string, key: DevViewKey): string {
  const url = new URL(href);
  for (const name of LEGACY_PARAMS) url.searchParams.delete(name);
  url.searchParams.set(VIEW_PARAM, key);
  return url.toString();
}
