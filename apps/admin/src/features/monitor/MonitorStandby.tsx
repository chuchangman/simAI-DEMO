import { GpuPanel } from '@/features/gpu/GpuPanel';
import { useGpuKnownOff } from '@/features/gpu/useGpu';
import type { StandbyKind } from '@/features/monitor/todayWorks';
import { useTodayWorks } from '@/features/monitor/useTodayWorks';
import { Button } from '@simai/ui/components/button';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

/** 대기 화면 종류마다의 제목과 아랫줄(없으면 null). */
const STANDBY_TEXT: Record<StandbyKind, { title: string; detail: string | null }> = {
  setup: {
    title: '오늘 세팅이 끝나지 않았습니다',
    detail: '세팅을 마친 뒤 작업을 시작하면 경보가 켜집니다.',
  },
  ended: { title: '오늘 작업이 끝났습니다', detail: null },
};

function Standby({ kind }: { kind: StandbyKind }) {
  const navigate = useNavigate();
  const { title, detail } = STANDBY_TEXT[kind];
  // GPU 가 꺼져 있다고 확실히 알면 그것이 첫 줄이고 주 행동은 「GPU 켜기」다(S15P31A101-752). 켜진 뒤에도 남은 일(세팅·작업)은 아랫줄에 둔다.
  const gpuOff = useGpuKnownOff();
  const [panel, setPanel] = useState(false);
  return (
    <section
      aria-label="관제 대기"
      // 같은 z-6 에서는 DOM 에서 뒤에 그린 쪽이 위다. 이 화면보다 앞에 그린 층(장면·도구 모음 등)은 아래로 가고, 경보 배너·이벤트 패널·
      // 상세·CCTV 분할·하단 메뉴는 Outlet 뒤에서 그려져 위에 그대로 뜬다.
      className="pointer-events-auto absolute inset-0 z-[6] flex items-center justify-center bg-background/95 pr-[370px]"
    >
      <div className="flex max-w-[420px] flex-col items-center gap-3 text-center">
        {gpuOff ? (
          <>
            <h2 className="text-xl font-bold">GPU 꺼짐</h2>
            <p className="text-muted-foreground">
              GPU 를 켜야 카메라 추적과 위험 판정이 시작됩니다. {title}
              {detail ? ` ${detail}` : ''}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setPanel(true)}>GPU 켜기</Button>
              <Button variant="secondary" onClick={() => void navigate({ to: '/work' })}>
                작업 관리로
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold">{title}</h2>
            {detail && <p className="text-muted-foreground">{detail}</p>}
            <Button onClick={() => void navigate({ to: '/work' })}>작업 관리로</Button>
          </>
        )}
      </div>
      {panel && <GpuPanel onClose={() => setPanel(false)} />}
    </section>
  );
}

/**
 * 지금 관제할 작업(작업 중이거나 세팅을 마친 작업)이 없을 때 관제 화면 대신 보이는 대기 화면(S15P31A101-457, 조건은 -486 에서 오늘 기준으로,
 * 세팅 기준은 -633 에서). 오늘 작업이 모두 끝났으면 세팅 대신 끝났다고 알린다. 작업 목록을 받는 중이거나 받지 못했으면 "없음"을 알 수 없으므로 그리지 않는다.
 */
export function MonitorStandby() {
  const works = useTodayWorks();
  if (works.state !== 'ready' || works.standby === null) return null;
  return <Standby kind={works.standby} />;
}
