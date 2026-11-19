// 레이아웃 · TBM 보고서 화면이 같이 쓰는 클래스 조각.

/** 카드 안쪽 여백과 줄 간격. */
export const PANEL = 'flex-none gap-3 px-5 py-[18px]';
export const H2 = 'text-[15px] leading-[22px] font-bold text-muted-foreground';
export const H3 = 'text-[13px] font-bold text-muted-foreground';
export const NOTE = 'text-[13px] text-muted-foreground';
/** 오류 · 실패 안내 한 덩어리. */
export const ALERT =
  'rounded-lg bg-destructive/15 px-3.5 py-2.5 text-[13px] text-destructive ring-1 ring-destructive/40 ring-inset';
export const PILL =
  'rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground ring-1 ring-faint ring-inset';
/** 카드 머리의 큰 단추(높이 38px). */
export const ACTION = 'h-[38px] px-3.5';
export const SECONDARY = `${ACTION} bg-surface-3`;
/** 작은 보조 단추(높이 30px): 보기 전환 · 쪽 넘김 · 하루치 묶음. */
export const SWITCH =
  'h-[30px] bg-surface-2 px-3 text-[13px] text-foreground ring-1 ring-faint ring-inset hover:bg-surface-3';
