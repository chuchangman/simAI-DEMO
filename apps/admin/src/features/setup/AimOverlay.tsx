import { AIM_OVERLAY_OPACITY, type AimCameraView } from '@/features/setup/aimCheck';
import { videoBox } from '@/features/setup/CameraCue';
import { useId } from 'react';

// 기준 시점 맞추기 표시(S15P31A101-765): 한 카메라 영상 위에 기준 사진(반투명, 켰을 때만)·가운데 십자선·목표 점(기준 영상 중심이 지금
// 영상에 보이는 곳)·돌릴 쪽 화살표를 얹는다. 목표 점이 가운데 십자선에 오도록 카메라를 돌리면 기준과 같은 방향이다.
// 영상은 칸 안에 비율대로 담기므로(CameraCue 와 같이) 영상이 실제로 그려지는 사각형 안에서 위치를 잡는다.

/** 목표 점이 영상 밖일 때 화살표 길이(영상 짧은 변의 비율). */
const ARROW_LENGTH = 0.22;
const CROSS = 4;

function arrowEnd(aim: AimCameraView, aspect: number): readonly [number, number] | null {
  if (aim.arrowRad === null) return null;
  if (aim.target) return [aim.target[0] * 100, aim.target[1] * 100];
  // 길이 = 짧은 변 × ARROW_LENGTH. 가로·세로 백분율로 나눠 방향이 영상 비율에 눌리지 않게 한다
  return [
    50 + Math.cos(aim.arrowRad) * ARROW_LENGTH * 100 * Math.min(1, 1 / aspect),
    50 + Math.sin(aim.arrowRad) * ARROW_LENGTH * 100 * Math.min(aspect, 1),
  ];
}

export function AimOverlay({
  aim,
  aspect,
  imageUrl,
}: {
  /** 이 카메라의 기준 시점 맞추기. 없으면 표시 없이 기준 사진만(켰을 때). */
  aim: AimCameraView | null;
  aspect: number;
  /** 겹쳐 볼 기준 사진 주소. 끄면 undefined. */
  imageUrl?: string;
}) {
  const headId = `aim-head-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const known = aim !== null && aim.status !== 'UNKNOWN';
  if (!known && !imageUrl) return null;
  const end = known ? arrowEnd(aim, aspect) : null;
  return (
    <div
      aria-hidden
      className="[container-type:size] pointer-events-none absolute inset-0 grid place-items-center"
    >
      <div className="relative" style={videoBox(aspect)}>
        {imageUrl && (
          <img
            data-testid="aim-reference-image"
            src={imageUrl}
            alt=""
            className="absolute inset-0 size-full"
            style={{ opacity: AIM_OVERLAY_OPACITY }}
          />
        )}
        {known && (
          <svg
            data-testid="aim-marks"
            className="absolute inset-0 size-full overflow-visible"
            stroke="currentColor"
          >
            <defs>
              <marker
                id={headId}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="white" stroke="none" />
              </marker>
            </defs>
            {[
              ['black', 4],
              ['white', 2],
            ].map(([color, width]) => (
              <g
                key={color}
                stroke={String(color)}
                strokeWidth={Number(width)}
                strokeLinecap="round"
              >
                <line x1={`${50 - CROSS}%`} y1="50%" x2={`${50 + CROSS}%`} y2="50%" />
                <line
                  x1="50%"
                  y1={`${50 - CROSS * aspect}%`}
                  x2="50%"
                  y2={`${50 + CROSS * aspect}%`}
                />
              </g>
            ))}
            {end && (
              <line
                data-testid="aim-arrow"
                x1="50%"
                y1="50%"
                x2={`${end[0]}%`}
                y2={`${end[1]}%`}
                stroke="white"
                strokeWidth={3}
                markerEnd={`url(#${headId})`}
                className="drop-shadow-[0_1px_2px_rgb(0_0_0/0.7)]"
              />
            )}
            {aim.target && (
              <g data-testid="aim-target">
                <circle
                  cx={`${aim.target[0] * 100}%`}
                  cy={`${aim.target[1] * 100}%`}
                  r={9}
                  fill="none"
                  stroke="black"
                  strokeWidth={4}
                />
                <circle
                  cx={`${aim.target[0] * 100}%`}
                  cy={`${aim.target[1] * 100}%`}
                  r={9}
                  fill="none"
                  stroke={aim.aligned ? 'var(--ok)' : aim.setupReady ? 'var(--delay)' : 'white'}
                  strokeWidth={2}
                />
              </g>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
