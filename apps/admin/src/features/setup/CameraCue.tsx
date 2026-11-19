import type { CameraGuideView } from '@/features/setup/cameraGuides';
import type { GuideDirection } from '@/features/setup/types';
import { cn } from '@simai/ui/lib/utils';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, type LucideIcon } from 'lucide-react';

// 카메라 영상 위 방향 안내: 돌릴 쪽 가장자리를 어둡게 하고 꺾쇠(조금 = 하나, 더 = 둘)를 얹으며, 이웃 카메라와 같이 보는
// 곳에는 동그라미와 이웃 카메라 이름을 둔다. 영상은 칸 안에 비율대로 담겨 위아래나 양옆에 빈 띠가 생기므로, 영상이 실제로
// 그려지는 사각형 안에서 위치를 잡는다.

const ARROW: Record<Exclude<GuideDirection, 'NONE'>, { Icon: LucideIcon; edge: string }> = {
  LEFT: { Icon: ChevronLeft, edge: 'inset-y-0 left-0 w-[26%] bg-linear-to-r -space-x-3.5' },
  RIGHT: { Icon: ChevronRight, edge: 'inset-y-0 right-0 w-[26%] bg-linear-to-l -space-x-3.5' },
  UP: { Icon: ChevronUp, edge: 'inset-x-0 top-0 h-[30%] flex-col bg-linear-to-b -space-y-3.5' },
  DOWN: {
    Icon: ChevronDown,
    edge: 'inset-x-0 bottom-0 h-[30%] flex-col bg-linear-to-t -space-y-3.5',
  },
};

const ARROW_SIZE = 34;

/** 영상의 가로세로 비율로 칸 안에 영상이 그려지는 사각형을 잡는 바탕(칸 크기는 컨테이너 단위로 읽는다). */
export function videoBox(aspect: number) {
  return { width: `min(100cqw, ${aspect} * 100cqh)`, aspectRatio: aspect };
}

/**
 * 한 카메라 영상 위의 안내 하나. 보일 것(꺾쇠도 동그라미도)이 없으면 아무것도 그리지 않는다.
 * aspect 는 영상의 가로/세로 비율이다.
 */
export function CameraCue({ guide, aspect }: { guide: CameraGuideView; aspect: number }) {
  const arrow = guide.direction === 'NONE' ? null : ARROW[guide.direction];
  if (!arrow && !guide.spot) return null;
  return (
    <div
      aria-hidden
      className="[container-type:size] pointer-events-none absolute inset-0 grid place-items-center"
    >
      <div className="relative" style={videoBox(aspect)}>
        {arrow && (
          <div
            data-testid="camera-cue-arrow"
            data-direction={guide.direction}
            className={cn(
              'absolute flex items-center justify-center from-black/55 to-transparent text-white',
              arrow.edge,
            )}
          >
            {Array.from({ length: guide.magnitude === 'MORE' ? 2 : 1 }, (_, n) => (
              <arrow.Icon
                key={n}
                size={ARROW_SIZE}
                className="drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
              />
            ))}
          </div>
        )}
        {guide.spot && (
          <span
            data-testid="camera-cue-spot"
            className="absolute flex -translate-x-[9px] -translate-y-[9px] items-center gap-1.5 text-[11px] font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]"
            style={{ left: `${guide.spot[0] * 100}%`, top: `${guide.spot[1] * 100}%` }}
          >
            <i className="size-[18px] flex-none rounded-full border-2 border-white ring-1 ring-black/45" />
            {guide.neighborLabel}
          </span>
        )}
      </div>
    </div>
  );
}
