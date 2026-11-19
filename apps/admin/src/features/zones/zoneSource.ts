import { createContext, useContext } from 'react';

// 구역 편집 화면이 읽고 저장하는 곳(S15P31A101-615). 기본(null)은 관제 구역(GET /api/zones, POST /api/zones/commit)이고,
// 세팅 구역 단계는 그 세션의 구역 목록(-612 GET·PUT /api/setup-sessions/{id}/zones)으로 바꾼다. 세팅 완료가 목록을 관제 구역으로 적용한다.

/** 세팅 세션 구역 목록을 쓰는 화면. */
export interface SetupZoneSource {
  sessionId: string;
}

export const ZoneSourceContext = createContext<SetupZoneSource | null>(null);

/** 지금 화면의 구역 출처. explicit 을 주면(Provider 위에서 부르는 훅) 그것을 쓴다. */
export function useZoneSource(explicit?: SetupZoneSource | null): SetupZoneSource | null {
  const fromContext = useContext(ZoneSourceContext);
  return explicit !== undefined ? explicit : fromContext;
}
