// 레이아웃 · TBM 보고서의 상수. 쪽 나눔 수치, 회의록 칸 수, 작업 등록 한도, 서식과 쪽 나눔이 주고받는 표시를 모았다.

/** 회의록 한 장은 A4(794×1123 CSS px)다. */
export const A4_W = 794;
export const A4_H = 1123;
/** A4 한 장의 안쪽 여백(px). */
export const A4_PAD = 38;

/** 쪽 높이를 잴 때 소수점 올림 오차로 쪽이 넘치지 않게 두는 여유(px). */
export const PAGE_FIT_SLACK = 2;
/** 쪽 나눔에 쓰는 보이지 않는 사본을 화면 밖으로 치우는 거리(px). */
export const OFFSCREEN_PX = 100000;

/** 미리보기 틀(p-3)이 가로·세로로 차지하는 안쪽 여백 합(px). */
export const PREVIEW_FRAME_PX = 24;
/** 영역을 재기 전 미리보기의 처음 축소율. */
export const PREVIEW_SCALE_INITIAL = 0.5;
/** 보이는 영역이 없어도 0 이 되지 않게 하는 최소 축소율. */
export const PREVIEW_SCALE_MIN = 0.01;

/** 잠재위험요인 · 대책 · 안전조치 확인 줄 수(① ~ ③). */
export const FORM_ROWS = 3;
/** 참석자 서명 줄 하나에 놓는 사람 수. */
export const ATTENDEES_PER_ROW = 3;
/** 참석자 서명 줄은 적어도 이만큼 둔다. */
export const MIN_ATTENDEE_ROWS = 4;

/** 작업 등록에서 받는 인원 범위. */
export const MIN_PEOPLE = 1;
export const MAX_PEOPLE = 10;

/** 구역이 없는 작업(현장 전체를 대상으로 하는 작업)의 장소 글자. */
export const SITE_WIDE_TEXT = '현장 전체';
/** 예전 등록 폼이 구역 없는 작업에 장소로 자동 저장하던 글자. 읽을 때 SITE_WIDE_TEXT 로 본다. */
export const LEGACY_OUTSIDE_ZONE_TEXT = '구역 밖';
/** 수동 등록 작업의 장비 글자. */
export const GEAR_UNSET_TEXT = '장비 미입력';

/** 작업을 끝낸 뒤 서버가 작업 마무리를 만드는 동안의 안내. */
export const WRAP_UP_GENERATING_TEXT = '작업 마무리 작성 중';

// 서식(TbmFormSheet)이 쪽 나눔(paginate)에 알리는 표시: 칸 · 구역 제목 줄 · 안내 글.
export const FIELD_ATTR = 'data-tbm-field';
export const BAR_ATTR = 'data-tbm-bar';
export const NOTE_ATTR = 'data-tbm-note';
/** 칸의 안내 글자(placeholder) 속성(FormFields 의 data-ph). 이어지는 행에서는 뗀다. */
export const PLACEHOLDER_ATTR = 'data-ph';
/** JSX 에 펼쳐 쓰는 표시. */
export const FIELD_MARK = { [FIELD_ATTR]: '' };
export const BAR_MARK = { [BAR_ATTR]: '' };
export const NOTE_MARK = { [NOTE_ATTR]: '' };
