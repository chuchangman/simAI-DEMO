import { useCamSplitStore } from '@/features/cctv/camSplit.store';
import { AlarmBanner } from '@/features/events/AlarmBanner';
import { AlarmSoundLoop } from '@/features/events/AlarmSoundLoop';
import { useEventsStore } from '@/features/events/events.store';
import { Dock } from '@/features/layout/Dock';
import { SpatialViewportHost } from '@/features/layout/SpatialViewportHost';
import { TopBar } from '@/features/layout/TopBar';
import { useHealthSnapshot } from '@/features/layout/useHealthSnapshot';
import { PpePolicyNotice } from '@/features/monitor/PpePolicyNotice';
import { WorkPpeStatus } from '@/features/monitor/WorkPpeStatus';
import { WorkSessionBar } from '@/features/monitor/WorkSessionBar';
import { usePpeSnapshot } from '@/features/ppe/usePpe';
import { WatchBindNotice } from '@/features/watch/WatchBindNotice';
import { WatchEscalationNotice } from '@/features/watch/WatchEscalationNotice';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { Outlet, useMatches } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * 장면 위에 뜬 알림(경보 배너·작업 세션 바 등)이 차지하는 높이를 `--notices-h` 로 알린다(없으면 0).
 * 장면 위 큰 창(사건 상세)이 알림을 가리지 않고 그 아래에서 시작하게 한다.
 */
