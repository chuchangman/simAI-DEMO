import { draftZoneFootprint } from '@/features/setup/draftZone';
import { boxOfDraftItem, draftGhostId } from '@/features/setup/setup';
import {
  setupZoneDraftsResponseSchema,
  type SetupZoneDraftsResponse,
  type ZoneDraftItem,
} from '@/features/setup/types';
import type { ViewerBoxGhost, ViewerEditBox } from '@/features/viewer3d';
import { SURFACE_ZONE_MARGIN_M } from '@/features/zones/zoneShape';
import { useEffect, useMemo, useReducer } from 'react';

// 시연 계정(features/demo/demoAccount)의 세팅 구역 단계 「AI 위험 구역 초안」. 서버 초안 대신 정해 둔 개구부 하나를 보인다.
// 자리는 시연 맵(assets 의 GLB)에 지금 놓인 「단상 개구부」 구역(바닥 x 5.2~7.6 m, y 2.25~4.55 m, 높이 0~1.4 m)이다.
// 초안을 수락하면 다각형을 SURFACE_ZONE_MARGIN_M 만큼 넓혀 구역을 만들므로(draftZone), 초안은 그만큼 안으로 줄여 둔다.

/** 구역 단계에 들어와 AI 가 초안을 찾는 것처럼 보이는 시간(ms)과 그동안 보이는 글. */
export const DEMO_DRAFT_SEARCH_MS = 3_000;
export const DEMO_DRAFT_SEARCH_TEXT = 'AI가 위험구역을 찾고있어요...';

const OPENING = { minX: 5.2, maxX: 7.6, minY: 2.25, maxY: 4.55, zMin: 0, zMax: 1.4 } as const;
const INSET = SURFACE_ZONE_MARGIN_M;

/** 시연 계정이 보는 AI 구역 초안 응답(세팅 세션 하나). */
export function demoZoneDrafts(sessionId: string): SetupZoneDraftsResponse {
  const minX = OPENING.minX + INSET;
  const maxX = OPENING.maxX - INSET;
  const minY = OPENING.minY + INSET;
  const maxY = OPENING.maxY - INSET;
  return setupZoneDraftsResponseSchema.parse({
    setup_session_id: sessionId,
    site_id: 'demo',
    status: 'SUCCEEDED',
    drafts: [
      {
        candidate_id: 'demo-opening-stage',
        candidate_kind: 'OPENING',
        polygon_xy: [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
        ],
        z_min_m: OPENING.zMin,
        z_max_m: OPENING.zMax,
        recommended_name: '단상 개구부',
        recommended_severity: 'CRITICAL',
        rationale: '단상 둘레에 난간 없이 트인 단차가 있어 발을 헛디디면 떨어질 수 있어요.',
        confidence: 0.92,
      },
    ],
  });
}

/** 초안을 이미 찾아 보인 세팅 세션. 단계를 옮겨 다시 와도 또 기다리지 않는다(새로고침하면 처음부터 다시 찾는다). */
const searched = new Set<string>();

/**
 * 시연 계정의 AI 구역 초안 응답. 켜진(구역 단계) 뒤 DEMO_DRAFT_SEARCH_MS 동안은 찾는 중(초안 없음)이고 그 뒤에 개구부 초안을 보인다.
 * 꺼져 있으면 null 이다.
 */
export function useDemoZoneDrafts(
  sessionId: string | null,
  active: boolean,
): SetupZoneDraftsResponse | null {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const searching = active && sessionId !== null && !searched.has(sessionId) ? sessionId : null;

  useEffect(() => {
    if (searching === null) return undefined;
    const timer = window.setTimeout(() => {
      searched.add(searching);
      rerender();
    }, DEMO_DRAFT_SEARCH_MS);
    return () => window.clearTimeout(timer);
  }, [searching]);

  return useMemo<SetupZoneDraftsResponse | null>(() => {
    if (!active || sessionId === null) return null;
    const drafts = demoZoneDrafts(sessionId);
    return searching === null ? drafts : { ...drafts, status: 'QUEUED', drafts: [] };
  }, [active, sessionId, searching]);
}

/** 이미 구역이 된 초안의 3D 상자: 수락할 때 넓혀진 구역 자리다. */
function boxOfAcceptedDraft(draft: ZoneDraftItem): ViewerEditBox {
  const { polygon, zMin, zMax } = draftZoneFootprint(draft);
  return boxOfDraftItem({
    ...draft,
    polygon_xy: polygon.map(([x, y]): [number, number] => [x, y]),
    z_min_m: zMin ?? draft.z_min_m,
    z_max_m: zMax ?? draft.z_max_m,
  });
}

/**
 * 초안 카드에 커서를 댄 초안의 3D 윤곽을 점선 대신 위험 등급색의 실선·면으로 바꾼다. 이미 구역이 된 초안(accepted)은 그 구역 자리에 그린다.
 * 커서를 댄 초안이 없으면 윤곽을 그대로 둔다.
 */
export function withDraftHighlight(
  ghosts: readonly ViewerBoxGhost[],
  hovered: ZoneDraftItem | undefined,
  accepted: boolean,
): readonly ViewerBoxGhost[] {
  if (!hovered) return ghosts;
  const id = draftGhostId(hovered.candidate_id);
  const box = accepted ? boxOfAcceptedDraft(hovered) : boxOfDraftItem(hovered);
  return [
    ...ghosts.filter((ghost) => ghost.id !== id),
    { id, box, highlight: hovered.recommended_severity },
  ];
}
