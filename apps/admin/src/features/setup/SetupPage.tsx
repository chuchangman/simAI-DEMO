import { useIsDemoAccount } from '@/features/demo/demoAccount';
import {
  claimDemoNewMap,
  isDemoNewMap,
  requestDemoNewMap,
  useSetupWaitingView,
} from '@/features/demo/demoNewMap';
import { demoReuseOpen, demoReuseShown, useDemoCoverage } from '@/features/demo/demoSetup';
import {
  DEMO_DRAFT_SEARCH_TEXT,
  useDemoZoneDrafts,
  withDraftHighlight,
} from '@/features/demo/demoZoneDrafts';
import { GpuPanel } from '@/features/gpu/GpuPanel';
import { useGpuStatus } from '@/features/gpu/useGpu';
import { useGpuGate } from '@/features/gpu/useGpuGate';
import { PageTitle } from '@/features/layout/PageTitle';
import {
  useAbandonedSetupStore,
  useIsAbandonedSetupSession,
} from '@/features/setup/abandonedSetup.store';
import {
  cancelSetupSession,
  requestWorkUnitSetupSessionId,
  setupSessionKey,
  setupWorkUnitSessionKey,
  setupZonePlanKey,
} from '@/features/setup/api';
import { BackgroundCaptureModal } from '@/features/setup/BackgroundCaptureModal';
import { isSetupSessionRunning } from '@/features/setup/blockingSetup';
import { BlockingSetupNotice } from '@/features/setup/BlockingSetupNotice';
import {
  cameraCheckBlockReason,
  cameraCheckFailed,
  deriveCameraCheckView,
  deriveCameraWalkView,
} from '@/features/setup/cameraCheck';
import { CameraCheckModal } from '@/features/setup/CameraCheckModal';
import { CameraRiskDialog } from '@/features/setup/CameraRiskDialog';
import { heightsChanged } from '@/features/setup/heightCheck';
import { HeightCheckModal } from '@/features/setup/HeightCheckModal';
import { calibrateNextStep, step1NextStep } from '@/features/setup/nextStep';
import {
  deriveHeightFields,
  deriveStep1Coverage,
  draftGhostsOf,
  pausedForHeights,
  resolveHeightCameraIds,
  sessionSceneVersion,
  STEPS,
  validateHeightFields,
  ZONE_STAGE,
  zoneMapTitle,
  type Stage,
} from '@/features/setup/setup';
import {
  discardSetupZoneDraft,
  followServerSetupSession,
  resetSetupFlowStore,
  setActiveSetupSessionId,
  useSetupFlowStore,
} from '@/features/setup/setup.store';
import { deriveSetupActions, toWorkAction } from '@/features/setup/setupActions';
import { SetupCalibrateStep } from '@/features/setup/SetupCalibrateStep';
import {
  canCompleteSetup,
  SetupCompleteCard,
  setupCompleted,
} from '@/features/setup/SetupCompleteCard';
import {
  blockedLiveWorkId,
  isSetupBlockedByLiveWork,
  setupCancelErrorMessage,
} from '@/features/setup/setupErrorMessage';
import { SetupMap } from '@/features/setup/SetupMap';
import { SetupModeChoice } from '@/features/setup/SetupModeChoice';
import {
  AiZoneDraftsPanel,
  CameraHeightPanel,
  CameraStatusDetails,
  CameraVideoPanel,
  NextStepCard,
} from '@/features/setup/SetupPanels';
import { SetupSplit } from '@/features/setup/SetupPreviewModel';
import { pendingReviewCount, type SetupZonePlanView } from '@/features/setup/setupZonePlan';
import { SetupZoneReviewCard } from '@/features/setup/SetupZoneReviewCard';
import { SetupZoneStep } from '@/features/setup/SetupZoneStep';
import { supplementVisible } from '@/features/setup/supplement';
import { SupplementModal } from '@/features/setup/SupplementModal';
import type { SetupMode, SetupSessionResponse, ZoneDraftItem } from '@/features/setup/types';
import { useAcceptZoneDraft } from '@/features/setup/useAcceptZoneDraft';
import { useBackgroundCapture } from '@/features/setup/useBackgroundCapture';
import { useWalkCountdown } from '@/features/setup/useCameraWalk';
import { useCompleteSetup } from '@/features/setup/useCompleteSetup';
import { chosenReuseMap, useReuseChoice } from '@/features/setup/useReuseScene';
import { reviewsCarriedZones, useSeedSetupZonePlan } from '@/features/setup/useSeedSetupZonePlan';
import { useSetupLayoutSync } from '@/features/setup/useSetupLayoutSync';
import {
  useCameraHeightDefaults,
  useCoverageExpired,
  useCoverageGuides,
  useCoverageHelperLost,
  useCreateSetupSession,
  useResumeSetupSession,
  useRetrySetupSession,
  useSetupSession,
  useSetupZoneDrafts,
  useStartCameraCheck,
} from '@/features/setup/useSetupStep1';
import { useSetupZonePlanQuery } from '@/features/setup/useSetupZonePlan';
import { useValidationRejections } from '@/features/setup/useValidationRejections';
import { VlmZoneNotice } from '@/features/setup/VlmZoneNotice';
import { pairDraftsWithCarried } from '@/features/setup/zoneOverlap';
import { useWorkAction } from '@/features/work/WorkActionContext';
import { useZones } from '@/features/zones/useZones';
import { ZoneSourceContext, type SetupZoneSource } from '@/features/zones/zoneSource';
import { ZonesPage } from '@/features/zones/ZonesPage';
import { api } from '@/lib/api';
import { Alert } from '@simai/ui/components/alert';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// 설치 · 보정(명세 8.1·13.4·18.1, S15P31A101-448·-453):
// 1단계: CCTV 4칸 실시간 미리보기, 카메라 각도 헬퍼(2~3초 폴링), 카메라별 실측 높이 입력, 「맵」 방식 선택(S15P31A101-689: 이전 맵 재사용이
// 기본이고 세션이 있든 실패·취소했든 늘 고를 수 있다. 이전 맵이 없거나 카메라가 직전 세팅과 달라졌으면 재사용을 끄고 이유를 두 줄로 보인다).
// 「세팅 취소」는 진행 중인 시도가 있으면 멈추고 세팅에서 나가고, 2단계의 「현재 시도 중단」은 시도만 멈추고 1단계로 돌아가 방식을 다시 고르게 한다.
// 새로고침·다른 탭: 작업의 서버 세션(work_unit.active_setup_session_id)을 주기로 보고, 다른 세션으로 바뀌었으면 그 세션의 단계·대기 창
// (배경 촬영·높이 확인)을 서버 세션 상태에서 다시 연다. 세팅이 구역 단계까지 갔으면(완료 또는 세션 구역 목록 저장) 구역 단계로 연다.
// 세션이 생기기 전에는 2·3단계로 갈 수 없다.
// 2단계(보정·생성): POST /api/setup-sessions 후 GET /api/setup-sessions/{id} 2초 주기 조회,
// 「지금 할 일」과 전체 진행 막대 하나(5단계 막대·단계별 %·경과 시간은 「자세히 · 진행 단계」),
// 실패 시 원인·해결 + 다시 시도(POST /api/setup-sessions/{id}/retry)·카메라 연결 관리로, 높이 불일치 시 카메라 다시 맞추기(1단계 복귀 후 재시도),
// 높이 확인 멈춤(paused_reason HEIGHT_CHECK)은 높이 확인 창이 같은 세션을 이어 간다(POST .../resume, -690),
// 3D 맵이 다 만들어지면 '다음' 으로 구역 단계에 간다(저절로 넘어가지 않는다).
// 1·2단계는 같은 두 칸 배치(SetupSplit)이고, 2단계 왼쪽은 카메라 영상 4칸이 끝까지 보이며 미리보기 맵이 생기면 「3D 미리보기」 탭이 켜진다.
// 3단계(구역): 왼쪽 큰 3D(SetupZoneStep)에서 구역 상자를 손잡이로 고치고, 오른쪽에
// 구역 편집 도구(ZonesPage) 및 AI 위험 구역 초안(GET /api/setup-sessions/{id}/zone-drafts, 3D 점선 윤곽, 수락하면 바로 구역 저장·버리기)을 둔다.
// 고화질 정식 Scene 도착 시 자동 교체(편집 초안 유지), 세팅 완료 뒤 작업 관리(/work?workUnitId=) 복귀.
// 단추(다음·다시 보정·세션 취소·카메라 다시 맞추기·작업 관리로)는 setupActions 가 한 곳에서 정한다. 단독 화면(/setup)은 머리줄에 그리고,
// 날짜 화면 안(embedded)은 같은 단추를 아래 오른쪽 단추 줄(useWorkAction)에 등록하며 구역 단계의 마지막 단추는 '다음'(onDone)이다.
// 「맵 보강 촬영(선택)」 창(SupplementModal, S15P31A101-607): 휴대폰 QR·PC 파일로 사각지대를 찍어 올리고 맵을 다시 굽는다. S15P31A101-691
// 부터 '다음' 에 끼어들지 않고 보정·생성의 「자세히 · 맵 보강」에서만 연다(창의 건너뛰기·다음은 창만 닫는다: '다음' 의 맵 완성 관문을 건너뛰지 않게).
// 화면 정리(S15P31A101-691): 카메라 영상 4칸은 1·2단계 끝까지 보이고(3D 미리보기는 탭), 칸마다 배지 하나(cameraBadge), 오른쪽은
// 「지금 할 일」 카드 한 장(nextStep: 무엇이 / 어떻게, '다음' 이 꺼진 이유 포함)과 입력(맵 방식·높이)만 두고 진단은 「자세히」로 접는다.
// 「카메라 높이 확인」 창(HeightCheckModal, S15P31A101-690): 3D 공간을 만든 직후 워커가 카메라 높이가 서로 맞지 않는다고 보면(paused_reason
// HEIGHT_CHECK) 1단계와 같은 높이 입력 칸을 크게 띄운다. 고친 값으로 진행하거나 「실측이 맞음」으로 진행하면(POST .../resume) 저절로 닫힌다.
// 「배경 촬영」 창(BackgroundCaptureModal, S15P31A101-686): 1단계 '다음' 이 먼저 이 창을 띄우고 「시작」을 눌러야 세션을 만든다. 세팅 시작 뒤 새로
// 찍은 화면만 쓰므로 카메라 앞을 비우게 하고, 카메라별 촬영 상태(사람 보임·영상 없음)를 보이다가 다 찍으면 저절로 닫힌다.
// 「카메라 확인」 걷기 창(CameraCheckModal, S15P31A101-687): 보정이 끝나면 맵을 굽기 전에 워커가 걷기 시작을 기다린다(서버 camera_check_phase).
// 「걷기 시작」을 눌러야 30초 걷기 확인이 시작되고(POST .../camera-check/start), 통과하면 저절로 닫히고 맵을 굽는다. 실패하면 보정은
// 그대로 두고 「확인만 다시(30초)」, 「현재 시도 중단」은 보조다. 창이 열린 동안 아래 칸 영상은 내린다(영상 연결은 한 번에 하나).
// 구역 단계의 마지막 단추가 세팅 완료(C17, S15P31A101-615)를 먼저 부르고(useCompleteSetup) 성공하면 넘어간다: 구역 목록 적용·이 세션 맵 켜기·
// 구성 묶음 발행을 한 번에 한다. 실패하면 구역 편집 아래에 안내하고 머문다. 완료하면 오른쪽 칸에는 「세팅 완료」 상태 카드만 남는다.
// 완료 전에는 관제 Scene 이 바뀌지 않으므로 구역 단계 3D 는 이 세션 맵을 버전으로 받아 그린다(-618 /view, 이전 모델 재사용은 맵이 없어 지금 관제 맵).
// 완료 뒤에는 구역 편집·AI 초안 수락을 감춘다(완료 뒤 구역 수정은 관제 화면 구역 편집).
// 완료 전 구역 단계의 구역 편집·AI 초안 수락·3D 구역 표시는 관제 구역이 아니라 세션 구역 목록(-612) 기준이다(ZoneSourceContext).
// 이전 모델 재사용은 구역 단계에 들어오면 빈 목록을 그 맵의 구역으로 한 번 채운다(useSeedSetupZonePlan, 서버 seed). 새 모델은 이전 구역을
// 기본으로 이어 오지 않고 AI 초안(시연은 개구부 하나)만으로 시작한다(S15P31A101-758). World 이어짐이면 오른쪽 칸 카드의 「이전 구역
// 불러오기」로 이전 구역을 '확인 필요'로 더해 「이어 쓴 구역 확인」에서 확인·수정·삭제한다(S15P31A101-629). 아직 수락하지 않은 AI 초안과
// 같은 자리인 이어 온 구역은 그 카드에서 한 항목으로 묶어 둘 중 하나만 남기고(초안 목록에서는 감춘다), 같은 개구부를 둘 만들지 않는다.
// 확인 필요가 남아 있으면 마지막 단추(세팅 완료)가 '확인 필요 n개'를 붙이고 꺼진다. World 가 끊긴 새 모델은 빈 목록에서 시작한다.

