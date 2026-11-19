import type { Severity } from '@/features/events/types';

// 레이아웃 · TBM 보고서의 데모 대체 자료. API 요청 실패(네트워크 끊김·5xx) 때만 대체 화면으로 쓴다.
// 좌표는 World(m, 바닥 x·y)다. 화면에는 2D 평면 변환(toPlan)으로 그린다.

/** 바닥 위 직사각형(m). x·y 는 작은 쪽 모서리다. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 가상 레이아웃의 배치 항목. 동선(path)은 꺾은선과 폭으로, 나머지는 직사각형으로 둔다. */
export type LayoutItem =
  | ({ kind: 'scaffold' | 'parking' | 'area'; label: string; hgt?: number } & Rect)
  | { kind: 'path'; label: string; w: number; pts: readonly (readonly [number, number])[] };

/** 계획 모드 평가 한 줄: 항목 · 규칙 · 등급 · 근거. */
export interface TaskEval {
  item: string;
  rule: string;
  sev: Severity;
  why: string;
}

/** 작업 하나: 작업명 · 시간대 · 구역 · 인원 · 반장 · 장비 · 가상 레이아웃. */
export interface TbmTask {
  id: string;
  /** 서버 work_unit.work_id (데모 대체 화면에서는 없다). */
  workId?: string;
  status?: 'PLANNED' | 'IN_PROGRESS' | 'DONE';
  actualStartedAt?: string | number | null;
  actualEndedAt?: string | number | null;
  /** 서버 work_unit.active_setup_session_id (세팅 전이면 null). */
  activeSetupSessionId?: string | null;
  /** 작업 날짜(YYYY-MM-DD). */
  date?: string;
  /** 작업 중 사건 수(서버 work_unit.event_counts: 위험 · 경고). 모르면 없다. */
  eventCounts?: { CRITICAL?: number; HIGH?: number } | null;
  name: string;
  from: string;
  to: string;
  /** 구역 작업의 구역 ID. 구역 없는 작업이면 null. */
  zone: string | null;
  /** 화면에 보일 장소: 구역 작업은 구역 이름, 구역 없는 작업은 적은 장소 또는 '현장 전체'. */
  area?: string;
  people: number;
  lead: string;
  gear: string;
  /** 연결된 가상 레이아웃 ID (layout_plan.layout_id). */
  layoutId?: number | null;
  /** 공종 코드 (work_type). */
  workType?: string | null;
  items: readonly LayoutItem[];
  evals: readonly TaskEval[];
  measures: readonly string[];
}

interface TbmZone extends Rect {
  id: string;
  name: string;
}

export const TBM_DATE = '2026년 10월 16일';

/** 작업 구역. 관제 mock 구역(z-04 · z-02)과 같은 자리다. */
export const TBM_ZONES: readonly TbmZone[] = [
  { id: 'z-04', name: '개구부 구역', x: 5.8, y: 1.2, w: 2.8, h: 2.6 },
  { id: 'z-02', name: '단상 구역', x: 1, y: 6.2, w: 3, h: 2.2 },
];

export const TBM_OPENING: Rect = { x: 7.2, y: 1.2, w: 1.2, h: 0.6 };
export const TBM_DOOR: Rect = { x: 4.4, y: -0.14, w: 0.9, h: 0.28 };

export const TBM_TASKS: readonly TbmTask[] = [
  {
    id: 'T1',
    name: '개구부 옆 비계 설치',
    from: '09:00',
    to: '12:00',
    zone: 'z-04',
    area: '개구부 구역',
    people: 4,
    lead: 'A조',
    gear: '장비 없음',
    layoutId: 1,
    workType: 'OPENING_WORK',
    items: [{ kind: 'scaffold', label: '비계 S1', hgt: 2.4, x: 5.6, y: 1.2, w: 1.0, h: 2.4 }],
    evals: [
      { item: '비계 S1 ↔ 개구부', rule: 'R2', sev: 'CRITICAL', why: '수평 0.6m · 높이 차 2.1m' },
      { item: '비계 S1 상부', rule: 'R3', sev: 'HIGH', why: '작업면 2.4m · 난간 없음' },
    ],
    measures: ['개구부 덮개와 안전 난간을 비계보다 먼저 설치', '비계 위 작업 전 안전대 체결 확인'],
  },
  {
    id: 'T2',
    name: '자재 반입 · 정리',
    from: '10:00',
    to: '11:30',
    zone: 'z-02',
    area: '단상 구역',
    people: 3,
    lead: 'B조',
    gear: '지게차 1',
    layoutId: 2,
    workType: 'MATERIAL_HANDLING',
    items: [
      { kind: 'parking', label: '장비 주차 P1', x: 6.6, y: 6.6, w: 2.6, h: 2.6 },
      {
        kind: 'path',
        label: '지게차 동선',
        w: 0.9,
        pts: [
          [4.85, 0.2],
          [4.85, 3.0],
          [7.6, 3.0],
          [7.6, 6.6],
        ],
      },
    ],
    evals: [
      {
        item: '지게차 동선 ↔ z-04',
        rule: 'R1',
        sev: 'HIGH',
        why: '동선이 위험 구역을 2.8m 가로지름',
      },
      { item: '통로 ↔ 장비 P1', rule: 'R1', sev: 'HIGH', why: '통로 폭 0.9m 겹침' },
    ],
    measures: ['반입 경로에 유도자 1명 배치', '장비 주차 P1에 표지와 차단봉 설치'],
  },
  {
    id: 'T3',
    name: '바닥 마감',
    from: '13:00',
    to: '17:00',
    zone: null,
    area: '북서쪽 바닥',
    people: 2,
    lead: 'A조',
    gear: '장비 없음',
    layoutId: 3,
    workType: 'FLOOR_FINISHING',
    items: [{ kind: 'area', label: '마감 구역 M1', x: 0.6, y: 0.6, w: 3.6, h: 4.4 }],
    evals: [
      {
        item: '마감 구역 M1 ↔ 출입 동선',
        rule: 'R1',
        sev: 'CAUTION',
        why: '젖은 바닥 · 출입문에서 0.2m',
      },
    ],
    measures: ['출입문 쪽 우회 동선 표시', '미끄럼 주의 표지 설치'],
  },
];
