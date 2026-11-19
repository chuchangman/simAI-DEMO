import type {
  SpatialDataState,
  SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import type { SpatialSource } from '@/features/viewer3d/data/spatialSource';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useStore } from 'zustand';

// R3F Canvas 는 바깥 Context 를 장면 안으로 이어 주므로 장면 레이어(-44·-47·-185)에서도 쓸 수 있다.
export const SpatialDataContext = createContext<SpatialDataStore | null>(null);

export function useSpatialDataStore(): SpatialDataStore {
  const store = useContext(SpatialDataContext);
  if (!store)
    throw new Error('useSpatialDataStore 는 SpatialDataProvider(Viewer3D) 안에서만 쓴다.');
  return store;
}

/**
 * 데이터 하나를 골라 구독한다. 고른 값이 바뀔 때만 다시 그린다.
 * 매 프레임 값이 필요하면 리렌더 대신 useSpatialDataStore().getState() 를 useFrame 안에서 읽는다.
 */
export function useSpatialData<T>(selector: (state: SpatialDataState) => T): T {
  return useStore(useSpatialDataStore(), selector);
}

interface SpatialDataProviderProps {
  store: SpatialDataStore;
  source: SpatialSource | null | undefined;
  children: ReactNode;
}

/**
 * Source 구독 수명. Source 가 바뀌면 이전 구독을 풀고 데이터를 비운 뒤 새로 구독한다.
 * 같은 id 로 다시 구독할 때(StrictMode 이중 효과)는 데이터를 비우지 않는다.
 * Store 는 그대로라 렌더러의 구독과 Canvas 는 다시 만들어지지 않는다.
 */
export function SpatialDataProvider({ store, source, children }: SpatialDataProviderProps) {
  useEffect(() => {
    const sourceId = source?.id ?? null;
    if (store.getState().sourceId !== sourceId) store.getState().reset(sourceId);
    if (!source) return;
    // 해제 뒤 늦게 도착한 콜백은 버린다.
    let active = true;
    const unsubscribe = source.subscribe({
      onMessage: (raw, receivedAt) => {
        if (active) store.getState().ingest(raw, receivedAt);
      },
      onConnectionChange: (change) => {
        if (active) store.getState().setConnection(change);
      },
      onZones: (result, receivedAt) => {
        if (active) store.getState().ingestZones(result, receivedAt);
      },
      onWorkSurfaces: (result, receivedAt) => {
        if (active) store.getState().ingestWorkSurfaces(result, receivedAt);
      },
      // Source 가 보관하던 형상을 명시적으로 버렸다(로그아웃·Scene 변경 등). 그 채널만 비운다.
      onSnapshotClear: (channel) => {
        if (active) store.getState().clearSnapshot(channel);
      },
      // 재생 Source 가 뒤로 돌릴 때. Source 는 그대로 두고 받은 데이터만 비운다.
      onReset: () => {
        if (active) store.getState().reset(sourceId);
      },
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store, source]);

  return <SpatialDataContext value={store}>{children}</SpatialDataContext>;
}
