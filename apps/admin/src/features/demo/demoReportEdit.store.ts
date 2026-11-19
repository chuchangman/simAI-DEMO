import { createSafeStorage } from '@/lib/safeStorage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 시연 계정이 작업 전 확인의 편집 창에서 직접 고쳐 저장한 TBM 보고서(작업별). 그 보고서는 서버 양식이 사람이 쓴 값이라
// 미리 적어 둔 초안을 더 덮어 보이거나 서버에 맞춰 보내지 않는다(features/demo/demoReport). 새로고침해도 이어지게 브라우저에 남긴다.

export const DEMO_REPORT_EDITED_KEY = 'simai.demo.reportEdited';

/** 남겨 둘 작업 수(오래된 것부터 버린다). */
const KEEP_WORKS = 20;

interface DemoReportEditState {
  /** 직접 고친 작업 ID(오래된 것 먼저). */
  workIds: readonly string[];
  /** 작업의 보고서를 직접 고쳐 저장했다고 남긴다. */
  markEdited: (workId: string) => void;
}

type Saved = Pick<DemoReportEditState, 'workIds'>;

/** 남은 값이 깨졌으면 고친 작업이 없는 것으로 본다. */
const savedWorkIds = (saved: unknown): readonly string[] => {
  if (typeof saved !== 'object' || saved === null) return [];
  const { workIds } = saved as { workIds?: unknown };
  return Array.isArray(workIds) ? workIds.filter((id): id is string => typeof id === 'string') : [];
};

const useDemoReportEditStore = create<DemoReportEditState>()(
  persist(
    (set) => ({
      workIds: [],
      markEdited: (workId) =>
        set((state) => ({
          workIds: [...state.workIds.filter((id) => id !== workId), workId].slice(-KEEP_WORKS),
        })),
    }),
    {
      name: DEMO_REPORT_EDITED_KEY,
      storage: createSafeStorage<Saved>(),
      partialize: (state) => ({ workIds: state.workIds }),
      merge: (saved, current) => ({ ...current, workIds: savedWorkIds(saved) }),
    },
  ),
);

/** 작업의 보고서를 편집 창에서 직접 고쳐 저장했는가, 그리고 그렇게 남기는 함수. */
export function useDemoReportEdit(workId: string): { edited: boolean; markEdited: () => void } {
  const edited = useDemoReportEditStore((state) => state.workIds.includes(workId));
  const mark = useDemoReportEditStore((state) => state.markEdited);
  return { edited, markEdited: () => mark(workId) };
}
