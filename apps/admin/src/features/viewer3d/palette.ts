// 3D 장면 색표. WebGL 재질은 CSS 토큰을 바로 읽지 못해 장면 전용 값을 여기에만 둔다.
// 다크(청사진)·화이트(백사진) 두 벌이고 값은 관제 데모(simAI demo.html 의 C3_SET)와 같다(위험 등급 색 risk 는 예외).
// 테마를 바꾸면 장면을 다시 만들지 않고 색만 바꾼다. 빨강·주황·노랑은 위험 등급에만 쓰고(구역 윤곽선도 그 구역의
// 등급 색), 등급을 모르거나 안내인 구역은 청록, 미리보기는 보라다. risk 의 위험·경고·주의 값은 packages/ui globals.css 의
// sev-* 토큰과 같다(palette.test.ts 가 맞춰 본다).

export type ViewerTheme = 'dark' | 'light';

/** 0xRRGGBB 숫자를 CSS 색 문자열(#rrggbb)로. 이름표 글자처럼 문자열 색을 받는 곳에 쓴다. */
export const cssHex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

export type RiskColorLevel = 'CRITICAL' | 'HIGH' | 'CAUTION';

export interface ScenePalette {
  gridCenter: number;
  gridLine: number;
  floor: number;
  wall: number;
  person: { body: number; joint: number; unknown: number; selected: number };
  /** 이름표 글자(관측 상태별)와 바탕. */
  label: { observed: string; predicted: string; unknown: string; background: string };
  /** 등급을 모르거나 안내인 구역 색(color)과 미리보기 색(preview). */
  zone: { color: number; preview: number };
  /** CRITICAL 은 빨강 이중선, HIGH 는 주황, CAUTION 은 노랑. 구역 윤곽선도 이 색을 쓴다. */
  risk: Record<RiskColorLevel, { color: number }>;
  surface: { color: string; selected: string; topEdge: string };
  obstacle: { color: string; selected: string };
}

export const PALETTE: Record<ViewerTheme, ScenePalette> = {
  dark: {
    gridCenter: 0x2a3756,
    gridLine: 0x1c2742,
    floor: 0x16213a,
    wall: 0x8d99b8,
    person: { body: 0xdde3ef, joint: 0x7d89a8, unknown: 0x6b7797, selected: 0xb4c4ee },
    label: {
      observed: '#eef1f8',
      predicted: '#9ba7c5',
      unknown: '#9ba7c5',
      background: 'rgba(10, 27, 51, 0.8)',
    },
    zone: { color: 0x5fb3a8, preview: 0xc4a7ff },
    risk: {
      CRITICAL: { color: 0xff6b74 },
      HIGH: { color: 0xff8f3f },
      CAUTION: { color: 0xffd23f },
    },
    surface: { color: '#8d99b8', selected: '#b4c4ee', topEdge: '#e3e9f5' },
    obstacle: { color: '#7d89a8', selected: '#b4c4ee' },
  },
  light: {
    gridCenter: 0x9db2d0,
    gridLine: 0xcbd7e8,
    floor: 0xfbfdff,
    wall: 0x4d6489,
    person: { body: 0x8197b8, joint: 0x2b4a74, unknown: 0x8a9bb5, selected: 0x1d4f9e },
    label: {
      observed: '#0b2140',
      predicted: '#3e5677',
      unknown: '#3e5677',
      background: 'rgba(255, 255, 255, 0.92)',
    },
    zone: { color: 0x0f8a80, preview: 0x7048d8 },
    risk: {
      CRITICAL: { color: 0xc21d1d },
      HIGH: { color: 0xb54f00 },
      CAUTION: { color: 0x7a6000 },
    },
    surface: { color: '#5f7394', selected: '#1d4f9e', topEdge: '#2b4a74' },
    obstacle: { color: '#4d6489', selected: '#1d4f9e' },
  },
};
