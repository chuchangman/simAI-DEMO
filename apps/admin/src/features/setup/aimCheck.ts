import type { AimCheck, AimCheckItem, AimStatus } from '@/features/setup/types';

// 기준 시점 맞추기(S15P31A101-765): 헬퍼가 카메라마다 기준 사진(가장 최근 CALIBRATED 세팅)과 비교해 보낸 교정 각도를 쉬운 말로 바꾼다.
// 판정(두 단계 허용 오차·2라운드 히스테리시스)은 헬퍼가 정해 보낸 status 를 그대로 쓰고, 화면은 다시 계산하지 않는다.
// 초록 ALIGNED = 기준과 같음(재사용 가능), 노랑 NEAR = 새 맵 세팅엔 충분, 그 밖은 화살표·각도.

/** 4칸 모두 기준과 같을 때 보이는 한 줄. 기본 맵 방식(-762 새 맵)은 바꾸지 않는다. */
export const AIM_ALL_ALIGNED_TEXT = '기준 시점과 같음 — 이전 맵 재사용도 안전';

/** 4칸 모두 노랑 이상일 때(초록만은 아님) 보이는 한 줄. */
export const AIM_ALL_SETUP_READY_TEXT = '새 맵 세팅 시작해도 됨';

/** 겹쳐 보기 켜고 끄기 단추 글. */
export const AIM_OVERLAY_LABEL = '기준 사진 겹쳐 보기';

/** 기준 사진을 겹칠 때의 불투명도. 지금 영상과 기준 사진이 같은 무게로 보여야 어긋남이 이중선으로 드러난다. */
export const AIM_OVERLAY_OPACITY = 0.5;

const UNKNOWN_TEXT: Record<string, string> = {
  NO_REFERENCE: '기준 사진 없음',
  NO_VIDEO: '영상 없음',
  STALE: '영상 없음',
  NO_TEXTURE: '기준 사진에 무늬가 적어 비교 못 함',
  FEW_MATCHES: '기준과 많이 달라 비교 못 함 (크게 돌았거나 가려짐)',
  NOT_ROTATION: '돌려서는 맞출 수 없음 (위치가 바뀌었거나 가려짐)',
  STREAM_MISMATCH: '영상 비율이 달라 비교 못 함',
};

export interface AimCameraView {
  status: AimStatus;
  /** 재사용 허용 오차 안(칸 테두리 초록). */
  aligned: boolean;
  /** 새 맵 세팅 허용 오차 안(초록 또는 노랑). */
  setupReady: boolean;
  /** 돌릴 양 쉬운 말. 예: ['오른쪽으로 1.2°', '위로 0.4°']. 허용 오차 안이거나 모르면 빈 배열. */
  steps: string[];
  /** 칸에 보이는 한 줄. */
  text: string;
  /** 기준 영상 중심이 지금 영상에 보이는 곳(0~1). 영상 밖이거나 모르면 null. */
  target: readonly [number, number] | null;
  /** 돌릴 쪽 화살표 방향(영상 좌표 라디안: 0 오른쪽, +π/2 아래). 광축이 허용 오차 안이거나 모르면 null. */
  arrowRad: number | null;
}

const deg = (rad: number) => (rad * 180) / Math.PI;

/** 각도 하나를 '오른쪽으로 1.2°' 처럼. 0.05° 보다 작으면(소수 첫째 자리 0) 뺀다. */
function step(rad: number, plus: string, minus: string, suffix = ''): string | null {
  const value = Math.abs(deg(rad));
  if (value < 0.05) return null;
  return `${rad > 0 ? plus : minus} ${value.toFixed(1)}°${suffix}`;
}

/** 돌릴 양 문장들. 광축(좌우·상하)은 광축 차가 허용 오차를 넘을 때만, 기울기는 기울기가 허용 오차를 넘을 때만 보인다. */
export function aimSteps(
  item: AimCheckItem,
  check: Pick<AimCheck, 'max_aim_rad' | 'max_roll_rad'>,
): string[] {
  if (item.pan_rad === null || item.tilt_rad === null || item.roll_rad === null) return [];
  const out: (string | null)[] = [];
  if (Math.hypot(item.pan_rad, item.tilt_rad) > check.max_aim_rad) {
    out.push(step(item.pan_rad, '오른쪽으로', '왼쪽으로'), step(item.tilt_rad, '위로', '아래로'));
  }
  if (Math.abs(item.roll_rad) > check.max_roll_rad) {
    out.push(step(item.roll_rad, '시계 방향으로', '반시계 방향으로', ' (뒤에서 볼 때)'));
  }
  return out.filter((s): s is string => s !== null);
}

/** 헬퍼 결과 한 카메라 → 칸 표시. */
export function aimCameraView(item: AimCheckItem, check: AimCheck): AimCameraView {
  const steps = item.status === 'MISALIGNED' || item.status === 'NEAR' ? aimSteps(item, check) : [];
  const text =
    item.status === 'ALIGNED'
      ? '기준과 같음 (재사용 가능)'
      : item.status === 'NEAR'
        ? steps.length > 0
          ? `새 맵 세팅엔 충분 · 재사용하려면 ${steps.join(' · ')}`
          : '새 맵 세팅엔 충분'
        : item.status === 'MISALIGNED'
          ? steps.length > 0
            ? `${steps.join(' · ')} 돌려 주세요`
            : '기준에 거의 맞음'
          : (UNKNOWN_TEXT[item.reason ?? ''] ?? '비교 못 함');
  return {
    status: item.status,
    aligned: item.status === 'ALIGNED',
    setupReady: item.status === 'ALIGNED' || item.status === 'NEAR',
    steps,
    text,
    target: item.status === 'UNKNOWN' ? null : item.target_point,
    arrowRad: item.status === 'UNKNOWN' ? null : item.arrow_rad,
  };
}

/** 카메라 ID → 칸 표시. 결과가 없으면 빈 Map(지금 화면 그대로). */
export function aimViews(check: AimCheck | null | undefined): Map<string, AimCameraView> {
  const out = new Map<string, AimCameraView>();
  if (!check) return out;
  for (const item of check.cameras) out.set(item.camera_id, aimCameraView(item, check));
  return out;
}

/** 이 화면의 카메라가 모두 기준과 같은지(한 대라도 모르면 아니다). */
export function allAimAligned(
  cameraIds: readonly string[],
  views: ReadonlyMap<string, AimCameraView>,
) {
  return cameraIds.length > 0 && cameraIds.every((id) => views.get(id)?.aligned === true);
}

/** 이 화면의 카메라가 모두 노랑 이상(새 맵 세팅엔 충분)인지. */
export function allAimSetupReady(
  cameraIds: readonly string[],
  views: ReadonlyMap<string, AimCameraView>,
) {
  return cameraIds.length > 0 && cameraIds.every((id) => views.get(id)?.setupReady === true);
}
