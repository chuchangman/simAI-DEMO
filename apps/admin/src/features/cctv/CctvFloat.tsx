import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { remoteNotice, tileLabel } from '@/features/cctv/cctv';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { CameraTile, StateTile } from '@/features/cctv/CctvPage';
import { useCameraStates } from '@/features/cctv/useCameraStates';
import { useCctvPreview } from '@/features/cctv/useCctvPreview';
import { bestCamera, currentPersonId } from '@/features/events/incidents';
import { targetOfKey } from '@/features/layout/spatialHost/selectionKey';
import { useFloatSpot } from '@/hooks/useFloatSpot';
import { env } from '@/lib/env';
import { FLOAT_MARGIN, type FloatSpot } from '@/lib/floatSpot';
import { useReportCctvFloatBox } from '@/store/cctvFloatBox.store';
import { useRealtimeStore } from '@/store/realtime.store';
import { Button } from '@simai/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@simai/ui/components/tooltip';
import { View } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

const KEY = 'simai.cctv.float';
type Settings = {
  spot?: FloatSpot;
  width?: number;
  height?: number;
};
function readSettings(): Settings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!value || typeof value !== 'object') return {};
    const v = value as Record<string, unknown>;
    const p = v.spot as Record<string, unknown> | undefined;
    return {
      spot:
        p &&
        typeof p.left === 'number' &&
        Number.isFinite(p.left) &&
        typeof p.offset === 'number' &&
        Number.isFinite(p.offset)
          ? { left: p.left, offset: p.offset }
          : undefined,
      width:
        typeof v.width === 'number' && Number.isFinite(v.width)
          ? Math.min(1000, Math.max(280, v.width))
          : undefined,
      height:
        typeof v.height === 'number' && Number.isFinite(v.height)
          ? Math.min(800, Math.max(180, v.height))
          : undefined,
    };
  } catch {
    return {};
  }
}
function saveSettings(update: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readSettings(), ...update }));
  } catch {
    /* 저장소를 쓸 수 없어도 창은 동작한다. */
  }
}

export interface CctvCameraRequest {
  readonly cameraId: string;
  readonly seq: number;
}

