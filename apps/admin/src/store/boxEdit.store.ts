import type { ViewerBoxEdit, ViewerBoxGhost, ViewerEditBox } from '@/features/viewer3d';
import { create } from 'zustand';

interface BoxEditState {
  /** 3D 에 띄울 편집 상자와 손잡이. 없으면 손잡이를 내린다. */
  boxEdit: ViewerBoxEdit | null;
  ghosts: readonly ViewerBoxGhost[];
  onChange: (box: ViewerEditBox) => void;
  set: (next: Partial<Pick<BoxEditState, 'boxEdit' | 'ghosts' | 'onChange'>>) => void;
  clear: () => void;
}

const NONE: readonly ViewerBoxGhost[] = [];
const IGNORE = () => undefined;

// 구역 편집 패널(features/zones)이 3D 뷰어(SpatialViewportHost 가 Viewer3D 의 boxEdit·boxGhosts·onBoxEditChange 로 넘긴다)에
// 편집 상자를 내려 주는 다리다. 패널이 내려가면 비운다.
export const useBoxEditStore = create<BoxEditState>()((set) => ({
  boxEdit: null,
  ghosts: NONE,
  onChange: IGNORE,
  set: (next) => set(next),
  clear: () => set({ boxEdit: null, ghosts: NONE, onChange: IGNORE }),
}));
