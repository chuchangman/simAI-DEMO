import type { ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { createContext, useContext } from 'react';

// R3F Canvas 는 바깥 Context 를 장면 안으로 이어 준다.
export const ViewerStoreContext = createContext<ViewerStore | null>(null);

export function useViewerStore(): ViewerStore {
  const store = useContext(ViewerStoreContext);
  if (!store) throw new Error('useViewerStore 는 Viewer3D 안에서만 쓴다.');
  return store;
}
