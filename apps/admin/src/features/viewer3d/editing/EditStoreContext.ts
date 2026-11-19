import type { EditStore } from '@/features/viewer3d/editing/editSession.store';
import type { ViewerEditOverlayInput } from '@/features/viewer3d/editing/editTypes';
import { createContext, useContext } from 'react';

// Canvas 안 Gizmo 가 뷰어 인스턴스의 편집 세션을 읽는다. R3F Canvas 는 바깥 Context 를 장면 안으로 이어 준다.
export const EditStoreContext = createContext<EditStore | null>(null);

/** 편집 세션 Store. ViewerShell 밖(시험 등)이면 null 이고 Gizmo 를 그리지 않는다. */
export const useEditStore = () => useContext(EditStoreContext);

/** 미저장 미리보기 겹침(단일 또는 다중 구역 읽기 전용 Ghost). */
export const EditOverlayContext = createContext<ViewerEditOverlayInput>(null);