function useNoticesHeight(
  notices: RefObject<HTMLDivElement | null>,
  root: RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    const el = notices.current;
    const host = root.current;
    if (!el || !host || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => {
      // 상단 바 아래 12px 틈에서 시작하므로, 알림이 있으면 그 틈과 아래 8px 틈을 더한다.
      const h = el.offsetHeight;
      host.style.setProperty('--notices-h', h > 0 ? `${h + 20}px` : '0px');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [notices, root]);
}

/**
 * 알림이 양쪽에서 비키는 간격(클래스). 실시간 관제는 오른쪽 이벤트 패널 자리만큼, 사건 분할 창이 열리면 그 창 자리만큼
 * 양쪽을 같은 크기로 비워 가운데에 서게 한다(왼쪽은 도구 모음 자리다). 간격 값은 index.css 의 변수다.
 */
const noticeInset = (eventPanel: boolean, camSplitOpen: boolean) => {
  if (!eventPanel) return 'inset-x-5';
  return camSplitOpen ? 'inset-x-(--cam-split-inset)' : 'inset-x-(--event-panel-inset)';
};

/**
 * 상단 바 아래 알림: 경보 배너(실시간 관제는 그 아래에 작업 세션 바). 모든 화면에서 내용 위에 띄우고 본문을 밀거나 줄이지 않는다
 * (관제 데모와 같다). 알릴 것이 없으면 숨는다.
 */
function Notices({
  ref,
  eventPanel,
  banner,
}: {
  ref: RefObject<HTMLDivElement | null>;
  eventPanel: boolean;
  /** 경보 배너를 이 알림 영역에 띄운다(띠로 따로 두는 화면이면 false). */
  banner: boolean;
}) {
  const camSplitOpen = useCamSplitStore((s) => s.split !== null);
  return (
    <div
      ref={ref}
      role="region"
      aria-label="알림"
      className={cn(
        'pointer-events-none absolute top-[72px] z-[6] flex flex-col items-center gap-2 empty:hidden',
        noticeInset(eventPanel, camSplitOpen),
      )}
    >
      {banner && <AlarmBanner withPanel={eventPanel} />}
      {eventPanel && <WorkSessionBar />}
      {eventPanel && <WorkPpeStatus />}
      {eventPanel && <PpePolicyNotice />}
      {eventPanel && <WatchBindNotice />}
      <WatchEscalationNotice />
    </div>
  );
}

/**
 * 좁은 화면(휴대폰, 768px 미만)에서는 1280px 배치를 줄여 보이지 않고 안내만 보인다(S15P31A101-752). 급히 상태를 봐야 하면 「그래도 데스크톱 화면 보기」로 가로 스크롤 배치를 열 수 있고, 선택은 이 탭(sessionStorage)에 기억한다. 관제·작업 관리는 PC 화면용이다.
 * 반장 휴대폰 화면(PWA)은 폐기되어(명세 수정 63) 보낼 곳이 없으므로 링크는 두지 않는다. 나머지 화면은 CSS 로만 숨겨 상태는 그대로 둔다.
 */
function DesktopOnlyNotice({ onForce }: { onForce: () => void }) {
  return (
    <div
      role="region"
      aria-label="데스크톱 화면 안내"
      className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-4 text-center md:hidden"
    >
      <p className="text-lg font-bold">데스크톱 화면입니다</p>
      <p className="max-w-[320px] text-sm text-muted-foreground">
        관제와 작업 관리는 PC 에서 가로 1280px 이상의 화면으로 열어 주세요. 휴대폰에서는 이 화면을
        쓸 수 없습니다.
      </p>
      <Button variant="secondary" onClick={onForce}>
        그래도 데스크톱 화면 보기
      </Button>
    </div>
  );
}

const FORCE_DESKTOP_KEY = 'simai.forceDesktop';

function readForceDesktop(): boolean {
  try {
    return sessionStorage.getItem(FORCE_DESKTOP_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppLayout() {
  const [forceDesktop, setForceDesktop] = useState(readForceDesktop);
  const showDesktop = () => {
    setForceDesktop(true);
    try {
      sessionStorage.setItem(FORCE_DESKTOP_KEY, '1');
    } catch {
      // 저장하지 못해도 이번 화면에서는 보인다.
    }
  };
  const fullBleed = useMatches({
    select: (matches) => matches.some((m) => m.staticData.fullBleed),
  });
  const eventPanel = useMatches({
    select: (matches) => matches.some((m) => m.staticData.eventPanel),
  });
  const dockOverlay = useMatches({
    select: (matches) => matches.some((m) => m.staticData.dockOverlay),
  });
  const openEvent = useEventsStore((s) => s.openEvent);
  const root = useRef<HTMLDivElement>(null);
  const noticesRef = useRef<HTMLDivElement>(null);
  useNoticesHeight(noticesRef, root);
  // 연결이 (다시) 열리면 /topic/health 를 기다리지 않고 지금 상태를 먼저 채운다(GET /api/health).
  useHealthSnapshot();
  // 사람별 안전모·조끼 상태도 연결마다 지금 값을 먼저 채운다(GET /api/ppe/current, S15P31A101-531).
  usePpeSnapshot();

  // 로그아웃으로 이 레이아웃을 벗어나면 연 이벤트를 닫는다. 다음 계정에 이전 화면 상태가 남지 않게 한다.
  useEffect(() => () => openEvent(null), [openEvent]);

  return (
    <>
      {!forceDesktop && <DesktopOnlyNotice onForce={showDesktop} />}
      <div
        ref={root}
        className={cn(
          'relative flex h-svh min-h-[600px] min-w-[1280px] flex-col overflow-hidden bg-background text-[15px] leading-[22px]',
          !forceDesktop && 'max-md:hidden',
        )}
      >
        <div className={cn('relative z-[7] flex-none', fullBleed && 'absolute inset-x-0 top-0')}>
          <TopBar floating={fullBleed} />
        </div>
        {/* 작업 관리 같은 일반 화면은 배너가 달력 「오늘」·「출력」 단추를 가리지 않게 상단 바 아래 띠로 둔다(S15P31A101-757). */}
        {!eventPanel && !fullBleed && (
          <div
            data-testid="alarm-strip"
            className="pointer-events-none relative z-[6] flex flex-none justify-center px-5 pt-2 empty:hidden"
          >
            <AlarmBanner withPanel={false} />
          </div>
        )}
        <div className={cn('relative flex min-h-0 flex-1', fullBleed && 'absolute inset-0')}>
          {fullBleed ? (
            <SpatialViewportHost eventPanel={eventPanel}>
              <Outlet />
            </SpatialViewportHost>
          ) : (
            <main
              className={cn(
                'relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto bg-blueprint px-5 pt-3.5',
                dockOverlay ? 'pb-3.5' : 'pb-[90px]',
              )}
            >
              <Outlet />
            </main>
          )}
          <Dock />
        </div>
        <Notices
          ref={noticesRef}
          eventPanel={eventPanel}
          banner={eventPanel || fullBleed}
        />
        <AlarmSoundLoop />
      </div>
    </>
  );
}