/**
 * 날짜 화면 안의 본문 높이: 화면 높이에서 틀(상단 바 60 + 본문 위 여백 14 + 날짜 줄 28·간격 14 + 아래 메뉴 자리 96)을 뺀 값이다.
 * 이렇게 묶어 두면 어느 단계에서도 페이지 스크롤이 생기지 않고, 긴 오른쪽 열은 그 안에서만 스크롤한다.
 * 바닥 360 = 단계 줄 42 + 간격 12 + 두 칸 최소 306(낮은 노트북 창에서도 페이지가 스크롤되지 않게).
 */
const EMBEDDED_BODY = 'h-[max(360px,calc(100dvh-212px))] flex-none';

/** 작업의 서버 세션을 다시 보는 주기(다른 탭·새로고침에서 바뀐 시도를 따라간다, S15P31A101-689). */
const WORK_SESSION_POLL_MS = 5_000;

const NO_DRAFTS: readonly ZoneDraftItem[] = [];
const NO_GHOSTS: ReturnType<typeof draftGhostsOf> = [];
/** 레이아웃 반영을 하지 않는 화면(날짜 화면 안)이 구역 저장에 넘기는 반영 함수. */
const skipLayoutSync = async () => {};

/** 구역 단계의 '다시 보정'을 눌렀을 때 묻는 글. */
const RESTART_CONFIRM_TEXT = '지금 세팅을 취소하고 다시 보정할까요?';
const RESTART_ZONES_LOST_TEXT = ' 이 세팅의 구역 목록은 새 세팅으로 넘어가지 않습니다.';

/** '다시 보정' 확인 글. 구역 목록은 세션마다 따로라 새 세팅으로 넘어가지 않으니 구역이 있으면 함께 알린다(-612). */
const restartConfirmText = (zoneCount: number): string =>
  zoneCount > 0 ? RESTART_CONFIRM_TEXT + RESTART_ZONES_LOST_TEXT : RESTART_CONFIRM_TEXT;

/** 작업 없이 세팅 화면을 열면 어느 작업의 세팅인지 모르므로 작업 관리로 돌려보낸다(작업 id 를 지어내지 않는다). */
function SetupNeedsWork() {
  const navigate = useNavigate();
  return (
    <>
      <PageTitle>설치 · 보정</PageTitle>
      <Alert role="status" data-testid="setup-needs-work" className="flex flex-col gap-2">
        <p className="text-sm font-semibold">어느 작업의 세팅인지 알 수 없습니다.</p>
        <p className="text-xs text-muted-foreground">
          현장 세팅은 작업마다 합니다. 작업 관리에서 작업을 고르고 &quot;세팅 시작&quot;을 눌러
          들어오세요.
        </p>
        <div>
          <Button size="sm" onClick={() => void navigate({ to: '/work' })}>
            작업 관리로 이동
          </Button>
        </div>
      </Alert>
    </>
  );
}

