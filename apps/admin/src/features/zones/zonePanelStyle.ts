import { cn } from '@simai/ui/lib/utils';

// 구역 편집 패널의 Tailwind 조각(관제 데모 .zpanel·.zp-*·.zbtn). 여러 칸이 같은 모양을 쓰므로 한곳에 둔다.

/** 패널 자리: 3D 위에 뜨거나(관제 편집 모드) 3D 옆 칸에 놓인다(세팅의 구역 단계). */
export type ZonePanelPlacement = 'float' | 'inline';

const PANEL_BASE =
  'flex flex-col gap-2.5 overflow-x-hidden rounded-[16px] bg-tool-panel p-3 text-[13px] break-keep ring-1 ring-[color-mix(in_srgb,var(--primary)_30%,var(--border))] ring-inset';

/**
 * float: 3D 위 왼쪽에 뜨는 패널. 위(124px)는 머리말·도구줄 아래이고, 최대 높이는 위 여백(124px)과 아래 도크 자리(96px)를 뺀
 * 화면 높이다. 3D 위에 떠 있으므로 클릭을 받고(pointer-events-auto), 길어지면 안에서 스크롤한다.
 * inline: 3D 옆 칸을 채우고 칸과 함께 늘어난다(화면이 스크롤한다).
 */
export const PANEL_CLASS: Record<ZonePanelPlacement, string> = {
  float: cn(
    PANEL_BASE,
    'pointer-events-auto absolute top-[124px] left-3.5 z-[5] max-h-[calc(100svh-220px)] w-[356px] overflow-y-auto shadow-float',
  ),
  inline: cn(PANEL_BASE, 'w-full'),
};

/** 패널 안 한 묶음(이름·심각도, 작업면). */
export const CARD_CLASS = 'flex flex-col gap-2.5 rounded-[12px] bg-tool-card p-2.5';

/** 이름 칸·심각도 칸·구역 고르기가 같이 쓰는 모양. */
const CONTROL_CLASS = 'rounded-md border-border bg-tool-field text-[13px] text-foreground';

/** 이름·높이 칸. 공용 Input 의 높이·글자·바탕을 패널 칸 모양으로 덮는다. */
export const INPUT_CLASS = cn(
  CONTROL_CLASS,
  'h-8.5 px-[9px] py-0 aria-invalid:ring-0 md:text-[13px] dark:bg-tool-field dark:aria-invalid:border-destructive',
);

/** 숫자 칸(높이)은 고정폭 글꼴이다. */
export const NUMBER_INPUT_CLASS = cn(INPUT_CLASS, 'font-mono');

export const SELECT_CLASS = cn(
  CONTROL_CLASS,
  'h-8.5 w-full min-w-0 border px-[9px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
);

/** 패널 맨 위 구역 고르기: 칸보다 크고 굵다. */
export const PICK_CLASS = cn(SELECT_CLASS, 'h-10 rounded-[10px] text-sm font-semibold');

/** 라벨과 입력 칸을 세로로 묶는 칸. */
export const FIELD_CLASS = 'flex min-w-0 flex-col gap-1';
export const FIELD_LABEL_CLASS = 'text-[12px] font-medium text-muted-foreground';
/** 칸 아래 검사 문구 한 줄. */
export const FIELD_NOTE_CLASS = 'text-[11.5px] font-medium text-destructive';

/** 버튼 공통: 높이 32px, 보통 굵기. 눌려 있는(aria-pressed) 버튼은 주 버튼 색이다. */
export const BUTTON_CLASS =
  'h-8 rounded-md border-0 bg-surface-4 px-3 text-[13px] font-normal text-foreground hover:bg-[color-mix(in_srgb,var(--surface-4)_78%,var(--foreground))] disabled:opacity-45 aria-pressed:bg-primary aria-pressed:font-semibold aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary-hover';
export const PRIMARY_BUTTON_CLASS = cn(
  BUTTON_CLASS,
  'bg-primary font-semibold text-primary-foreground hover:bg-primary-hover',
);
export const DANGER_BUTTON_CLASS = cn(BUTTON_CLASS, 'text-destructive');
/** 삭제 확인 단계의 삭제 버튼. */
export const ARMED_DELETE_CLASS = cn(
  DANGER_BUTTON_CLASS,
  'bg-destructive text-primary-foreground hover:bg-destructive',
);

/** 패널 위쪽 알림 한 줄의 공통 모양. */
const NOTICE_BASE = 'rounded-[10px] bg-surface-2 px-2.5 py-1.5 text-[12px]';
/** 구역 목록을 못 불러왔다는 한 줄. */
export const NOTE_CLASS = cn(NOTICE_BASE, 'text-muted-foreground');
/** 저장·발행 실패 문구. */
export const WARNING_CLASS = cn(
  NOTICE_BASE,
  'bg-surface-3 font-medium text-foreground ring-1 ring-border ring-inset',
);
/** 반영했지만 현장으로 보내지 못했을 때 문구와 다시 보내기 버튼. */
export const RETRY_CLASS = cn(
  NOTICE_BASE,
  'flex items-center justify-between gap-2 font-medium ring-1 ring-border ring-inset',
);
