import { Button } from '@simai/ui/components/button';
import { Undo2 } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';

// 카메라 화면 배치: 기본은 2열 분할(카메라 4대면 2×2). 한 칸을 누르면 그 칸을 크게, 나머지를 옆에 세로로 둔다
// (관제 데모의 CctvWall 과 같다). 칸은 배치가 바뀌어도 같은 요소로 남아 캔버스가 다시 만들어지지 않는다.
// rest='below' 면 나머지를 큰 칸 아래 한 줄에 작게 둔다(큰 칸이 화면 폭을 더 쓴다).

/** 칸 사이 간격(px). */
const GAP_PX = 10;
/** 칸(영상) 비율 16:9. */
const RATIO_W = 16;
const RATIO_H = 9;
/** 2열 분할. 카메라가 하나면 1열이다. */
const MAX_COLS = 2;
/** 큰 칸 아래 줄의 칸 수(이보다 카메라가 적어도 칸 크기는 같다). */
const BELOW_MIN_COLS = 4;

/** 크게 볼 때 나머지 칸을 놓는 곳. */
export type WallRest = 'side' | 'below';

export interface WallTile {
  focused: boolean;
  /** 이 칸을 크게 보거나 4분할로 돌아간다. focusable 이 false 면 아무 일도 하지 않는다. */
  toggle: () => void;
}

type CssVars = Record<string, string | number>;

/** 4분할: 남은 공간에 맞는 16:9 상자(변수 --g)에 cols×rows 칸을 같은 크기로 둔다. */
function splitStyle(vars: CssVars): CSSProperties {
  const style: CssVars = {
    ...vars,
    '--g': `min(100cqh, calc(100cqw * var(--rows) * ${RATIO_H} / (var(--cols) * ${RATIO_W})))`,
  };
  return {
    ...style,
    height: 'var(--g)',
    width: `calc(var(--g) * var(--cols) * ${RATIO_W} / (var(--rows) * ${RATIO_H}))`,
    gridTemplateColumns: 'repeat(var(--cols), minmax(0, 1fr))',
    gridTemplateRows: 'repeat(var(--rows), minmax(0, 1fr))',
  };
}

/**
 * 크게 보기: 큰 칸 높이 --h, 옆 칸 side 개(높이 --sh = (H - (side-1)·gap)/side)가 큰 칸 오른쪽에 붙는다.
 * 가로 폭 = H·16/9 + gap + sh·16/9 가 컨테이너에 들어가도록 H 를 푼 식이다.
 */
function focusStyle(vars: CssVars): CSSProperties {
  const sideGaps = `${RATIO_W} * var(--gap) * (var(--side) - 1) / (${RATIO_H} * var(--side))`;
  const style: CssVars = {
    ...vars,
    '--h': `min(100cqh, calc((100cqw - var(--gap) + ${sideGaps}) * ${RATIO_H} * var(--side) / (${RATIO_W} * (var(--side) + 1))))`,
    '--sh': 'calc((var(--h) - (var(--side) - 1) * var(--gap)) / var(--side))',
  };
  return {
    ...style,
    height: 'var(--h)',
    gridTemplateColumns: `calc(var(--h) * ${RATIO_W} / ${RATIO_H}) calc(var(--sh) * ${RATIO_W} / ${RATIO_H})`,
    gridTemplateRows: 'repeat(var(--side), var(--sh))',
  };
}

/**
 * 크게 보기(아래 줄): 큰 칸 높이 --h, 그 아래 한 줄에 --per 칸(높이 --sh = (H·16/9 - (per-1)·gap)/per · 9/16)이 큰 칸 폭을 나눈다.
 * 높이 H + gap + sh 가 컨테이너에 들어가도록 H 를 푼 식이다.
 */
function belowStyle(vars: CssVars): CSSProperties {
  const style: CssVars = {
    ...vars,
    '--h': `min(calc(100cqw * ${RATIO_H} / ${RATIO_W}), calc((100cqh - var(--gap) + ${RATIO_H} * var(--gap) * (var(--per) - 1) / (${RATIO_W} * var(--per))) * var(--per) / (var(--per) + 1)))`,
    '--sw': `calc((var(--h) * ${RATIO_W} / ${RATIO_H} - (var(--per) - 1) * var(--gap)) / var(--per))`,
  };
  return {
    ...style,
    gridTemplateColumns: 'repeat(var(--per), var(--sw))',
    gridTemplateRows: `var(--h) calc(var(--sw) * ${RATIO_H} / ${RATIO_W})`,
  };
}

/** 크기는 컨테이너 단위(cqw·cqh)로 계산해 남은 공간에 맞춘다. */
function layoutStyle(count: number, side: number, focus: boolean, rest: WallRest): CSSProperties {
  const cols = count > 1 ? MAX_COLS : 1;
  const vars = {
    '--cols': cols,
    '--rows': Math.ceil(count / cols),
    '--side': side,
    '--per': Math.max(side, BELOW_MIN_COLS),
    '--gap': `${GAP_PX}px`,
  };
  if (!focus) return splitStyle(vars);
  return rest === 'below' ? belowStyle(vars) : focusStyle(vars);
}

/**
 * 크게 볼 때 큰 칸은 첫 열 전체(아래 줄 배치면 첫 줄 전체), 나머지는 둘째 열(둘째 줄)에 놓는다. 4분할이면 자동 배치다.
 */
function cellStyle(
  id: string,
  focus: string | null,
  side: number,
  rest: WallRest,
): CSSProperties | undefined {
  if (focus === null) return undefined;
  if (rest === 'below') return id === focus ? { gridColumn: '1 / -1', gridRow: 1 } : { gridRow: 2 };
  if (id === focus) return { gridColumn: 1, gridRow: `1 / span ${side}` };
  return { gridColumn: 2 };
}

export function CctvWall({
  ids,
  tile,
  focusable = true,
  rest = 'side',
}: {
  ids: readonly string[];
  tile: (id: string, state: WallTile) => ReactNode;
  /** false 면 크게 보기를 두지 않는다(영상이 없는 상태만 보이는 화면). */
  focusable?: boolean;
  /** 크게 볼 때 나머지 칸을 옆(기본)·아래 줄 중 어디에 둘지. */
  rest?: WallRest;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // 크게 보던 카메라가 목록에서 빠지면 4분할로 돌아간다.
  const focus =
    focusable && ids.length > 1 && picked !== null && ids.includes(picked) ? picked : null;
  const side = ids.length - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {focus && (
        <div className="flex justify-end">
          <Button
            size="icon-lg"
            className="shadow-float"
            aria-label="4분할로 돌아가기"
            title="4분할로 돌아가기"
            onClick={() => setPicked(null)}
          >
            <Undo2 aria-hidden className="size-5" />
          </Button>
        </div>
      )}
      <div className="[container-type:size] flex min-h-0 flex-1 items-start justify-center">
        <div
          className="grid gap-(--gap)"
          style={layoutStyle(ids.length, side, focus !== null, rest)}
        >
          {ids.map((id) => (
            <div key={id} className="min-h-0 min-w-0" style={cellStyle(id, focus, side, rest)}>
              {tile(id, {
                focused: id === focus,
                toggle: () => {
                  if (focusable) setPicked(focus === id ? null : id);
                },
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