export interface SetupPageProps {
  /** 세팅할 작업. 없으면 작업 관리로 돌려보내는 안내를 보인다. */
  workUnitId?: number;
  /**
   * 날짜 화면(작업 관리) 안에 끼운다: 자기 제목과 머리줄 단추를 그리지 않고 단추를 아래 오른쪽 단추 줄(useWorkAction)에 등록한다.
   * 구역 단계의 마지막 단추는 '다음' 이다(세팅을 완료하고 넘어간다). 단독 화면(/setup)은 머리줄에 단추를 둔다.
   */
  embedded?: boolean;
  /** 구역 단계의 마지막 단추로 세팅을 완료한 뒤. 주면 작업 관리로 이동하지 않고 이것을 부른다(날짜 화면이 다음 단계로 넘긴다). */
  onDone?: () => void;
  /** 「세팅 취소」로 세팅에서 나갈 때. 주면 그것을 부르고(날짜 화면은 보고서로 돌아간다), 없으면 작업 관리로 간다. */
  onExit?: () => void;
}

export function SetupPage({ workUnitId, embedded = false, onDone, onExit }: SetupPageProps = {}) {
  if (workUnitId === undefined) return <SetupNeedsWork />;
  return (
    <SetupWorkPage workUnitId={workUnitId} embedded={embedded} onDone={onDone} onExit={onExit} />
  );
}

