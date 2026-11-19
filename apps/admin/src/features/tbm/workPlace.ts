import { LEGACY_OUTSIDE_ZONE_TEXT, SITE_WIDE_TEXT } from '@/features/tbm/constants';
import { UNNAMED_ZONE_NAME } from '@/lib/zoneName';

// 작업의 장소 글자. 화면에는 구역 번호(z-…)를 보이지 않고 이름만 보인다.

/**
 * 작업이 서버에서 받은 장소(place)를 화면 글자로 바꾼다. 서버는 구역 작업의 place 에 구역의 최신 이름을 채워 주므로 그대로
 * 쓴다(비어 있으면 `구역`). 구역이 없는 작업은 현장 전체가 대상이라 장소를 적지 않았으면 `현장 전체` 이고, 예전 등록 폼이
 * 자동으로 저장한 `구역 밖`도 그렇게 읽는다.
 */
export function workPlaceLabel(work: { zone_id: string | null; place?: string | null }): string {
  const place = work.place?.trim() ?? '';
  if (work.zone_id) return place || UNNAMED_ZONE_NAME;
  return place && place !== LEGACY_OUTSIDE_ZONE_TEXT ? place : SITE_WIDE_TEXT;
}

/**
 * 구역 없는 작업을 서버에 다시 저장할 때 보낼 장소. 사용자가 적은 장소만 남기고 '현장 전체' 글자는 저장하지 않는다(비워
 * 두면 서버·화면이 현장 전체로 읽는다). 구역 작업은 장소를 저장하지 않는다.
 */
export function storedPlaceOf(task: { zone: string | null; area?: string }): string | null {
  return task.zone || !task.area || task.area === SITE_WIDE_TEXT ? null : task.area;
}
