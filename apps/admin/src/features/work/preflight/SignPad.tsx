import { cn } from '@simai/ui/lib/utils';
import { useEffect, useImperativeHandle, useRef, type PointerEvent, type Ref } from 'react';

// 손서명 캔버스. 포인터 이벤트라 마우스·터치·펜이 모두 그려진다. 그린 획이 있는지는 onInkChange 로 알리고,
// 서명 이미지는 PNG(Blob)로 꺼낸다(서버는 256KiB 이하 PNG 만 받는다).

/** 패드 높이(CSS px). 너비는 놓인 칸을 따른다. */
const PAD_HEIGHT = 160;
const PEN_WIDTH = 2.5;
const PEN_COLOR = '#0b2140';

/** 부모가 패드를 지우거나 이미지를 꺼낼 때 쓰는 손잡이. */
export interface SignPadHandle {
  /** 지금 그림을 PNG 로 바꾼다(그릴 수 없는 환경이면 null). */
  toBlob(): Promise<Blob | null>;
  /** 그림을 지운다(획 없음으로 돌아가 onInkChange(false) 를 부른다). */
  clear(): void;
}

type Point = { x: number; y: number };

export function SignPad({
  ref,
  onInkChange,
  className,
}: {
  ref?: Ref<SignPadHandle>;
  /** 획이 처음 생기거나(true) 지워졌을 때(false) 한 번 부른다. */
  onInkChange: (hasInk: boolean) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<Point | null>(null);
  const ink = useRef(false);

  const context = () => canvasRef.current?.getContext('2d') ?? null;

  // 칸 너비·화면 배율에 캔버스 해상도를 맞춘다. 그려 둔 획은 새 크기로 늘려 남긴다.
  const fit = () => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    const cssWidth = canvas.clientWidth;
    if (!cssWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(PAD_HEIGHT * dpr);
    if (canvas.width === width && canvas.height === height) return;
    let snapshot: HTMLCanvasElement | null = null;
    if (ink.current) {
      snapshot = document.createElement('canvas');
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
    }
    canvas.width = width;
    canvas.height = height;
    if (snapshot) {
      const scale = width / snapshot.width;
      ctx.drawImage(snapshot, 0, 0, snapshot.width * scale, snapshot.height * scale);
    }
  };

  useEffect(() => {
    fit();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
    // fit 은 refs 만 읽어 렌더마다 같게 동작한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    toBlob: () =>
      new Promise<Blob | null>((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas) resolve(null);
        else canvas.toBlob(resolve, 'image/png');
      }),
    clear: () => {
      const canvas = canvasRef.current;
      context()?.clearRect(0, 0, canvas?.width ?? 0, canvas?.height ?? 0);
      drawing.current = false;
      last.current = null;
      ink.current = false;
      onInkChange(false);
    },
  }));

  // 화면 좌표를 캔버스 픽셀 좌표로.
  const pointOf = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / (rect.width || 1),
      y: ((event.clientY - rect.top) * canvas.height) / (rect.height || 1),
    };
  };

  const setPen = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = PEN_COLOR;
    ctx.fillStyle = PEN_COLOR;
    ctx.lineWidth = PEN_WIDTH * (window.devicePixelRatio || 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    fit();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 합성 이벤트·지원하지 않는 환경: 캡처 없이 그린다.
    }
    drawing.current = true;
    const point = pointOf(event);
    last.current = point;
    const ctx = context();
    if (ctx) {
      setPen(ctx);
      ctx.beginPath();
      ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!ink.current) {
      ink.current = true;
      onInkChange(true);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const from = last.current;
    const ctx = context();
    if (!drawing.current || !from || !ctx) return;
    const point = pointOf(event);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    last.current = point;
  };

  const stop = () => {
    drawing.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      aria-label="서명 패드"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      style={{ height: PAD_HEIGHT }}
      className={cn(
        'block w-full cursor-crosshair touch-none rounded-lg border border-border bg-white',
        className,
      )}
    />
  );
}
