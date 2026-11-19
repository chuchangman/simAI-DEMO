import { Focus, Loader2, RefreshCw, RotateCcw, ScanEye } from 'lucide-react';

/** 관제 화면 도구 모음의 아이콘. 아이콘을 바꿀 때는 이 파일만 고친다. */
export const TOOL_ICON = {
  resetView: Focus,
  retry3d: RotateCcw,
  coverage: ScanEye,
  regenerate: RefreshCw,
  busy: Loader2,
} as const;

/** 도구 모음 버튼(Button size)과 그 안의 아이콘 크기. 손에 잡히도록 한 칸을 36px 로 둔다. */
export const TOOL_BUTTON_SIZE = 'icon-lg';
export const TOOL_ICON_CLASS = 'size-5';
