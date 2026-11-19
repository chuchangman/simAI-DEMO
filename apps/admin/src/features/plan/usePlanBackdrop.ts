import { floorPlanBounds, floorPlanOutline } from '@/features/plan/floorPlanData';
import type { PlanBackdrop, PlanBounds } from '@/features/plan/plan';
import { useFloorPlan } from '@/features/plan/useFloorPlan';
import { useLoadedImage } from '@/features/plan/useLoadedImage';
import { useMemo } from 'react';

/**
 * 2D 평면의 방 범위와 평면도 바탕. 평면도가 없으면(404·받기 전) 기본 10×10m 와 모눈이다.
 * 방 범위가 바뀔 때만 새 객체를 돌려줘 바탕 층이 다시 그려지지 않게 한다.
 */
export function usePlanBackdrop(): { bounds: PlanBounds; backdrop: PlanBackdrop | undefined } {
  const plan = useFloorPlan();
  const imageUrl = useLoadedImage(plan?.image_url);
  const bounds = useMemo(() => floorPlanBounds(plan), [plan]);
  const outline = useMemo(() => floorPlanOutline(plan), [plan]);
  const stale = plan?.stale === true;
  const backdrop = useMemo<PlanBackdrop | undefined>(
    () => (plan ? { imageUrl, outline, outdated: stale } : undefined),
    [plan, imageUrl, outline, stale],
  );
  return { bounds, backdrop };
}