function SetupWorkPage({
  workUnitId,
  embedded,
  onDone,
  onExit,
}: {
  workUnitId: number;
  embedded: boolean;
  onDone?: () => void;
  onExit?: () => void;
}) {
  // 이어 온 세팅 세션이 있으면 대기 화면에서 시작한다. 맵이 이미 준비됐으면 곧바로 구역 단계로 넘어간다(작업 관리의 구역
  // 단계도 이 화면을 연다).
  const [stage, setStage] = useState<Stage>(() =>
    useSetupFlowStore.getState().activeSessionId === null ? 0 : 1,
  );
  const [heightEdits, setHeightEdits] = useState<Record<string, string>>({});
  // 높이 확인 창(-690)에서 고친 칸. 창은 워커가 쓰는 높이에서 시작한다
  const [checkEdits, setCheckEdits] = useState<Record<string, string>>({});
  const [returnForHeightRetry, setReturnForHeightRetry] = useState(false);
  // 위험 확인창이 열린 동안 보이는 쌍 이름(열 때 붙잡아 둔다: 열린 사이 안내가 바뀌어도 문장이 비지 않는다). 닫혀 있으면 null.
  const [riskConfirmPairs, setRiskConfirmPairs] = useState<readonly string[] | null>(null);
  // 1단계에서 사용자가 고른 맵 방식(S15P31A101-689). 고르지 않았으면 null 이고 지금 세션의 요청 방식, 없으면 새 맵 만들기가 기본이다
  // (S15P31A101-762: 카메라 각도가 바뀌어 있을 위험이 높아 이전 맵 재사용은 관리자가 고를 때만 쓴다).
  const [pickedMode, setPickedMode] = useState<SetupMode | null>(null);
  // 「이전 맵 재사용」 안에서 사용자가 고른 맵(S15P31A101-714). 고르지 않았거나 그 맵이 어긋나면 서버 추천 맵이다.
  const [pickedMapId, setPickedMapId] = useState<string | null>(null);
  // 보정·생성의 「자세히 · 맵 보강」에서 여는 맵 보강 촬영 창.
  const [supplementOpen, setSupplementOpen] = useState(false);
  const navigate = useNavigate();
  // 시연 계정의 「새 맵 만들기」는 준비된 맵을 재사용으로 요청하고 보정·생성을 10초 동안 채워 보인다(features/demo/demoNewMap)
  const demoAccount = useIsDemoAccount();

  const activeSessionId = useSetupFlowStore((s) => s.activeSessionId);
  const discardedDraftIds = useSetupFlowStore((s) => s.discardedDraftIds);
  // 시연 계정이 구역 단계에서 커서를 댄 AI 초안 카드(3D 에서 그 초안을 위험 등급색으로 도드라지게 한다)
  const [hoveredDraftId, setHoveredDraftId] = useState<string | null>(null);

  // 새로고침·다른 화면에서 돌아왔을 때: 이 작업에 진행 중인(또는 끝난) 세션이 있으면 이어받아 대기 화면·구역 단계로 연다.
  // 세션 ID 를 메모리에만 두면 다시 시작하다 409 가 나므로 서버의 work_unit.active_setup_session_id 를 정본으로 본다.
  // 이어받은 뒤에도 주기로 다시 보아 다른 탭에서 새로 시작·다시 시도한 세션을 따라간다(S15P31A101-689).
  const workUnitSessionQuery = useQuery({
    queryKey: setupWorkUnitSessionKey(workUnitId),
    queryFn: ({ signal }) => requestWorkUnitSetupSessionId(api, workUnitId, signal),
    retry: false,
    staleTime: 0,
    refetchInterval: WORK_SESSION_POLL_MS,
  });
  // 이 화면이 새로 시작·다시 시도하며 떠난 세션. 서버 조회가 그보다 늦게 와도 그 세션으로 되돌아가지 않는다.
  const supersededRef = useRef<string | null>(null);
  // 서버 세션으로 옮겨 단계를 서버 상태에서 다시 정할 세션(구역 단계까지 갔는지 보고 나면 지운다).
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const heightDefaultsQuery = useCameraHeightDefaults();

  const go = useCallback((next: Stage) => setStage(next), []);

  // 이 화면이 새 시도를 만들면 떠난 세션을 기억하고 작업의 서버 세션 값을 새 세션으로 맞춰 둔다(다른 탭 따라가기와 엇갈리지 않게).
  const queryClient = useQueryClient();
  const startedHere = useCallback(
    (next: SetupSessionResponse) => {
      supersededRef.current = useSetupFlowStore.getState().activeSessionId;
      queryClient.setQueryData(setupWorkUnitSessionKey(workUnitId), next.setup_session_id);
      setHeightEdits({});
      setReturnForHeightRetry(false);
      setPickedMode(null);
      setPickedMapId(null);
      claimDemoNewMap(next.setup_session_id);
      // 고른 맵을 그대로 쓰는 재사용(S15P31A101-714)은 워커 작업 없이 끝난 세션이라 바로 구역 단계로 간다. 시연 계정의 새 맵은 보정·생성을 보인다
      go(next.reuse_source && !isDemoNewMap(next.setup_session_id) ? ZONE_STAGE : 1);
    },
    [queryClient, workUnitId, go],
  );
  const createSession = useCreateSetupSession(startedHere);
  const retrySession = useRetrySetupSession(startedHere);

  // 멈춘 세팅을 고친 높이로 이어 가면 같은 세션이 멈춘 곳부터 돈다(보정·생성으로 돌아간다).
  const resumeSession = useResumeSetupSession(() => {
    setHeightEdits({});
    setCheckEdits({});
    setReturnForHeightRetry(false);
    go(1);
  });

  const sessionId =
    activeSessionId ??
    retrySession.session?.setup_session_id ??
    createSession.session?.setup_session_id ??
    null;

  // 이어받을 세션을 찾는 중에는 본문을 그리지 않는다(1단계가 잠깐 보였다 대기 화면으로 바뀌지 않게).
  const entryPending = activeSessionId === null && !workUnitSessionQuery.isFetched;

  // 맵 보강 창이 열려 있는 동안은 끝난 세션도 계속 받는다(휴대폰으로 올린 파일과 다시 굽기 판정이 이 조회로만 온다).
  const sessionQuery = useSetupSession(sessionId, Boolean(sessionId), supplementOpen);
  const currentSession = sessionQuery.data ?? retrySession.session ?? createSession.session ?? null;

  // 작업의 서버 세션이 이 화면이 따르는 세션과 다르면 옮긴다: 처음 열 때(새로고침), 따르던 세션이 끝났거나 다른 작업의 것일 때(다른 탭에서
  // 다시 시도·새로 시작). 따르던 세션이 진행 중이면 옮기지 않는다(같은 현장에 진행 중 세션은 하나라 서버 값이 늦게 온 것이다).
  // 「세팅 취소」로 버린 세션은 이어받지 않는다(1단계 기본값에서 새로 시작한다, features/setup/abandonedSetup.store).
  const serverSessionAbandoned = useIsAbandonedSetupSession(workUnitId, workUnitSessionQuery.data);
  const serverSessionId = serverSessionAbandoned ? null : (workUnitSessionQuery.data ?? null);
  const followedSettled =
    currentSession === null ||
    currentSession.work_unit_id !== workUnitId ||
    currentSession.status === 'FAILED' ||
    currentSession.status === 'COMPLETED';
  useEffect(() => {
    if (!serverSessionId || serverSessionId === activeSessionId) return;
    if (serverSessionId === supersededRef.current) return;
    if (activeSessionId !== null && !followedSettled) return;
    followServerSetupSession(serverSessionId);
  }, [serverSessionId, activeSessionId, followedSettled]);
  // 서버 세션으로 옮겼으면 그 세션의 대기 화면(2단계)에서 다시 시작하고, 구역 단계까지 갔는지는 아래에서 서버 상태로 본다
  const restoreSessionId = useSetupFlowStore((s) => s.restoreSessionId);
  const [handledRestore, setHandledRestore] = useState<string | null>(null);
  if (restoreSessionId !== null && restoreSessionId !== handledRestore) {
    setHandledRestore(restoreSessionId);
    setRestoringId(restoreSessionId);
    setPickedMode(null);
    setReturnForHeightRetry(false);
    setStage(1);
  }

  const waiting = useSetupWaitingView(currentSession);
  const repeatedPairs = useValidationRejections(currentSession, waiting.cameraIds);

  // 각도 헬퍼는 1단계에서 주기로 받고, 보정·생성의 왼쪽 카메라 영상 칸에서는 받아 둔 값을 쓴다(카메라 목록·순서만 쓰고 배지는 달지 않는다).
  const cameraViewShown = stage === 0 || stage === 1;
  const coverageQuery = useCoverageGuides(cameraViewShown, stage === 0);
  const coverageExpired = useCoverageExpired(coverageQuery.data, coverageQuery.receivedAt);
  // 현장 게이트웨이의 카메라 헬퍼가 오래 답하지 않음(S15P31A101-719): 배지·재사용 판정이 「확인 중」으로 남지 않고 이유를 말한다
  const helperLost = useCoverageHelperLost(
    coverageQuery.data,
    coverageQuery.receivedAt,
    coverageQuery.error,
  );
  // 보정 검증 쌍별 표·카메라 확인(S15P31A101-646). 통과 전에는 2단계 '다음' 이 꺼진다
  const cameraCheck = useMemo(
    () => deriveCameraCheckView(currentSession, waiting.cameraIds),
    [currentSession, waiting.cameraIds],
  );
  // 맵 앞 카메라 확인 걷기 창(S15P31A101-687)
  const walk = useMemo(
    () => deriveCameraWalkView(currentSession, waiting.cameraIds),
    [currentSession, waiting.cameraIds],
  );
  const walkSeconds = useWalkCountdown(walk.phase, walk.attemptKey);
  const startWalk = useStartCameraCheck();

  // 이 브라우저에 남은 세션이 다른 작업의 것이면 버리고 이 작업의 세션을 서버에서 다시 찾는다(위 이어받기). 찾기 전에는
  // 1단계에서 기다린다.
  const foreignSession = currentSession !== null && currentSession.work_unit_id !== workUnitId;
  // 날짜 화면 안(embedded)의 날짜 작업에는 레이아웃이 없다(구역이 곧 가상 레이아웃이다). 구역 저장에는 세션 id 를 계속
  // 실어 보내고(setup_session_id) 레이아웃 반영만 건너뛴다.
  const syncsLayout = !embedded;
  const layoutSync = useSetupLayoutSync(
    workUnitId,
    syncsLayout && !foreignSession ? sessionId : null,
  );
  const setupLayoutSync =
    sessionId && !foreignSession
      ? {
          sessionId,
          sync: syncsLayout ? layoutSync.sync : skipLayoutSync,
          retry: syncsLayout ? layoutSync.retry : skipLayoutSync,
        }
      : undefined;
  if (foreignSession && stage !== 0) setStage(0);
  // 1단계를 떠났는데(이어받기 등) 위험 확인창이 남아 있으면 닫는다.
  if (supplementOpen && stage !== 1) setSupplementOpen(false);
  if (riskConfirmPairs !== null && stage !== 0) setRiskConfirmPairs(null);
  useEffect(() => {
    if (foreignSession) setActiveSetupSessionId(null);
  }, [foreignSession]);

  // 워커가 죽거나 작업이 멈춰 같은 현장의 새 세팅이 409 로 막힐 때 관리자가 진행 중 세션을 취소한다.
  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelSetupSession(api, id),
    onSuccess: (session) => {
      queryClient.setQueryData(setupSessionKey(session.setup_session_id), session);
    },
  });
  const sessionRunning = isSetupSessionRunning(currentSession);
  const handleCancelSession = useCallback(() => {
    if (!sessionId || cancelMutation.isPending) return;
    if (!window.confirm('진행 중인 세팅을 취소할까요? 취소하면 처음부터 다시 시작해야 합니다.'))
      return;
    cancelMutation.mutate(sessionId);
  }, [sessionId, cancelMutation]);

  // 구역 단계의 '다시 보정'은 카메라 연결 관리(1단계)부터 다시 시작하므로 세팅 취소처럼 한 번 묻는다.
  // 세팅을 완료했다(C17). 완료 뒤에는 구역 편집·초안 수락을 감춘다
  const completed = setupCompleted(currentSession);
  const completion = useCompleteSetup(currentSession);
  useSeedSetupZonePlan(stage === ZONE_STAGE && !completed ? currentSession : null);

  // 세팅 구역 단계의 구역 편집·초안 수락은 세션 구역 목록에 저장한다(-615). 완료 뒤에는 관제 구역을 본다
  const zoneSource = useMemo<SetupZoneSource | null>(
    () => (sessionId && !foreignSession && !completed ? { sessionId } : null),
    [sessionId, foreignSession, completed],
  );
  // 서버 세션으로 옮긴 뒤 그 세팅이 구역 단계까지 갔는지(완료했거나 세션 구역 목록을 저장했다) 보고 구역 단계로 연다(S15P31A101-689)
  const restoring =
    restoringId !== null &&
    restoringId === sessionId &&
    currentSession?.setup_session_id === sessionId;
  const restoreChecksPlan = restoring && canCompleteSetup(currentSession);
  // 확인 필요 구역 수(S15P31A101-629). 남아 있으면 세팅을 완료할 수 없다
  const zonePlanQuery = useSetupZonePlanQuery(
    stage === ZONE_STAGE || restoreChecksPlan ? (zoneSource?.sessionId ?? null) : null,
  );
  const planRevision = zonePlanQuery.data?.revision;
  const planFailed = zonePlanQuery.isError;
  if (restoring && currentSession) {
    if (
      setupCompleted(currentSession) ||
      (currentSession.reuse_source && !isDemoNewMap(currentSession.setup_session_id))
    ) {
      // 완료했거나, 고른 맵을 그대로 쓰는 재사용(워커 단계가 없다, S15P31A101-714)이면 구역 단계로 연다
      setStage(ZONE_STAGE);
      setRestoringId(null);
    } else if (!restoreChecksPlan) {
      setRestoringId(null);
    } else if (planRevision !== undefined || planFailed) {
      if ((planRevision ?? 0) > 0) setStage(ZONE_STAGE);
      setRestoringId(null);
    }
  }
  const unconfirmedZones = zoneSource ? pendingReviewCount(zonePlanQuery.data) : 0;
  const draftsEnabled = Boolean(sessionId) && (waiting.previewReady || stage === ZONE_STAGE);
  // 시연 계정은 서버 초안 대신 구역 단계에서 잠깐 찾은 뒤 정해 둔 개구부 초안을 보인다(features/demo/demoZoneDrafts)
  const zoneDraftsQuery = useSetupZoneDrafts(sessionId, draftsEnabled && !demoAccount);
  const demoDrafts = useDemoZoneDrafts(sessionId, demoAccount && stage === ZONE_STAGE);
  const draftsResponse = demoAccount ? demoDrafts : zoneDraftsQuery.data;
  const draftsList = draftsResponse?.drafts ?? NO_DRAFTS;
  const draftAccept = useAcceptZoneDraft(draftsList, setupLayoutSync, zoneSource);
  const acceptedDraftIds = draftAccept.acceptedIds;
  const hoveredDraft = demoAccount
    ? draftsList.find(
        (d) => d.candidate_id === hoveredDraftId && !discardedDraftIds.includes(d.candidate_id),
      )
    : undefined;
  const draftGhosts = useMemo(
    () =>
      withDraftHighlight(
        draftGhostsOf(draftsList, acceptedDraftIds, discardedDraftIds),
        hoveredDraft,
        hoveredDraft !== undefined && acceptedDraftIds.includes(hoveredDraft.candidate_id),
      ),
    [draftsList, acceptedDraftIds, discardedDraftIds, hoveredDraft],
  );
  // 같은 자리의 이어 온 구역과 아직 고르지 않은 AI 초안 짝(S15P31A101-758). 시연 계정은 초안 카드를 그대로 보이려고 묶지 않는다
  const { zones: planZones } = useZones(zoneSource);
  const draftPairs = useMemo(
    () =>
      pairDraftsWithCarried(
        draftsList.filter(
          (d) =>
            !acceptedDraftIds.includes(d.candidate_id) &&
            !discardedDraftIds.includes(d.candidate_id),
        ),
        zoneSource && !demoAccount ? planZones : [],
      ),
    [draftsList, acceptedDraftIds, discardedDraftIds, planZones, zoneSource, demoAccount],
  );
  const mergedDraftIds = useMemo(
    () => [...draftPairs.values()].map((d) => d.candidate_id),
    [draftPairs],
  );
  const canImportPrevious = reviewsCarriedZones(currentSession);

  const cameraIds = useMemo(
    () => resolveHeightCameraIds(heightDefaultsQuery.data, coverageQuery.data),
    [heightDefaultsQuery.data, coverageQuery.data],
  );

  // 시연 계정은 배경 촬영·카메라 확인 걷기 창을 띄우지 않는다(서버에는 준비된 맵의 재사용이라 찍을 것이 없다)
  const capture = useBackgroundCapture({
    stage,
    session: demoAccount ? null : currentSession,
    cameraIds,
    starting:
      createSession.pending ||
      retrySession.pending ||
      resumeSession.pending ||
      cancelMutation.isPending,
  });

  const effectiveHeightDefaults =
    returnForHeightRetry && currentSession?.camera_heights_m
      ? currentSession.camera_heights_m
      : heightDefaultsQuery.data?.camera_heights_m;

  const heightFields = useMemo(
    () => deriveHeightFields(cameraIds, effectiveHeightDefaults, heightEdits),
    [cameraIds, effectiveHeightDefaults, heightEdits],
  );

  const heightValidation = useMemo(() => validateHeightFields(heightFields), [heightFields]);

  // 카메라 높이 확인 창(-690): 워커가 쓰는 높이(height_review) + 이 창에서 고친 값
  const heightReview = waiting.heightCheckPending ? (currentSession?.height_review ?? null) : null;
  const checkFields = useMemo(
    () =>
      heightReview
        ? deriveHeightFields(waiting.cameraIds, heightReview.camera_heights_m, checkEdits)
        : [],
    [heightReview, waiting.cameraIds, checkEdits],
  );
  const checkValidation = useMemo(() => validateHeightFields(checkFields), [checkFields]);
  const checkChanged =
    heightReview !== null &&
    checkValidation.valid &&
    heightsChanged(heightReview.camera_heights_m, checkValidation.cameraHeightsM);
  const onChangeCheckHeight = useCallback((cameraId: string, value: string) => {
    setCheckEdits((prev) => ({ ...prev, [cameraId]: value }));
  }, []);
  const resumeHeights = resumeSession.resume;
  const submitHeightCheck = useCallback(() => {
    if (!sessionId || !checkValidation.valid || resumeSession.pending) return;
    resumeHeights({
      setupSessionId: sessionId,
      body: { camera_heights_m: checkValidation.cameraHeightsM },
    });
  }, [sessionId, checkValidation, resumeSession.pending, resumeHeights]);

  const onChangeHeight = useCallback((cameraId: string, value: string) => {
    setHeightEdits((prev) => ({ ...prev, [cameraId]: value }));
  }, []);

  const restartPending =
    createSession.pending ||
    retrySession.pending ||
    resumeSession.pending ||
    cancelMutation.isPending;

  // 「맵」 방식(S15P31A101-689). 1단계에서는 이전 맵 재사용을 고를 수 있는지 늘 받아 둔다(세션 유무·실패·취소와 무관)
  const reuseChoice = useReuseChoice(stage === 0, cameraIds, helperLost);
  // 시연 계정은 이전 맵을 시점 확인·추천 없이 고른다(서버 SetupDemoAccounts 와 같은 판정)
  const reuse = demoAccount ? demoReuseOpen(reuseChoice) : reuseChoice;
  const wantedMode: SetupMode = pickedMode ?? currentSession?.requested_mode ?? 'NEW';
  // 고를 수 없으면 새 맵으로 보인다(사용자가 그 상태를 보고 '다음' 을 누른다. 세팅 중 저절로 바꾸지 않는다)
  const mode: SetupMode = wantedMode === 'REUSE' && reuse.blocked === null ? 'REUSE' : 'NEW';
  const demoNewMap = demoAccount && mode === 'NEW';
  // 서버에 재사용으로 요청한다(고른 재사용 또는 시연 계정의 새 맵)
  const sendsReuse = mode === 'REUSE' || demoNewMap;
  const modePending = sendsReuse && reuse.checking;
  // 재사용으로 시작할 맵(S15P31A101-714): 고른 맵이 아직 맞으면 그 맵, 아니면 추천 맵(옛 서버는 목록이 없어 null = 서버가 고른다)
  const reuseMapId = chosenReuseMap(reuse.maps, pickedMapId, reuse.recommendedId);
  // 재사용은 그 맵을 만들 때의 높이를 쓴다. 높이 입력 칸의 값은 새 맵에서만 시작 조건이다
  const heightsReady = mode === 'REUSE' || heightValidation.valid;
  const reuseBody = useMemo(
    () => ({
      mode: 'REUSE' as const,
      ...(reuseMapId ? { reuse_setup_session_id: reuseMapId } : {}),
    }),
    [reuseMapId],
  );

  // 카메라 칸 배지 근거(S15P31A101-691): 각도 안내(연결·겹침·각도, 오래되면 확인 중) + 재사용 판정의 달라진 카메라
  const changedCameras = reuse.changedCameras;
  const coverage = useMemo(
    () =>
      deriveStep1Coverage(coverageQuery.data, coverageQuery.error, cameraIds, {
        expired: coverageExpired,
        changedCameras,
        helperLost,
      }),
    [
      coverageQuery.data,
      coverageQuery.error,
      cameraIds,
      coverageExpired,
      changedCameras,
      helperLost,
    ],
  );

  /**
   * 높이를 고쳐 세팅을 다시 시작한다. 서버 규칙(SetupService)에 맞춰 세션 상태로 가른다: 서버 retry 는 실패한 세션만 받고
   * 끝난 세션은 새로 시작하며, 진행 중인 세션이 있으면 새로 시작할 수 없어 먼저 취소한 뒤 재시도한다.
   */
  const restartWithHeights = useCallback(() => {
    if (!sessionId || !currentSession || !heightsReady || restartPending) return;
    const cameraHeights = heightValidation.cameraHeightsM;
    requestDemoNewMap(demoNewMap);
    // 다시 시도도 1단계에서 고른 방식으로 한다(서버가 새 세션의 requested_mode 로 저장한다). 재사용은 고른 맵을 싣고 높이는 싣지 않는다
    const retry = () =>
      retrySession.retry({
        setupSessionId: sessionId,
        body: sendsReuse ? reuseBody : { camera_heights_m: cameraHeights, mode },
      });
    // 보정 문제로 멈춘 세션은 처음부터가 아니라 멈춘 곳부터 이어 간다.
    if (!sendsReuse && pausedForHeights(currentSession) && currentSession.status !== 'FAILED')
      resumeSession.resume({
        setupSessionId: sessionId,
        body: { camera_heights_m: cameraHeights },
      });
    else if (currentSession.status === 'FAILED') retry();
    else if (currentSession.status === 'COMPLETED')
      createSession.submit(
        sendsReuse
          ? { work_unit_id: workUnitId, ...reuseBody }
          : { work_unit_id: workUnitId, camera_heights_m: cameraHeights },
      );
    else cancelMutation.mutate(sessionId, { onSuccess: retry });
  }, [
    sessionId,
    currentSession,
    heightsReady,
    heightValidation,
    restartPending,
    retrySession,
    resumeSession,
    createSession,
    cancelMutation,
    workUnitId,
    mode,
    demoNewMap,
    sendsReuse,
    reuseBody,
  ]);

  // 새 맵은 mode 를 생략한다(서버가 NEW 로 본다). 재사용은 고른 맵을 싣고 높이는 싣지 않는다(그 맵의 높이를 쓴다, S15P31A101-714).
  const createSessionNow = useCallback(() => {
    if (!heightsReady || createSession.pending) return;
    requestDemoNewMap(demoNewMap);
    createSession.submit(
      sendsReuse
        ? { work_unit_id: workUnitId, ...reuseBody }
        : { work_unit_id: workUnitId, camera_heights_m: heightValidation.cameraHeightsM },
    );
  }, [
    heightsReady,
    heightValidation,
    createSession,
    workUnitId,
    demoNewMap,
    sendsReuse,
    reuseBody,
  ]);

  // 1단계에서 고른 방식으로 시작한다(새 맵은 mode 를 생략한다). 실패·취소한 시도가 있으면 그 시도의 다시 시도로 이어 고른 방식을 보낸다.
  const submitStep1 = useCallback(() => {
    if (!heightsReady || modePending) return;
    if ((returnForHeightRetry && sessionId) || (sessionId && currentSession?.status === 'FAILED')) {
      restartWithHeights();
      return;
    }
    if (createSession.pending) return;
    createSessionNow();
  }, [
    heightsReady,
    modePending,
    returnForHeightRetry,
    sessionId,
    currentSession,
    restartWithHeights,
    createSession,
    createSessionNow,
  ]);

  // 「세팅 취소」: 지금까지의 세팅을 버리고 세팅에서 나간다(날짜 화면은 TBM 보고서로, 단독 화면은 그 작업의 작업 관리로).
  // 진행 중인 시도는 서버에서 멈추고, 작업에 남은 세션은 버린 세션으로 적어 다시 들어와도 이어받지 않는다.
  const leaveSetup = useCallback(() => {
    if (onExit) onExit();
    else void navigate({ to: '/work', search: { workUnitId: String(workUnitId) } });
  }, [onExit, navigate, workUnitId]);
  const abandonSetupSession = useAbandonedSetupStore((s) => s.abandon);
  // 버릴 세션: 작업의 서버 세션(이미 버린 것은 빼고), 없으면 이 화면이 따르는 세션
  const discardSessionId = serverSessionId ?? sessionId;
  const discardAndLeave = useCallback(() => {
    if (discardSessionId) abandonSetupSession(workUnitId, discardSessionId);
    resetSetupFlowStore();
    leaveSetup();
  }, [discardSessionId, abandonSetupSession, workUnitId, leaveSetup]);
  const exitSetup = useCallback(() => {
    if (cancelMutation.isPending) return;
    if (!discardSessionId) {
      leaveSetup();
      return;
    }
    if (!window.confirm('지금까지의 세팅을 지우고 나갈까요? 다시 들어오면 처음부터 시작합니다.'))
      return;
    if (sessionRunning && sessionId)
      cancelMutation.mutate(sessionId, { onSuccess: discardAndLeave });
    else discardAndLeave();
  }, [cancelMutation, discardSessionId, sessionRunning, sessionId, leaveSetup, discardAndLeave]);

  // 세션을 만들기 전에 배경 촬영 창을 띄운다(-686). 멈춘 세팅을 이어 가는 경우만 배경을 다시 찍지 않아 바로 보낸다.
  const resumesPaused =
    returnForHeightRetry &&
    Boolean(sessionId) &&
    pausedForHeights(currentSession) &&
    currentSession?.status !== 'FAILED';
  const beginCapture = capture.begin;
  const beginStep1Submit = useCallback(() => {
    if (resumesPaused) submitStep1();
    else beginCapture();
  }, [resumesPaused, submitStep1, beginCapture]);

  const startCapture = useCallback(() => {
    capture.start();
    submitStep1();
  }, [capture, submitStep1]);

  // 옆 카메라 쌍의 겹침이 부족하면 보정이 실패할 수 있어 시작 전에 한 번 더 묻는다(높이를 고쳐 다시 시작할 때도 같다).
  // 세팅 시작(세션 만들기)에는 GPU 가 필요하다. 꺼져 있거나 준비 중이면 GPU 경고창을 먼저 띄우고 연결되면 이어서 한다(S15P31A101-702)
  const { guard: guardGpu, dialog: gpuGateDialog } = useGpuGate();
  // GPU 가 꺼져 있으면 세팅 실패 카드의 주 단추가 「GPU 켜기」(GPU 패널)다. 다시 시도해도 같은 곳에서 멈추기 때문이다(S15P31A101-734)
  const gpu = useGpuStatus();
  const [gpuPanelOpen, setGpuPanelOpen] = useState(false);
  const gpuOff = gpu.isAdmin && gpu.status !== undefined && gpu.dot === 'OFF';
  // 고른 맵을 그대로 쓰는 재사용(S15P31A101-714)은 배경 촬영·보정·맵 굽기가 없어 GPU·겹침 확인·배경 촬영 창 없이 바로 시작한다
  // (Tier 0 는 켜져 있으면 구성 묶음으로, 꺼져 있으면 다음 기동 때 그 맵의 보정을 받는다)
  // 시연 계정의 새 맵도 서버에는 재사용이라 같다
  const requestStep1Submit = useCallback(() => {
    if (sendsReuse) {
      submitStep1();
      return;
    }
    guardGpu(() => {
      if (coverage.riskyPairs.length > 0) setRiskConfirmPairs(coverage.riskyPairs);
      else beginStep1Submit();
    });
  }, [sendsReuse, submitStep1, guardGpu, coverage.riskyPairs, beginStep1Submit]);

  const confirmRiskySubmit = useCallback(() => {
    setRiskConfirmPairs(null);
    beginStep1Submit();
  }, [beginStep1Submit]);

  const handleRetryFailedSession = useCallback(() => {
    if (!sessionId || retrySession.pending) return;
    retrySession.retry({
      setupSessionId: sessionId,
      body: {
        ...(currentSession?.camera_heights_m
          ? { camera_heights_m: currentSession.camera_heights_m }
          : {}),
        ...(currentSession?.failure_code === 'VALIDATION_REJECTED' ? { mode: 'NEW' as const } : {}),
      },
    });
  }, [sessionId, retrySession, currentSession]);

  // 재사용이 카메라 변화로 멈춘 시도(REUSE_WORLD_REJECTED)를 관리자가 새 맵으로 다시 한다(저절로 넘어가지 않는다, S15P31A101-689)
  const handleRetryNewMap = useCallback(() => {
    if (!sessionId || retrySession.pending) return;
    retrySession.retry({
      setupSessionId: sessionId,
      body: {
        ...(currentSession?.camera_heights_m
          ? { camera_heights_m: currentSession.camera_heights_m }
          : {}),
        mode: 'NEW',
      },
    });
  }, [sessionId, retrySession, currentSession]);

  /** 카메라 연결 관리(1단계)로 돌아가 고쳐서 다시 시작한다. 실패 안내와 높이 불일치가 같이 쓴다. */
  const returnToStep1 = useCallback(() => {
    if (currentSession?.camera_heights_m) {
      const initialEdits: Record<string, string> = {};
      for (const [camId, val] of Object.entries(currentSession.camera_heights_m)) {
        initialEdits[camId] = String(val);
      }
      setHeightEdits(initialEdits);
    }
    setReturnForHeightRetry(true);
    setStage(0);
  }, [currentSession]);

  // 2단계 「현재 시도 중단」: 이 시도만 멈추고 1단계로 돌아가 방식·높이를 다시 고르게 한다(세팅에서 나가지 않는다)
  const stopAttempt = useCallback(() => {
    if (!sessionId || cancelMutation.isPending) return;
    if (
      !window.confirm(
        '현재 시도를 멈출까요? 카메라 연결 관리에서 맵 방식을 다시 골라 시작할 수 있습니다.',
      )
    )
      return;
    cancelMutation.mutate(sessionId, { onSuccess: returnToStep1 });
  }, [sessionId, cancelMutation, returnToStep1]);

  // 구역 단계의 '다시 보정': 확인을 받고 카메라 연결 관리(0단계)로 돌아간다. 진행 중인 세션은 0단계에서 다시 시도할 때 취소하고 이어 간다.
  const handleRestart = useCallback(() => {
    const zoneCount = sessionId
      ? (queryClient.getQueryData<SetupZonePlanView>(setupZonePlanKey(sessionId))?.items.length ??
        0)
      : 0;
    if (!window.confirm(restartConfirmText(zoneCount))) return;
    returnToStep1();
  }, [sessionId, queryClient, returnToStep1]);

  // 구역 단계의 마지막 단추: 아직 완료 전이면 세팅을 먼저 완료하고(취소·실패면 머문다), 날짜 화면 안이면 그 화면이 다음 단계로 넘기고,
  // 단독 화면이면 그 작업의 작업 관리로 돌아간다.
  const runCompletion = completion.run;
  const finish = useCallback(async () => {
    if (!completed && !(await runCompletion())) return;
    if (onDone) onDone();
    else void navigate({ to: '/work', search: { workUnitId: String(workUnitId) } });
  }, [completed, runCompletion, onDone, navigate, workUnitId]);

  // 보정·생성의 '다음': 바로 구역 단계로 간다. 맵 보강 촬영은 끼어들지 않고 「자세히 · 맵 보강」에서만 연다(S15P31A101-691).
  const confirmCalibration = useCallback(() => go(ZONE_STAGE), [go]);
  const openSupplement = useCallback(() => setSupplementOpen(true), []);
  const closeSupplement = useCallback(() => setSupplementOpen(false), []);

  const actions = deriveSetupActions(
    {
      stage,
      embedded,
      startDisabled: !heightsReady || restartPending || modePending,
      mapComplete: waiting.mapComplete,
      sessionRunning,
      cancelPending: cancelMutation.isPending,
      showHeightNotice: waiting.showHeightNotice,
      canFinish: completed || canCompleteSetup(currentSession),
      finishPending: completion.pending,
      setupCompleted: completed,
      unconfirmedZones: completed ? 0 : unconfirmedZones,
      cameraCheckBlocked: completed ? null : cameraCheckBlockReason(cameraCheck),
      cameraCheckFailed: !waiting.failed && cameraCheckFailed(cameraCheck),
    },
    {
      start: requestStep1Submit,
      confirm: confirmCalibration,
      restart: handleRestart,
      cancelSession: stopAttempt,
      exitSetup,
      recheckCameras: returnToStep1,
      finish: () => void finish(),
    },
  );
  useWorkAction(embedded && !entryPending ? toWorkAction(actions) : null);

  const step1RawError =
    resumeSession.rawError ??
    retrySession.rawError ??
    createSession.rawError ??
    cancelMutation.error;
  // 취소 실패는 그 취소를 요청한 세션 화면에서만 보인다(다시 시도로 새 세션이 되면 지난 실패를 지운다)
  const cancelError =
    cancelMutation.error && cancelMutation.variables === sessionId
      ? setupCancelErrorMessage(cancelMutation.error)
      : null;
  const step1Error =
    resumeSession.error ?? retrySession.error ?? createSession.error ?? cancelError;
  // 막는 세팅을 취소했으니 거절 오류를 지워 다시 시도할 수 있게 한다.
  const clearStep1Error = () => {
    createSession.reset();
    retrySession.reset();
    cancelMutation.reset();
  };
  const step1BlockedByLiveWork = isSetupBlockedByLiveWork(step1RawError);
  const retryBlockedByLiveWork = isSetupBlockedByLiveWork(retrySession.rawError);

  const navigateToBlockedWork = useCallback(
    (error: unknown) => {
      const liveWorkId = blockedLiveWorkId(error);
      if (liveWorkId !== null) {
        void navigate({ to: '/work', search: { workUnitId: String(liveWorkId) } });
      } else {
        void navigate({ to: '/work' });
      }
    },
    [navigate],
  );

  // 카메라 확인 걷기 창(-687): 2단계에서 워커가 걷기를 기다리거나 확인 중일 때. 다른 창(배경 촬영·높이 확인)이 먼저다
  const walkOpen = stage === 1 && walk.open && !capture.open && !heightReview && !demoAccount;
  const startWalkRequest = startWalk.start;
  const requestWalk = useCallback(
    (attempt: number) => {
      if (!sessionId || startWalk.pending) return;
      startWalkRequest({ setupSessionId: sessionId, attempt });
    },
    [sessionId, startWalk.pending, startWalkRequest],
  );

  // 배경 촬영·걷기 창이 카메라 영상을 띄우는 동안 아래 칸의 영상은 내린다(영상 연결은 한 번에 하나, -686·-687).
  // 1단계는 칸마다 배지를 달고, 보정·생성은 탭 안에 영상만 둔다(각도 안내를 다시 받지 않아 배지 근거가 없다).
  const shownCoverage = useDemoCoverage(coverage, demoAccount);
  const cameraMap =
    capture.open || walkOpen ? (
      <div
        aria-hidden
        className={cn('min-h-0', stage === 0 ? 'rounded-xl bg-card' : 'size-full rounded-lg')}
      />
    ) : stage === 0 ? (
      <CameraVideoPanel coverage={shownCoverage} />
    ) : (
      <CameraVideoPanel coverage={coverage} showBadges={false} title={null} />
    );

  const step1Step = step1NextStep({
    coverage,
    // 재사용은 입력 높이를 쓰지 않아 빈 칸을 시작 조건으로 안내하지 않는다(S15P31A101-714)
    heights:
      mode === 'REUSE'
        ? { ...heightValidation, valid: true, missingIds: [], invalidIds: [] }
        : heightValidation,
    heightCameraIds: cameraIds,
    modePending,
    submitting: restartPending,
  });
  const calibrateStep = calibrateNextStep({
    waiting,
    pollingError: sessionQuery.error,
    walkOpen,
    cameraCheckBlocked: completed ? null : cameraCheckBlockReason(cameraCheck),
  });

  const bodyClass = cn('flex flex-col gap-3', embedded ? EMBEDDED_BODY : 'min-h-0 flex-1');
  // 날짜 화면은 화면 높이에 맞춘 본문의 하단 여백을 줄인다(features/work/WorkDayPage DOCK_CLEARANCE)
  const fitHeight = embedded ? { 'data-fit-height': '' } : {};
  if (entryPending) return <div className={bodyClass} {...fitHeight} />;

  return (
    <div className={bodyClass} {...fitHeight}>
      {!embedded && <PageTitle>설치 · 보정</PageTitle>}
      {!embedded && (
        <div className="flex flex-wrap justify-end gap-2">
          {actions.map((action) => (
            <Button
              key={action.key}
              size="lg"
              variant={action.primary ? undefined : 'secondary'}
              className={cn('px-4', !action.primary && 'bg-surface-3 hover:bg-surface-3/70')}
              disabled={action.disabled}
              title={action.title}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      <ol aria-label="보정 단계" className="grid grid-cols-3 gap-2">
        {STEPS.map((label, k) => {
          const done = k < stage;
          const cur = k === stage;
          return (
            <li
              key={label}
              aria-current={cur ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg bg-card px-3.5 py-2.5 text-sm text-muted-foreground',
                cur && 'font-semibold text-foreground ring-[1.5px] ring-primary ring-inset',
              )}
            >
              <span
                className={cn(
                  'grid size-[22px] flex-none place-items-center rounded-full font-mono text-xs',
                  done || cur
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface-3 text-muted-foreground',
                )}
              >
                {done ? <Check aria-hidden className="size-3.5" /> : k + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      {stage === 0 ? (
        <SetupSplit left={cameraMap}>
          {!demoAccount && <NextStepCard step={step1Step} />}
          <SetupModeChoice
            mode={mode}
            onChange={setPickedMode}
            reuse={demoAccount ? demoReuseShown(reuse, mode) : reuse}
            mapId={reuseMapId}
            onMapChange={setPickedMapId}
            openMaps={demoAccount}
          />
          <CameraHeightPanel
            fields={heightFields}
            onChange={onChangeHeight}
            submitError={step1Error}
            onNavigateLiveWork={
              step1BlockedByLiveWork ? () => navigateToBlockedWork(step1RawError) : undefined
            }
            errorAction={
              <BlockingSetupNotice error={step1RawError} onCancelled={clearStep1Error} />
            }
            heightWarnings={waiting.heightWarnings}
            retrySessionId={returnForHeightRetry ? sessionId : null}
            onRetryWithHeights={requestStep1Submit}
            retryLabel={pausedForHeights(currentSession) ? '이어서 만들기' : undefined}
            retryPending={restartPending}
            canSubmitHeights={heightValidation.valid}
          />
          <CameraStatusDetails coverage={shownCoverage} compact={demoAccount} />
          {riskConfirmPairs !== null && (
            <CameraRiskDialog
              riskyPairs={riskConfirmPairs}
              onConfirm={confirmRiskySubmit}
              onCancel={() => setRiskConfirmPairs(null)}
            />
          )}
        </SetupSplit>
      ) : stage === 1 ? (
        currentSession && (
          <SetupCalibrateStep
            waiting={waiting}
            cameraView={cameraMap}
            nextStep={calibrateStep}
            onOpenSupplement={supplementVisible(currentSession) ? openSupplement : undefined}
            cameraCheck={cameraCheck}
            showCameraCheck={
              cameraCheck.gated && Boolean(currentSession.calibration_version) && !waiting.failed
            }
            pollingError={sessionQuery.error}
            onRetry={handleRetryFailedSession}
            onRetryNewMap={handleRetryNewMap}
            changedCameras={currentSession.world_anchor?.changed_cameras ?? undefined}
            repeatedValidationPairs={repeatedPairs}
            retryPending={retrySession.pending}
            retryError={retrySession.error ?? cancelError}
            onNavigateLiveWork={
              retryBlockedByLiveWork
                ? () => navigateToBlockedWork(retrySession.rawError)
                : undefined
            }
            onReturnToStep1={returnToStep1}
            onTurnOnGpu={gpuOff ? () => setGpuPanelOpen(true) : undefined}
            demo={demoAccount}
          />
        )
      ) : (
        <ZoneSourceContext value={zoneSource}>
          <SetupZoneStep
            title={zoneMapTitle(waiting.sceneTier)}
            sceneVersion={sessionSceneVersion(waiting.sceneTier)}
            draftGhosts={completed ? NO_GHOSTS : draftGhosts}
            plan={
              <SetupMap
                stage={stage}
                coverage={coverage}
                drafts={draftsList}
                acceptedDraftIds={acceptedDraftIds}
                discardedDraftIds={discardedDraftIds}
              />
            }
          >
            {layoutSync.failure && (
              <div role="alert">
                구역은 발행됐지만 가상 레이아웃 반영에 실패했습니다.
                <Button disabled={layoutSync.pending} onClick={() => void layoutSync.retry()}>
                  다시 시도
                </Button>
              </div>
            )}
            {zoneSource && (canImportPrevious || unconfirmedZones > 0) && (
              <SetupZoneReviewCard
                sessionId={zoneSource.sessionId}
                cameraIds={waiting.cameraIds}
                canImport={canImportPrevious}
                pairedDrafts={draftPairs}
              />
            )}
            {!completed && (
              <AiZoneDraftsPanel
                cameraIds={waiting.cameraIds}
                draftsResponse={draftsResponse}
                acceptedDraftIds={acceptedDraftIds}
                discardedDraftIds={discardedDraftIds}
                pendingDraftId={draftAccept.pendingId}
                acceptFailure={draftAccept.failure}
                onAcceptDraft={(item) => void draftAccept.accept(item)}
                onDiscardDraft={discardSetupZoneDraft}
                mergedDraftIds={mergedDraftIds}
                canImportPrevious={canImportPrevious}
                pendingText={demoAccount ? DEMO_DRAFT_SEARCH_TEXT : undefined}
                onHoverDraft={demoAccount ? setHoveredDraftId : undefined}
              />
            )}
            {currentSession && !completed && (
              <ZonesPage placement="inline" addOnDemand setupLayoutSync={setupLayoutSync} />
            )}
            {!completed && completion.error && (
              <Alert role="alert" className="text-xs">
                {completion.error}
              </Alert>
            )}
            {currentSession && (
              <SetupCompleteCard session={currentSession} applied={completion.applied} />
            )}
          </SetupZoneStep>
        </ZoneSourceContext>
      )}
      {gpuGateDialog}
      {gpuPanelOpen && <GpuPanel onClose={() => setGpuPanelOpen(false)} />}
      <VlmZoneNotice
        active={stage === ZONE_STAGE && !completed && zoneSource !== null && !demoAccount}
        sessionId={sessionId}
      />
      {capture.open && (
        <BackgroundCaptureModal
          view={capture.view}
          secondsLeft={capture.secondsLeft}
          waitingForWorker={capture.waitingForWorker}
          waitingSeconds={capture.waitingSeconds}
          onStart={startCapture}
          onCancel={capture.view.phase === 'ready' ? capture.close : handleCancelSession}
          onRetry={handleRetryFailedSession}
          onClose={capture.close}
          cancelPending={cancelMutation.isPending}
          retryPending={retrySession.pending}
          error={capture.view.phase === 'failed' ? retrySession.error : null}
          stageAAlerts={coverage.stageAAlerts}
        />
      )}
      {walkOpen && (
        <CameraCheckModal
          view={walk}
          secondsLeft={walkSeconds}
          onStart={requestWalk}
          onStop={stopAttempt}
          startPending={startWalk.pending}
          stopPending={cancelMutation.isPending}
          error={startWalk.error}
        />
      )}
      {heightReview && !capture.open && (
        <HeightCheckModal
          review={heightReview}
          cameraIds={waiting.cameraIds}
          fields={checkFields}
          changed={checkChanged}
          canSubmit={checkValidation.valid}
          pending={resumeSession.pending}
          error={resumeSession.error}
          onChange={onChangeCheckHeight}
          onSubmit={submitHeightCheck}
        />
      )}
      {supplementOpen && currentSession && (
        <SupplementModal
          session={currentSession}
          onNext={closeSupplement}
          onCancel={closeSupplement}
          onRebaked={closeSupplement}
        />
      )}
    </div>
  );
}
