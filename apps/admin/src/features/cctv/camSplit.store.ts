import type { Incident } from '@/features/events/incidents';
import { create } from 'zustand';

/** 어느 카메라인지 모를 때의 cam. 패널(CamSplitPanel)이 목록에 없는 카메라는 첫 카메라로 보이는 규칙에 기댄다(시험이 잠근다). */
export const ANY_CAMERA = '';

/** 실시간 관제 오른쪽에 여는 카메라 미리보기(관제 데모의 3D | CCTV 칸). 보고 있는 카메라와 그 카메라로 확인하려는 대상. */
export interface CamSplit {
  cam: string;
  target: Incident['target'];
}

interface CamSplitState {
  split: CamSplit | null;
  open: (split: CamSplit) => void;
  /** 열어 둔 채 보는 카메라만 바꾼다. */
  setCam: (cam: string) => void;
  close: () => void;
}

export const useCamSplitStore = create<CamSplitState>()((set) => ({
  split: null,
  open: (split) => set({ split }),
  setCam: (cam) => set((s) => (s.split ? { split: { ...s.split, cam } } : s)),
  close: () => set({ split: null }),
}));
