// 화면에 보일 구역 이름. 3D 뷰어(viewer3d)도 쓰므로 lib 에 둔다(viewer3d 는 @/lib 만 가져온다).

/** 이름이 비었을 때 화면에 보이는 구역 이름. */
export const UNNAMED_ZONE_NAME = '구역';

/** 화면에 보일 구역 이름. 앞뒤 공백은 떼고, 비었으면 `구역` 이다. */
export const zoneDisplayName = (name: string) => name.trim() || UNNAMED_ZONE_NAME;
