import { useBoxEditStore } from '@/store/boxEdit.store';

/** 구역 편집 패널이 내려 주는 3D 편집 상자·손잡이를 Viewer3D props 로 바꾼다(구역 편집 화면이 아니면 비어 있다). */
export function useBoxEditProps() {
  const boxEdit = useBoxEditStore((s) => s.boxEdit);
  const boxGhosts = useBoxEditStore((s) => s.ghosts);
  const onBoxEditChange = useBoxEditStore((s) => s.onChange);
  return { boxEdit, boxGhosts, onBoxEditChange };
}
