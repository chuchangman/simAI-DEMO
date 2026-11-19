import type { WorkSurface } from '@/features/surfaces/types';
import type { ViewerBoxEdit, ViewerBoxGhost, ViewerEditBox } from '@/features/viewer3d';
import type { Zone } from '@/features/zones/types';
import {
  sameBox,
  sameBoxEdit,
  sameGhosts,
  surfaceBox,
  withoutUnchangedSurface,
  withSurfaceBox,
  withZoneBox,
  type SurfaceDraft,
} from '@/features/zones/zoneEditModel';
import { useBoxEditStore } from '@/store/boxEdit.store';
import {
  discardZoneRecord,
  lastZoneRecord,
  recordZoneDraft,
  updateZoneDraft,
  type HistoryStep,
} from '@/store/zoneEdit.store';
import { useCallback, useEffect, useRef } from 'react';

// 구역 편집 화면과 3D 뷰어 사이의 다리: 3D 손잡이가 올린 상자를 초안에 넣고, 편집 상자를 3D 로 내리고, 편집이 끝나면 3D 선택을
// 푼다. 작업면은 3D 틀(SpatialViewportHost)이 목록 응답을 그대로 뷰어에 넣는다.

/**
 * 구역 편집이 끝날 때(화면이 내려갈 때) 3D 에서 고른 정적 객체(object:…) 선택을 푼다. 편집 모드 밖에 작업면 선택이 남지
 * 않게 한다. objectPicked 는 지금 정적 객체를 골랐는지다(내려가는 순간의 값을 읽는다).
 */
export function useClearObjectPickOnClose(objectPicked: boolean, clearSelection: () => void) {
  const latest = useRef({ objectPicked, clearSelection });
  useEffect(() => {
    latest.current = { objectPicked, clearSelection };
  });
  useEffect(
    () => () => {
      if (latest.current.objectPicked) latest.current.clearSelection();
    },
    [],
  );
}

/** 고르고 있는 대상. 3D 에서 끌 때마다 이 값으로 초안을 만든다. */
interface BoxTarget {
  key: string;
  zone: Zone | null;
  linked: WorkSurface | null;
  surface: SurfaceDraft | null;
  zoneBox: ViewerEditBox;
}

/** 끌기 하나(포인터를 누르고 있는 동안)의 대상, 시작·마지막 상자, 첫 변경 때 남긴 되돌리기 단계. */
interface Drag {
  key: string;
  start: ViewerEditBox;
  last: ViewerEditBox;
  step: HistoryStep | undefined;
}

/** 끝난 끌기가 남긴 게 없는지: 시작 상자로 돌아왔고, 끌기가 남긴 단계가 아직 마지막이다(끄는 중 다른 고침이 단계를 더하지 않았다). */
const leftNothing = ({ key, start, last, step }: Drag) =>
  sameBox(start, last) && lastZoneRecord(key) === step;

/**
 * 3D 에서 한 번 끄는 동안의 변경을 되돌리기 한 단계로 묶는다. 끌기의 첫 변경에서만 단계를 남기고, 포인터를 놓거나
 * 가로채이면 끝낸다. 끝났을 때 남긴 게 없으면(끄는 중 Esc) 그 단계를 버린다.
 * 돌려주는 함수에 이번 변경의 대상·시작 상자(변경 전)·새 상자를 넘긴다.
 */
function useDragRecord() {
  const drag = useRef<Drag | null>(null);
  useEffect(() => {
    const end = () => {
      const current = drag.current;
      drag.current = null;
      if (current && leftNothing(current)) discardZoneRecord(current.key);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    // 새 끌기는 반드시 포인터를 누르며 시작한다. 누를 때도 끝내면 놓음을 못 받은 끌기가 다음 끌기에 합쳐지지 않는다(캡처라 3D 처리기보다 먼저).
    window.addEventListener('pointerdown', end, true);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('pointerdown', end, true);
    };
  }, []);
  return useCallback((key: string, start: ViewerEditBox, box: ViewerEditBox) => {
    if (drag.current) {
      drag.current.last = box;
      return;
    }
    recordZoneDraft(key);
    drag.current = { key, start, last: box, step: lastZoneRecord(key) };
  }, []);
}

/**
 * 뷰어가 올린 상자(끄는 동안 0.05 m 단위)를 초안에 넣는 처리기. 작업면이 있으면 작업면 형상으로, 없으면 구역 상자로 넣는다.
 * 처리기 모양은 하나로 두고 고른 대상은 ref 로 읽는다(끄는 동안 3D 가 낡은 처리기를 부르지 않게).
 */
export function useBoxChange(target: BoxTarget) {
  const latest = useRef(target);
  useEffect(() => {
    latest.current = target;
  });
  const trackDrag = useDragRecord();
  return useCallback(
    (box: ViewerEditBox) => {
      const { key, zone, linked, surface, zoneBox } = latest.current;
      if (!surface) {
        trackDrag(key, zoneBox, box);
        updateZoneDraft(key, (prev) =>
          withoutUnchangedSurface(withZoneBox(prev, zone, box), linked),
        );
        return;
      }
      trackDrag(key, surfaceBox(surface.geometry), box);
      updateZoneDraft(key, (prev) =>
        withoutUnchangedSurface(withSurfaceBox(prev, surface, box), linked),
      );
    },
    [trackDrag],
  );
}

/**
 * 편집 상자·윤곽·처리기를 boxEdit 저장소로 내린다(SpatialViewportHost 가 뷰어에 넘긴다). 값이 달라졌을 때만 저장소를
 * 바꾼다(새 객체가 와도 3D 를 다시 그리지 않는다). 화면이 내려가면 비운다.
 */
export function useBoxEditBridge(input: {
  boxEdit: ViewerBoxEdit | null;
  ghosts: readonly ViewerBoxGhost[];
  onChange: (box: ViewerEditBox) => void;
}) {
  const { boxEdit, ghosts, onChange } = input;
  useEffect(() => {
    const store = useBoxEditStore.getState();
    const next: Parameters<typeof store.set>[0] = {};
    if (!sameBoxEdit(store.boxEdit, boxEdit)) next.boxEdit = boxEdit;
    if (!sameGhosts(store.ghosts, ghosts)) next.ghosts = ghosts;
    if (store.onChange !== onChange) next.onChange = onChange;
    if (Object.keys(next).length > 0) store.set(next);
  }, [boxEdit, ghosts, onChange]);
  useEffect(() => () => useBoxEditStore.getState().clear(), []);
}
