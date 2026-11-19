import { GpuInfoLines } from '@/features/gpu/GpuInfoLines';
import { GpuPanel } from '@/features/gpu/GpuPanel';
import { DOT_LABEL, type GpuDot } from '@/features/gpu/gpuStatus';
import { useGpuStatus } from '@/features/gpu/useGpu';
import { useGpuPresence } from '@/features/gpu/useGpuPresence';
import { cn } from '@simai/ui/lib/utils';
import { useState } from 'react';

// 상단바 GPU 점(S15P31A101-702, 사용자 결정 2026-11-14): 점 + 「GPU」 글자만 둔다(-705: 상태 글은 빼고 점 색·깜빡임으로).
// 초록 연결 / 노랑(깜빡임) 준비 중 / 회색 꺼짐 / 빨강 오류. 상태 글(「GPU 연결」 등)은 정보창 첫 줄과 화면 읽기 이름에 남긴다.
// 마우스를 올리면(또는 초점) 작은 정보창(상태, 종류·지역, 경과·예상 비용, 판정 지연, 준비 단계). 누르면 켜기·끄기 패널(관리자만).
// 점 색은 사용자가 정한 신호등 색이다(front/CONVENTION.md 의 위험 등급 색 규칙 예외, -704 카메라 지연 배지와 같다).

const DOT_COLOR: Record<GpuDot, string> = {
  CONNECTED: 'bg-ok',
  PREPARING: 'bg-sev-caution motion-safe:animate-pulse',
  OFF: 'bg-muted-foreground/60',
  ERROR: 'bg-sev-critical',
};

export function GpuIndicator() {
  const { isAdmin, status, dot } = useGpuStatus();
  // 상단바는 관리자 화면마다 있으므로 여기서 조작 신호를 보낸다(GPU 가 켜져 있을 때만, -708)
  useGpuPresence(isAdmin && status?.power !== undefined && status.power !== 'OFF');
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const label = DOT_LABEL[dot];

  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <button
        type="button"
        data-testid="gpu-indicator"
        data-dot={dot}
        aria-label={label}
        aria-haspopup={isAdmin ? 'dialog' : undefined}
        disabled={!isAdmin}
        onClick={() => {
          setHover(false);
          setOpen(true);
        }}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm whitespace-nowrap enabled:hover:bg-secondary disabled:cursor-default"
      >
        <span aria-hidden className={cn('size-2 rounded-full', DOT_COLOR[dot])} />
        <span aria-hidden>GPU</span>
      </button>
      {hover && !open && (
        <div
          role="tooltip"
          className="absolute top-full right-0 z-50 mt-1.5 w-max max-w-xs rounded-md bg-popover px-3 py-2 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <span className="block text-sm font-semibold">{label}</span>
          <GpuInfoLines />
          {isAdmin && dot === 'OFF' && (
            <span className="mt-1 block text-xs text-muted-foreground">눌러서 켜기</span>
          )}
        </div>
      )}
      {open && <GpuPanel onClose={() => setOpen(false)} />}
    </div>
  );
}
