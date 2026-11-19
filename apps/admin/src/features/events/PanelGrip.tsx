import { resizePanel, type PanelEdge } from '@/features/events/panelBox';
import { usePanelDrag } from '@/features/events/usePanelDrag';
import type { FloatBox, Measured } from '@/lib/floatSpot';
import { cn } from '@simai/ui/lib/utils';

/** 손잡이 자리: 왼쪽 가장자리·아래 가장자리·왼쪽 아래 모서리. */
const EDGE_CLASS: Record<PanelEdge, string> = {
  x: 'top-3.5 bottom-3.5 -left-1.5 w-2.5 cursor-ew-resize',
  y: 'right-3.5 -bottom-1.5 left-3.5 h-2.5 cursor-ns-resize',
  xy: '-bottom-1.5 -left-1.5 size-[18px] cursor-nesw-resize after:absolute after:inset-[5px] after:rounded-bl-[4px] after:border-b-2 after:border-l-2 after:border-faint',
};

/** 크기 손잡이. 두 번 누르면 기본 자리·크기로 돌아간다. */
export function PanelGrip({
  edge,
  startOf,
  onResize,
  onReset,
}: {
  edge: PanelEdge;
  startOf: () => Measured;
  onResize: (box: FloatBox) => void;
  onReset: () => void;
}) {
  const { active, handlers } = usePanelDrag(startOf, (start, dx, dy, bounds) =>
    onResize(resizePanel(start, edge, dx, dy, bounds)),
  );
  return (
    <div
      aria-hidden
      data-grip={edge}
      {...handlers}
      onDoubleClick={onReset}
      className={cn(
        'absolute z-[2] touch-none rounded-[6px] hover:bg-primary/35',
        active && 'bg-primary/35',
        EDGE_CLASS[edge],
      )}
    />
  );
}
