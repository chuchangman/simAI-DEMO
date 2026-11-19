// 관제 화면 왼쪽 칼럼(구역 목록)의 Tailwind 조각.

/**
 * 도구 모음(위 72px, 높이 44px) 바로 아래(124px, 구역 편집 패널과 같은 줄)에서 2D 지도 위까지 늘어난 세로 칼럼. 폭과 아래
 * 끝은 지도 크기와 함께 CSS 변수로 정해진다(index.css). 패널 사이 빈 곳이 3D 클릭을 막지 않게 칼럼은 클릭을 받지 않고
 * (pointer-events-none) 안의 패널만 받는다.
 */
export const SIDE_COLUMN_CLASS =
  'pointer-events-none absolute top-[124px] bottom-(--side-column-bottom) left-3.5 z-[6] flex w-(--side-column-width) flex-col gap-2 *:pointer-events-auto';

/** 칼럼 안 한 패널: 도구 모음과 같은 유리 카드. 칼럼이 모자라면 패널 안 목록이 스크롤한다. */
export const SIDE_PANEL_CLASS =
  'flex min-h-0 flex-col gap-1 rounded-[14px] bg-card/94 p-2 shadow-float ring-1 ring-border backdrop-blur-[8px] ring-inset';

/** 패널 제목 줄. */
export const SIDE_PANEL_TITLE_CLASS = 'px-1.5 text-[13px] font-bold';