type Attach = (cameraId: string, canvas: HTMLCanvasElement | null) => void;
/** 창이 지금 보이는 카메라를 위로 알린다(제목 줄의 「3D 에서 이 방향으로 보기」가 쓴다, -626). */
type OnCurrent = (cameraId: string | undefined) => void;
function Content({
  attach,
  selectedKey,
  requestedCamera,
  onCurrent,
}: {
  attach?: Attach;
  selectedKey: string | null;
  requestedCamera?: CctvCameraRequest | null;
  onCurrent?: OnCurrent;
}) {
  const [camera, setCamera] = useState(requestedCamera?.cameraId ?? '');
  const link = useCctvStore((s) => s.link);
  const relayIds = useCctvStore((s) => s.cameras);
  const { cameras, stateOf } = useCameraStates();
  const baseIds =
    attach && link === 'open' && relayIds.length ? relayIds : cameras.map((c) => c.id);
  const ids =
    requestedCamera?.cameraId && !baseIds.includes(requestedCamera.cameraId)
      ? [...baseIds, requestedCamera.cameraId]
      : baseIds;
  const selectedTarget = targetOfKey(selectedKey);
  const selectedPerson = selectedTarget?.type === 'person' ? selectedTarget.id : null;
  // 고른 사람의 지금 World ID. 병합으로 그 ID 가 다른 트랙의 별칭이 되면 바뀐다(-661).
  const personNow = useRealtimeStore((s) =>
    currentPersonId(s.world?.payload.tracks, selectedPerson),
  );
  useEffect(() => {
    const target = targetOfKey(selectedKey);
    const best = bestCamera(
      useRealtimeStore.getState().world?.payload.tracks,
      target?.type === 'person' ? { type: 'person', id: target.id } : null,
    );
    if (best) {
      // 외부 3D 선택이 바뀐 순간에만 카메라를 갱신한다.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCamera(best);
    }
  }, [selectedKey]);
  // 고른 사람이 병합으로 다른 World ID 에 흡수되면 그 사람(생존 트랙) 기준으로 다시 고른다. 처음 나타나거나 사라질 때는
  // 그대로 둔다(카메라 마커로 고른 카메라를 덮지 않게).
  const lastPerson = useRef(personNow);
  useEffect(() => {
    const prev = lastPerson.current;
    lastPerson.current = personNow;
    if (!prev || !personNow || prev === personNow) return;
    const best = bestCamera(useRealtimeStore.getState().world?.payload.tracks, {
      type: 'person',
      id: personNow,
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (best) setCamera(best);
  }, [personNow]);
  // 마운트 때 두 효과가 모두 돌므로 마커 요청이 뒤에 와야 사람 선택에 덮이지 않는다.
  useEffect(() => {
    if (!requestedCamera) return;
    // 3D 카메라 마커를 클릭하면 이미 열려 있는 창도 해당 카메라로 바꾼다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCamera(requestedCamera.cameraId);
  }, [requestedCamera]);
  // 창은 늘 카메라 하나만 보인다. 고른 카메라가 중계 목록에 없으면 첫 카메라를 보인다.
  const current = ids.includes(camera) ? camera : ids[0];
  useEffect(() => {
    onCurrent?.(current);
  }, [current, onCurrent]);
  return (
    <>
      {attach && link !== 'open' && (
        <p role="status" className="px-2 pt-2 text-xs">
          {tileLabel(undefined, link)}
        </p>
      )}
      {!current ? (
        <p role="status" className="p-3">
          카메라 연결 정보가 없습니다
        </p>
      ) : (
        <div className="min-h-0 flex-1 p-2">
          <div key={current} className="min-h-0 min-w-0">
            {attach ? (
              <CameraTile cameraId={current} attach={attach} state={stateOf(current)} />
            ) : (
              <StateTile cameraId={current} state={stateOf(current)} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
function AdminContent({
  selectedKey,
  requestedCamera,
  onCurrent,
}: {
  selectedKey: string | null;
  requestedCamera?: CctvCameraRequest | null;
  onCurrent?: OnCurrent;
}) {
  const { attach, resume } = useCctvPreview(env.VITE_CCTV_PREVIEW_URL, env.VITE_STOMP_URL);
  const link = useCctvStore((s) => s.link);
  const mode = useCctvStore((s) => s.mode);
  const pause = useCctvStore((s) => s.pause);
  const remote = useCctvStore((s) => s.remote);
  const notice = remoteNotice(mode, pause, remote);
  return (
    <>
      <Content
        attach={attach}
        selectedKey={selectedKey}
        requestedCamera={requestedCamera}
        onCurrent={onCurrent}
      />
      {notice && <p role="status">{notice.text}</p>}
      {(notice?.resumable || link === 'stopped') && (
        <button type="button" onClick={resume}>
          다시 보기
        </button>
      )}
    </>
  );
}
const VIEW_FROM_CAMERA_LABEL = '3D 에서 이 방향으로 보기';
const NO_CAMERA_REASON = '보이는 카메라가 없습니다';

/**
 * 제목 줄의 「3D 에서 이 방향으로 보기」 아이콘 버튼(-626). 누르면 3D 시점을 창이 보이는 카메라 자리·방향으로 옮긴다.
 * 옮길 수 없으면 끄고 이유를 이름표로 보인다. 꺼진 버튼은 포인터를 받지 않으므로 감싼 자리에 이름표를 단다.
 */
function ViewFromCameraButton({
  cameraId,
  blockReason,
  onView,
}: {
  cameraId: string | undefined;
  blockReason: (cameraId: string) => string | null;
  onView: (cameraId: string) => void;
}) {
  const reasonId = useId();
  const reason = cameraId ? blockReason(cameraId) : NO_CAMERA_REASON;
  const icon = <View aria-hidden />;
  if (reason !== null || !cameraId) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled
            aria-label={VIEW_FROM_CAMERA_LABEL}
            aria-describedby={reasonId}
          >
            {icon}
          </Button>
          <span id={reasonId} className="sr-only">
            {reason}
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={VIEW_FROM_CAMERA_LABEL}
            onClick={() => onView(cameraId)}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{VIEW_FROM_CAMERA_LABEL}</TooltipContent>
    </Tooltip>
  );
}

export function CctvFloat({
  onClose,
  onFullView,
  onViewFromCamera,
  viewFromCameraBlock = () => null,
  selectedKey,
  requestedCamera = null,
}: {
  onClose: () => void;
  /** 3D 가 카메라 시점 보기 중일 때만 넘긴다(-590). 누르면 3D 를 클릭 전 시점으로 돌린다. */
  onFullView?: () => void;
  /**
   * 「3D 에서 이 방향으로 보기」를 눌렀을 때 창이 보이는 카메라 ID 로 부른다(-626). 넘기지 않으면 버튼을 두지 않는다.
   * 카메라 마커를 눌러 창을 열 때는 시점을 옮기지 않고 이 버튼으로만 옮긴다.
   */
  onViewFromCamera?: (cameraId: string) => void;
  /** 그 카메라로 시점을 옮길 수 없으면 이유(이름표 문구), 옮길 수 있으면 null(-626). */
  viewFromCameraBlock?: (cameraId: string) => string | null;
  selectedKey: string | null;
  requestedCamera?: CctvCameraRequest | null;
}) {
  const [initial] = useState(readSettings);
  const [size, setSize] = useState({ width: initial.width ?? 480, height: initial.height ?? 360 });
  const box = useRef<HTMLElement>(null);
  const saveSpot = useCallback((spot: FloatSpot) => saveSettings({ spot }), []);
  const spot = useFloatSpot(box, 'top', FLOAT_MARGIN, initial.spot ?? null, saveSpot);
  const [collapsed, setCollapsed] = useState(false);
  // 이벤트 패널이 이 창을 비켜 서도록 자리를 알린다(끄는 동안은 알리지 않고 놓은 뒤에, 접으면 비운다).
  const layoutKey = `${spot.style?.left},${spot.style?.top},${size.width}x${size.height}`;
  useReportCctvFloatBox(box, { dragging: spot.dragging, collapsed, layoutKey });
  const isAdmin = useCurrentRole() === 'ADMIN';
  // 창이 보이는 카메라. 접어 Content 가 내려가도 마지막 값을 쥔다.
  const [currentCamera, setCurrentCamera] = useState<string | undefined>(requestedCamera?.cameraId);
  useEffect(() => {
    if (requestedCamera) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(false);
    }
  }, [requestedCamera]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!collapsed && el.offsetWidth && el.offsetHeight) {
        setSize((prev) =>
          prev.width === el.offsetWidth && prev.height === el.offsetHeight
            ? prev
            : { width: el.offsetWidth, height: el.offsetHeight },
        );
        saveSettings({ width: el.offsetWidth, height: el.offsetHeight });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsed]);
  return (
    <section
      ref={box}
      aria-label="떠 있는 CCTV"
      style={{
        ...spot.style,
        width: size.width,
        height: collapsed ? 'auto' : size.height,
        resize: collapsed ? 'none' : 'both',
      }}
      className="absolute top-32 left-24 z-[7] flex max-h-[calc(100%-5rem)] max-w-[calc(100%-2rem)] min-w-[280px] flex-col overflow-auto rounded-xl bg-card shadow-float ring-1 ring-border"
    >
      <div className="flex items-center gap-2 p-2">
        <div
          {...spot.handlers}
          className="flex-1 cursor-grab touch-none font-semibold select-none"
          aria-label="CCTV 창 이동"
        >
          CCTV ⋮⋮
        </div>
        {onViewFromCamera && (
          <TooltipProvider>
            <ViewFromCameraButton
              cameraId={currentCamera}
              blockReason={viewFromCameraBlock}
              onView={onViewFromCamera}
            />
          </TooltipProvider>
        )}
        {onFullView && (
          <button type="button" aria-label="3D 전체 보기" onClick={onFullView}>
            전체 보기
          </button>
        )}
        <button
          type="button"
          aria-label={collapsed ? 'CCTV 펼치기' : 'CCTV 접기'}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '펼치기' : '접기'}
        </button>
        <button type="button" aria-label="떠 있는 CCTV 닫기" onClick={onClose}>
          닫기
        </button>
      </div>
      {!collapsed &&
        (isAdmin ? (
          <AdminContent
            selectedKey={selectedKey}
            requestedCamera={requestedCamera}
            onCurrent={setCurrentCamera}
          />
        ) : (
          <Content
            selectedKey={selectedKey}
            requestedCamera={requestedCamera}
            onCurrent={setCurrentCamera}
          />
        ))}
    </section>
  );
}
