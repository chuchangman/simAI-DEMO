import { useMemo } from 'react';
import { encode } from 'uqr';

// 휴대폰 보강 촬영 화면 주소의 QR(S15P31A101-607). 다크 모드에서도 읽히도록 종이(.paper) 바탕에 글자색으로 칸을 그린다.

/** QR 칸 행렬을 SVG 경로 하나로 바꾼다(칸마다 1×1 사각형). */
export function qrPath(data: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  data.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) parts.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return parts.join('');
}

export function SupplementQr({ value, size = 136 }: { value: string; size?: number }) {
  const { path, modules } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    return { path: qrPath(qr.data), modules: qr.size };
  }, [value]);
  return (
    <div className="paper flex-none rounded-lg bg-card p-1 text-card-foreground">
      <svg
        role="img"
        aria-label="휴대폰으로 열 주소 QR"
        width={size}
        height={size}
        viewBox={`0 0 ${modules} ${modules}`}
        shapeRendering="crispEdges"
      >
        <path d={path} fill="currentColor" />
      </svg>
    </div>
  );
}
