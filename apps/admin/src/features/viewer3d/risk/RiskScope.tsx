import { useSpatialData } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  membershipKey,
  NO_RISK,
  parseMembership,
  riskPresentation,
  type RiskHighlight,
  type RiskPresentation,
} from '@/features/viewer3d/risk/riskPresentation';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';

// 위험 강조를 한 번 계산해 사람·구역 레이어에 나눠 준다.
// 이벤트·사람 목록(별칭)·구역 목록·모드·연결이 바뀔 때만 다시 계산한다. 10 Hz 좌표 갱신에는 반응하지 않는다.

const RiskContext = createContext<RiskPresentation>(NO_RISK);

export function RiskScope({ children }: { children: ReactNode }) {
  const events = useSpatialData((s) => s.events);
  const members = useSpatialData((s) => membershipKey(s.world?.tracks ?? []));
  const worldSceneVersion = useSpatialData((s) => s.world?.sceneVersion ?? null);
  const zones = useSpatialData((s) => s.zones.zones);
  const connectionOpen = useSpatialData((s) => s.connection?.state === 'OPEN');
  const mode = useStore(useViewerStore(), (s) => s.mode);
  const value = useMemo(
    () =>
      riskPresentation({
        events: events.values(),
        tracks: parseMembership(members),
        worldSceneVersion,
        zoneIds: zones.map((zone) => zone.zoneId),
        mode,
        connectionOpen,
      }),
    [events, members, worldSceneVersion, zones, mode, connectionOpen],
  );
  return <RiskContext value={value}>{children}</RiskContext>;
}

/** 이 사람·구역의 강조. 없으면 null. */
export function useRiskHighlight(type: 'person' | 'zone', id: string): RiskHighlight | null {
  const risk = useContext(RiskContext);
  return (type === 'person' ? risk.people : risk.zones).get(id) ?? null;
}
