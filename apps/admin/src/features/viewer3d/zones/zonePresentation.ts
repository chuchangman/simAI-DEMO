import type { ZoneSeverity, ZoneView } from '@/features/viewer3d/data/spatialFrame';
import { PALETTE, type ScenePalette } from '@/features/viewer3d/palette';
import { targetKey } from '@/features/viewer3d/target';
import type { ViewerTarget } from '@/features/viewer3d/types';
import { zoneDisplayName } from '@/lib/zoneName';
import { createContext } from 'react';

// 구역 표시 규칙. 색·투명도·선 모양·이름표 문구를 한 곳에서 정한다. -185 위험 강조는 이 값을 바꾸지 않고 따로 얹는다.

/**
 * 구역을 어떤 적용 상태로 보일지.
 * - UNVERIFIED: 형상만 받았다. 기본값이다. ZoneSnapshot READY(형상 수신·검사 성공)나 viewer_health 의
 *   config.sync 만으로는 이 구역이 Tier 0 에 적용됐다고 보지 않는다.
 * - DEMO_PREVIEW / DEMO_ASSUMED_APPLIED: 개발 화면에서 표시 차이를 시험하는 값이다. 실제 저장·적용 성공이 아니다.
 * 구성 버전과 config_ack 를 BE·FE 가 검증해 넘기는 계약(BE -120·FE -189)이 정해지면, 그 증거로만 고르는 적용 상태를 여기에 더한다.
 */
export const ZONE_APPLY_STATES = ['UNVERIFIED', 'DEMO_PREVIEW', 'DEMO_ASSUMED_APPLIED'] as const;
export type ZoneApplyState = (typeof ZONE_APPLY_STATES)[number];

export const ZoneApplyContext = createContext<ZoneApplyState>('UNVERIFIED');

export interface ZoneStyle {
  color: number;
  fillOpacity: number;
  edgeOpacity: number;
  /** 배경(스캔 바닥·책상·벽)에 가려진 윤곽선 부분을 덧그리는 불투명도. 가려져도 윤곽이 이어지게 흐리게 보인다. */
  hiddenEdgeOpacity: number;
  /** 점선이면 적용이 확인되지 않은 구역이다. */
  dashed: boolean;
  dashSize: number;
  gapSize: number;
  stateLabel: string;
}

/**
 * 세팅에서 사람이 아직 확인하지 않은 이어 쓴 구역(S15P31A101-629): 같은 심각도 색을 옅은 채움·흐린 촘촘한 점선으로 그려
 * 확인한 구역(적용 상태 모양)과 구별한다. 선택하면 선은 짙어진다.
 */
const NEEDS_REVIEW_LOOK = {
  fillScale: 0.35,
  edgeOpacity: 0.5,
  dashSize: 0.06,
  gapSize: 0.14,
  stateLabel: '확인 필요',
} as const;

/** 선택하면 채움이 이만큼 짙어진다. */
const SELECTED_FILL_BOOST = 0.1;
/** 가려진 부분의 선 불투명도는 보이는 선의 이 비율이다. */
const HIDDEN_EDGE_RATIO = 0.35;

// 구역 색은 그 구역의 심각도 색(위험 빨강·경고 주황·주의 노랑)이다. 심각도를 모르거나 안내면 청록, 미리보기는 보라다
// (장면 색표 palette). 아래 표는 적용 상태로 정하는 투명도·선 모양이고, 색은 zoneStyle 이 색표에서 고른다.
const STYLES: Record<ZoneApplyState, Omit<ZoneStyle, 'color' | 'hiddenEdgeOpacity'>> = {
  UNVERIFIED: {
    fillOpacity: 0.08,
    edgeOpacity: 0.85,
    dashed: true,
    dashSize: 0.25,
    gapSize: 0.12,
    stateLabel: '적용 미확인',
  },
  DEMO_PREVIEW: {
    fillOpacity: 0.05,
    edgeOpacity: 0.9,
    dashed: true,
    dashSize: 0.08,
    gapSize: 0.08,
    stateLabel: '미리보기(DEMO)',
  },
  DEMO_ASSUMED_APPLIED: {
    fillOpacity: 0.16,
    edgeOpacity: 1,
    dashed: false,
    dashSize: 0,
    gapSize: 0,
    stateLabel: '적용 가정(DEMO·미확인)',
  },
};

