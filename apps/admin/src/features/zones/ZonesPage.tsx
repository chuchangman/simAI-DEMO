import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { OrphanSurfaceCard } from '@/features/zones/OrphanSurfaceCard';
import { SurfaceCard } from '@/features/zones/SurfaceCard';
import { UnpublishedRetry } from '@/features/zones/UnpublishedRetry';
import { useZoneEditing } from '@/features/zones/useZoneEditing';
import { ZoneActions } from '@/features/zones/ZoneActions';
import { ZoneAttributesCard } from '@/features/zones/ZoneAttributesCard';
import {
  NOTE_CLASS,
  PANEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  WARNING_CLASS,
  type ZonePanelPlacement,
} from '@/features/zones/zonePanelStyle';
import { ZoneSelect } from '@/features/zones/ZoneSelect';
import { ZoneSizeCard } from '@/features/zones/ZoneSizeCard';
import { Button } from '@simai/ui/components/button';
import type { ReactNode } from 'react';

/** 직사각형이 아니거나 높이가 없거나 바닥 판정이라 3D 손잡이로 고칠 수 없는 구역을 골랐을 때 알림. */
const SHAPE_LOCKED_TEXT =
  '직사각형이 아니거나 높이가 없거나 바닥 판정인 구역은 형상을 고칠 수 없습니다.';

interface ZonesPageProps {
  setupLayoutSync?: import('@/features/setup/useSetupLayoutSync').SetupLayoutSync;
  /** 관제 편집 모드는 3D 위 왼쪽에 띄우고(float), 세팅의 구역 단계는 3D 옆 칸에 놓는다(inline). */
  placement?: ZonePanelPlacement;
  workLayoutId?: number | null;
  /** 구역 고르기 줄 오른쪽에 붙는 버튼(addOnDemand 로 접혀 있는 동안에는 줄째 보이지 않는다). */
  headerAction?: ReactNode;
  /** 저장·추가가 발행까지 끝났을 때 부른다(관제는 넘기지 않아 저장 뒤에도 편집 끝내기 전까지 편집을 이어 간다). */
  onCommitted?: () => void;
  /**
   * 새 구역 양식을 '구역 추가' 단추를 눌러야 연다(세팅의 구역 단계: AI 초안을 먼저 보이고 놓친 곳만 사람이 더한다). 기존 구역을
   * 고르기 전까지 패널은 단추 하나만 보이고, 추가에 성공하거나 취소하면 다시 접힌다. 기본은 양식이 늘 열려 있다.
   */
  addOnDemand?: boolean;
}

/**
 * 구역 편집 도구(명세 FR-15·FR-16): 관제에서는 3D 위 왼쪽 패널, 세팅의 구역 단계에서는 3D 옆 칸. 관리자가 아니면 아무것도
 * 그리지 않는다(실시간 관제의 편집 모드는 관리자에게만 열리지만 세팅 화면은 역할을 확인하지 않아 여기서 막는다). 관제는 편집
 * 끝내기 버튼(headerAction)을 넘기고 저장 뒤에도 편집을 이어 가며(S15P31A101-651), 세팅 화면은 자리(inline)만 넘긴다.
 */
export function ZonesPage(props: ZonesPageProps) {
  const isAdmin = useCurrentRole() === 'ADMIN';
  return isAdmin ? <ZoneEditPanel {...props} /> : null;
}

/**
 * 드롭다운 하나(새 구역 추가 · 기존 구역), 이름·심각도, 고소 작업면(구역에 하나), 버튼. 3D 손잡이는 고른 구역(또는 새 구역·
 * 작업면)의 상자를 고친다. 저장하면 구역·작업면·현장 판정 발행을 요청 하나로 보낸다. 3D 에서 화면에서 닿을 수 없는 작업면을
 * 누르면 구역 대신 그 작업면을 삭제하는 카드를 보인다. addOnDemand 이면 양식은 접혀 있다가 '구역 추가'를 눌러야 나온다.
 */
function ZoneEditPanel({
  placement = 'float',
  headerAction,
  onCommitted,
  workLayoutId,
  setupLayoutSync,
  addOnDemand,
}: ZonesPageProps) {
  const edit = useZoneEditing(onCommitted, workLayoutId, setupLayoutSync, addOnDemand);
  // 작업면 카드가 구역 양식을 가린 동안에는 가려진 구역의 형상 경고를 띄우지 않는다.
  const shapeLocked = edit.orphan === null && edit.shapeLocked;
  const warning = edit.notice ?? (shapeLocked ? SHAPE_LOCKED_TEXT : null);

  return (
    <section aria-label="구역 편집 도구" className={PANEL_CLASS[placement]}>
      {!edit.collapsed && (
        <div className="flex items-center gap-2">
          <ZoneSelect edit={edit} />
          {headerAction}
        </div>
      )}

      {edit.zonesFailed && (
        <p role="alert" className={NOTE_CLASS}>
          구역 목록을 불러오지 못했습니다.
        </p>
      )}

      {edit.showRetry && <UnpublishedRetry onRetry={() => void edit.republish()} />}

      {warning && (
        <p role="status" className={WARNING_CLASS}>
          {warning}
        </p>
      )}

      {edit.collapsed ? (
        <Button onClick={edit.openAdd} className={`${PRIMARY_BUTTON_CLASS} w-full`}>
          구역 추가
        </Button>
      ) : edit.orphan ? (
        <OrphanSurfaceCard edit={edit} surface={edit.orphan} />
      ) : (
        <>
          <ZoneAttributesCard edit={edit} />
          <SurfaceCard edit={edit} />
          <ZoneSizeCard edit={edit} />
          <ZoneActions edit={edit} />
        </>
      )}
    </section>
  );
}
