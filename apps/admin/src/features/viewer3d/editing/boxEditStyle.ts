import {
  arrowAxis,
  arrowSign,
  AXIS_DIRECTION_THREE,
  BOX_EDIT_ARROWS,
  type BoxEditArrow,
} from '@/features/viewer3d/editing/boxEdit';
import type { ViewerTheme } from '@/features/viewer3d/palette';
import { boxEdges } from '@/features/viewer3d/zones/zoneGeometry';
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';

// 제어형 상자 편집 조작기(BoxEditGizmo)의 모양 값: 색·형상·불투명도·그리기 순서. 값은 관제 데모와 같다.

/** 클릭을 받지 않는 형상에 넘기는 raycast. */
export const noRaycast = () => null;

/** 손잡이를 화면에서 늘 같은 크기로 보이게 하는 배율(카메라 거리 × K). 손잡이 형상은 길이 1 짜리다. */
export const GIZMO_K = 0.08;
/** 호버·끄는 중인 손잡이를 키우는 배율. */
export const HOVER_SCALE = 1.12;

/** 상자 미리보기(5)보다 커야 상자에 가려지지 않는다. 가운데 구·링이 화살표 위에 온다. */
export const PREVIEW_ORDER = 5;
export const ARROW_ORDER = 22;
export const MOVE_ORDER = 23;

/** 상자 미리보기: 면 불투명도와 윤곽선 두께. */
export const PREVIEW_FILL_OPACITY = 0.12;
export const PREVIEW_LINE_WIDTH = 2;
/** 보관된 초안(ghost)의 점선 윤곽: 두께·점선 길이·간격(m)·불투명도. */
export const GHOST_LINE = {
  lineWidth: 1,
  dashSize: 0.12,
  gapSize: 0.08,
  opacity: 0.85,
} as const;

/** 도드라지게 그리는 초안(highlight): 위험 등급색 면 불투명도와 실선 윤곽 두께. */
export const HIGHLIGHT_FILL_OPACITY = 0.22;
export const HIGHLIGHT_LINE_WIDTH = 3;

/** 손잡이 평소 불투명도: 가운데 링 · 가운데 구 · 화살표. */
export const RING_OPACITY = 0.85;
export const DOT_OPACITY = 1;
export const ARROW_OPACITY = 0.92;
/** 다른 손잡이를 끄는 동안 평소 불투명도에 곱하는 값. */
const FADED_FACTOR = 0.35;

/** 평소 불투명도(base), 호버·끄는 중은 1, 다른 손잡이를 끄는 동안은 base × FADED_FACTOR. */
export function handleOpacity(base: number, on: boolean, faded: boolean) {
  if (on) return 1;
  return faded ? base * FADED_FACTOR : base;
}

/** 손잡이 색(데모 C3_SET.handle). 화살표는 그 축 색, move 는 주황 구, ring 은 가운데 링. 장면 색표(palette)에 없는 값이다. */
export const HANDLE_COLORS = {
  dark: { move: '#ff9a2e', ring: '#f1f4fa', x: '#ef6f6f', y: '#6cc070', z: '#5b9cf0' },
  light: { move: '#e07000', ring: '#44506a', x: '#d64545', y: '#2f9a4a', z: '#2b6fd6' },
} as const;
export type HandleColorKey = keyof (typeof HANDLE_COLORS)['dark'];

/** 호버 색: 다크는 흰색 쪽으로 40%, 라이트는 짙은 남색 쪽으로 18% 섞는다. */
const WHITE = new Color(0xffffff);
const INK = new Color(0x0b1730);
const HOVER_MIX_DARK = 0.4;
const HOVER_MIX_LIGHT = 0.18;

const tints = new Map<string, Color>();

/** 손잡이 색(Color). 테마·색·호버마다 하나씩 만들어 돌려 쓴다. 읽기 전용이며 재질 prop 으로 넘기면 복사된다. */
export function handleTint(theme: ViewerTheme, key: HandleColorKey, on: boolean): Color {
  const id = `${theme}:${key}:${on}`;
  let color = tints.get(id);
  if (!color) {
    color = new Color(HANDLE_COLORS[theme][key]);
    if (on) {
      if (theme === 'dark') color.lerp(WHITE, HOVER_MIX_DARK);
      else color.lerp(INK, HOVER_MIX_LIGHT);
    }
    tints.set(id, color);
  }
  return color;
}

// 형상은 모듈에 하나씩만 둔다. 화살표는 +Y 방향 길이 1(0.26~1.0)이고 배치할 때 축 방향으로 돌린다.
// 각 생성자의 마지막 인자들은 둘레·높이 분할 수다.
/** 화살표 몸통(0.26~0.78): 반지름 · 길이 · 중심 높이. */
const SHAFT_RADIUS = 0.02;
const SHAFT_LENGTH = 0.52;
const SHAFT_CENTER_Y = 0.52;
/** 화살촉(0.78~1.0): 반지름 · 길이 · 중심 높이. */
const HEAD_RADIUS = 0.075;
const HEAD_LENGTH = 0.22;
const HEAD_CENTER_Y = 0.89;
/** 가운데 링 안·바깥 반지름, 가운데 구 반지름. */
const RING_INNER_RADIUS = 0.26;
const RING_OUTER_RADIUS = 0.32;
const DOT_RADIUS = 0.11;
export const SHAFT = new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 8).translate(
  0,
  SHAFT_CENTER_Y,
  0,
);
export const HEAD = new ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 16).translate(0, HEAD_CENTER_Y, 0);
export const RING = new RingGeometry(RING_INNER_RADIUS, RING_OUTER_RADIUS, 40);
export const DOT = new SphereGeometry(DOT_RADIUS, 16, 12);

// 보이지 않는 판정 형상. 화살표 판정은 가운데(0.64)에 놓아 createHandleRaycast 의 화면 ±12px 보정이 화살표 몸통 위에 오게 한다.
const PICK_DOT_RADIUS = 0.36;
const PICK_AXIS_RADIUS = 0.1;
const PICK_AXIS_LENGTH = 0.8;
export const PICK_DOT = new SphereGeometry(PICK_DOT_RADIUS, 12, 8);
export const PICK_AXIS = new CylinderGeometry(
  PICK_AXIS_RADIUS,
  PICK_AXIS_RADIUS,
  PICK_AXIS_LENGTH,
  8,
);
export const PICK_AXIS_OFFSET = 0.64;

/** 한 변이 1 인 상자의 윤곽선(실제 크기는 scale 로 준다). */
export const UNIT_EDGES = boxEdges([1, 1, 1]);

const UP = new Vector3(0, 1, 0);
/** 화살표를 +Y 에서 그 축 방향(Three)으로 돌리는 값. */
export const ARROW_QUATERNION = Object.fromEntries(
  BOX_EDIT_ARROWS.map((arrow) => {
    const direction = AXIS_DIRECTION_THREE[arrowAxis(arrow)];
    const sign = arrowSign(arrow);
    return [
      arrow,
      new Quaternion().setFromUnitVectors(
        UP,
        new Vector3(direction[0] * sign, direction[1] * sign, direction[2] * sign),
      ),
    ];
  }),
) as Record<BoxEditArrow, Quaternion>;