/** 구역 심각도. 정식 구역은 official 이, DEMO 구역은 알려 준 값이다. 모르면 없다. */
export const zoneSeverity = (zone: Pick<ZoneView, 'official' | 'severity'>) =>
  zone.official?.severity ?? zone.severity;

function zoneColor(
  state: ZoneApplyState,
  palette: ScenePalette,
  severity: ZoneSeverity | undefined,
): number {
  if (state === 'DEMO_PREVIEW') return palette.zone.preview;
  return severity && severity !== 'INFO' ? palette.risk[severity].color : palette.zone.color;
}

/**
 * 적용 상태·선택 여부·심각도에 따른 모양. 색은 심각도가 정하고, 선택은 색을 바꾸지 않고 채움과 선을 짙게 한다.
 * 선 모양(점선)은 적용 상태가 정한다.
 */
export function zoneStyle(
  state: ZoneApplyState,
  selected: boolean,
  palette: ScenePalette = PALETTE.dark,
  severity?: ZoneSeverity,
  needsReview = false,
): ZoneStyle {
  const base = needsReview
    ? {
        ...STYLES[state],
        fillOpacity: STYLES[state].fillOpacity * NEEDS_REVIEW_LOOK.fillScale,
        edgeOpacity: NEEDS_REVIEW_LOOK.edgeOpacity,
        dashed: true,
        dashSize: NEEDS_REVIEW_LOOK.dashSize,
        gapSize: NEEDS_REVIEW_LOOK.gapSize,
        stateLabel: NEEDS_REVIEW_LOOK.stateLabel,
      }
    : STYLES[state];
  const edgeOpacity = selected ? 1 : base.edgeOpacity;
  return {
    ...base,
    color: zoneColor(state, palette, severity),
    fillOpacity: selected ? base.fillOpacity + SELECTED_FILL_BOOST : base.fillOpacity,
    edgeOpacity,
    hiddenEdgeOpacity: edgeOpacity * HIDDEN_EDGE_RATIO,
  };
}

const meters = (value: number) => `${Math.round(value * 100) / 100}`;

/** 적용 상태의 화면 문구. */
export const zoneStateLabel = (state: ZoneApplyState) => STYLES[state].stateLabel;

/** 높이 범위(World Z) 문구. 예: `Z 1.2–2.4m`. */
export const zoneHeightText = (zone: Pick<ZoneView, 'min' | 'max'>) =>
  `Z ${meters(zone.min[2])}–${meters(zone.max[2])}m`;

/** 장면 이름표. 구역 이름만 적고, 위험은 색으로만 보인다. 세팅에서 확인 전인 구역은 '확인 필요'를 붙인다. */
export const zoneLabel = (zone: Pick<ZoneView, 'name' | 'needsReview'>) =>
  zone.needsReview
    ? `${zoneDisplayName(zone.name)} · ${NEEDS_REVIEW_LOOK.stateLabel}`
    : zoneDisplayName(zone.name);

const PERSON_PREFIX = targetKey({ type: 'person', id: '' });

/**
 * 클릭 광선에 걸린 가장 가까운 사람. 투명 구역은 이 사람을 대신 고른다(사람 > 구역).
 * 구역 안이나 뒤를 지나는 사람을 언제든 고를 수 있게 한다. 사람이 버튼을 누른 뒤 떼기 전에 광선 안으로
 * 걸어 들어와도 사람의 클릭 처리기는 R3F 규칙상 불리지 않으므로, 넘기지 않고 구역 처리기가 직접 고른다.
 */
export function personOnRay(
  intersections: readonly { eventObject: { name: string } }[],
): ViewerTarget | null {
  const hit = intersections.find((h) => h.eventObject.name.startsWith(PERSON_PREFIX));
  return hit ? { type: 'person', id: hit.eventObject.name.slice(PERSON_PREFIX.length) } : null;
}

/** 편집 미리보기 이름표. 구역 이름에 저장되지 않은 미리보기임을 함께 적는다. */
export const previewLabel = (zone: Pick<ZoneView, 'name'>) => `${zoneLabel(zone)} · 미저장`;
