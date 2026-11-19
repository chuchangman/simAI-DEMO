import { EditExitButton } from '@/features/monitor/EditExitButton';
import { MonitorSideColumn } from '@/features/monitor/MonitorSideColumn';
import { MonitorStandby } from '@/features/monitor/MonitorStandby';
import { useMonitorWorks } from '@/features/monitor/useMonitorWorks';
import { useMonitorStandby } from '@/features/monitor/useTodayWorks';
import { useWorkZonesRefresh } from '@/features/monitor/useWorkZonesRefresh';
import { useZoneEditActive } from '@/features/monitor/useZoneEditActive';
import { ZonesPage } from '@/features/zones/ZonesPage';
import { stopZoneEdit } from '@/store/zoneEditMode.store';
import { useEffect } from 'react';

/**
 * 실시간 관제. 관리자 편집 모드가 켜져 있으면 장면 위에 구역 편집을 얹는다(구역 목록에서 들어가고 그 패널 위의 편집 끝내기를
 * 누르면 나온다. 저장·추가 뒤에도 편집을 이어 가 여러 구역을 연달아 고친다, S15P31A101-651). 이 화면을 떠나면 편집 모드만
 * 끄고 고치던 초안은 남긴다. 편집 중이 아니면 왼쪽에 구역 목록 칼럼을 두고, 오늘 남은 작업이 없을 때 대기 화면을 띄운다(구역 편집 — 세팅·구역 발행은 작업 시작 전에 한다 — 은 막지
 * 않는다, S15P31A101-457). 대기 화면은 같은 층(z-6)에서 DOM 뒤쪽이라 칼럼을 덮고, 덮인 곳은 inert 로 키보드도 막는다.
 */
export function MonitorPage() {
  const works = useMonitorWorks({ passive: true });
  const active = works.state === 'ready' ? works.active : undefined;
  useWorkZonesRefresh(active?.work_id, works.state === 'ready');
  const editing = useZoneEditActive();
  const standby = useMonitorStandby();
  useEffect(() => stopZoneEdit, []);
  return (
    <>
      <h1 className="sr-only">실시간 관제</h1>
      {editing && <ZonesPage headerAction={<EditExitButton />} workLayoutId={active?.layout_id} />}
      {!editing && (
        <div inert={standby} className="contents">
          <MonitorSideColumn />
        </div>
      )}
      {!editing && <MonitorStandby />}
    </>
  );
}
