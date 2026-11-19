import type { ViewerTarget } from '@/features/viewer3d/types';
import {
  worldBoxToThree,
  worldPoint,
  worldToThree,
  type ThreeBox,
  type ThreePoint,
} from '@/features/viewer3d/worldCoordinates';

// 목업 전용 값. 실제 관측·판정이 아니다. 배치는 DEMO 10×10m 교실(WorldScene DEMO_ROOM)의 World 좌표다.

export const MENUS = [
  { key: 'monitor', label: '실시간 관제' },
  { key: 'cctv', label: 'CCTV 관제' },
  { key: 'zones', label: '구역 편집' },
  { key: 'tbm', label: 'TBM 보고서' },
  { key: 'system', label: '시스템 상태' },
] as const;

export type MenuKey = (typeof MENUS)[number]['key'];

/** 사람·상자의 x·y 는 World 미터(Z-up)다. 장면에는 worldToThree 로만 옮긴다. */
export interface FixturePerson {
  id: string;
  name: string;
  x: number;
  y: number;
}

/** World 축 정렬 상자. x·y 는 바닥 중심, sizeX·sizeY·height 는 World 길이(m). 바닥 Z=0 에 놓인다. */
export interface FixtureBox {
  id: string;
  name: string;
  x: number;
  y: number;
  sizeX: number;
  sizeY: number;
  height: number;
}

export interface FixtureZone extends FixtureBox {
  tone: 'critical' | 'caution';
}

// DEMO 교실 안의 예시 배치(World m). 실측·캘리브레이션 결과가 아니다.
export const PEOPLE: FixturePerson[] = [
  { id: 'worker1', name: '예시 작업자 1', x: 2.4, y: 7.2 },
  { id: 'worker2', name: '예시 작업자 2', x: 6.2, y: 4.4 },
  { id: 'worker3', name: '예시 작업자 3', x: 7.8, y: 2.6 },
];

/** 입력 없음(source=off)에서만 그리는 예전 고정 구역. Provider 구역(z-01 등)과 함께 그리지 않는다. */
export const ZONES: FixtureZone[] = [
  {
    id: 'zoneA',
    name: '레거시 예시 구역 A',
    x: 2,
    y: 8,
    sizeX: 3,
    sizeY: 2.4,
    height: 2,
    tone: 'critical',
  },
  {
    id: 'zoneB',
    name: '레거시 예시 구역 B',
    x: 8,
    y: 2,
    sizeX: 2.6,
    sizeY: 2,
    height: 1.4,
    tone: 'caution',
  },
];

export const OBJECTS: FixtureBox[] = [
  { id: 'surface1', name: '예시 작업면', x: 5.4, y: 8.6, sizeX: 2.2, sizeY: 0.9, height: 0.8 },
];

// 교실 네 모서리 위 2.6m(World).
export const CAMERAS = [
  { id: 'cam_A', x: 0, y: 10, z: 2.6 },
  { id: 'cam_B', x: 10, y: 10, z: 2.6 },
  { id: 'cam_C', x: 0, y: 0, z: 2.6 },
  { id: 'cam_D', x: 10, y: 0, z: 2.6 },
];

export interface FixtureEvent {
  id: string;
  /** 계약 등급 그대로(CRITICAL·HIGH·CAUTION·INFO). 목록에서 다른 등급으로 줄이지 않는다. */
  severity: 'CRITICAL' | 'HIGH' | 'CAUTION' | 'INFO';
  title: string;
  target: ViewerTarget;
}

export const EVENTS: FixtureEvent[] = [
  {
    id: 'event1',
    severity: 'HIGH',
    title: '구역 진입 예시',
    target: { type: 'person', id: 'worker1' },
  },
  {
    id: 'event2',
    severity: 'CAUTION',
    title: '진입 예측 예시',
    target: { type: 'person', id: 'worker3' },
  },
];

/** 선택 대상의 표시 이름. 목업 목록에 없으면 null. */
export function fixtureName(target: ViewerTarget): string | null {
  const list = target.type === 'person' ? PEOPLE : target.type === 'zone' ? ZONES : OBJECTS;
  return list.find((item) => item.id === target.id)?.name ?? null;
}

/**
 * 화면에 쓸 이름. Provider 의 사람(World ID)은 목업 목록에 없어 ID 로 부른다.
 * object 대상은 작업면(-188)과 정적 객체(-274)가 함께 쓰므로 둘을 묶어 '등록 객체'로 부른다.
 */
export function displayName(target: ViewerTarget): string | null {
  const fallback = { person: '작업자', zone: '구역', object: '등록 객체', planned: '가상 객체' }[
    target.type
  ];
  return fixtureName(target) ?? (fallback ? `${fallback} ${target.id}` : null);
}

export interface ZoneRow {
  id: string;
  name: string;
  /** 높이 범위(World Z) 문구. */
  height: string;
  /** 입력 없음의 예전 고정 구역이면 true. 적용 상태를 표시하지 않는다. */
  legacy: boolean;
}

/** 업무 패널의 추적 인원·이벤트·구역 목록. 입력이 있으면 Provider, 입력 없음이면 예전 고정 목록이다. */
export interface Roster {
  people: { id: string; name: string }[];
  events: FixtureEvent[];
  zones: ZoneRow[];
  /** 구역 입력 상태 한 줄. */
  zoneNote: string;
  /** 형상 검사에서 뺀 구역과 이유. */
  rejectedZones: { id: string | null; reason: string }[];
  /** 등록 작업면(-188). 입력이 있으면 Provider 의 작업면 OBB, 입력 없음이면 예전 고정 예시다. */
  surfaces: { id: string; name: string; detail: string }[];
  /** 작업면 입력 상태 한 줄. */
  surfaceNote: string;
}

export const LEGACY_ROSTER: Roster = {
  people: PEOPLE.map(({ id, name }) => ({ id, name })),
  events: EVENTS,
  zones: ZONES.map(({ id, name, height }) => ({
    id,
    name,
    height: `Z 0–${height}m`,
    legacy: true,
  })),
  zoneNote: '입력 없음 · 레거시 고정 예시 구역',
  rejectedZones: [],
  surfaces: OBJECTS.map(({ id, name }) => ({ id, name, detail: '작업면' })),
  surfaceNote: '입력 없음 · 레거시 고정 예시 작업면',
};

/** 예시 작업자는 바닥(World Z=0)에 선 것으로 둔다. 발 위치의 Three 좌표. */
export function fixtureFeet(person: FixturePerson): ThreePoint {
  return worldToThree(worldPoint(person.x, person.y, 0));
}

/** 바닥에 놓인 예시 상자(구역·작업면)의 Three 상자. */
export function fixtureBox(box: FixtureBox): ThreeBox {
  const halfX = box.sizeX / 2;
  const halfY = box.sizeY / 2;
  const result = worldBoxToThree(
    worldPoint(box.x - halfX, box.y - halfY, 0),
    worldPoint(box.x + halfX, box.y + halfY, box.height),
  );
  if (!result) throw new RangeError(`예시 상자 크기가 음수다: ${box.id}`);
  return result;
}
