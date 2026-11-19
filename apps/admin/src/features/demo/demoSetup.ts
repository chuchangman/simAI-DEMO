import { useCctvStore } from '@/features/cctv/cctv.store';
import type { CameraBadge } from '@/features/setup/cameraBadge';
import type { CoverageCameraView, Step1CoverageView } from '@/features/setup/setup';
import type { SetupMode } from '@/features/setup/types';
import type { ReuseChoiceState } from '@/features/setup/useReuseScene';
import { useMemo } from 'react';

// 시연 계정(features/demo/demoAccount)의 세팅 1단계 화면. 영상이 나오는 카메라는 연결됨으로 보이고, 「맵」 칸은 새 맵을 고르면 이전 맵 목록을
// 숨기고 재사용을 고르면 최근 맵 둘만 보인다. 보이는 맵은 카메라 시점 확인·추천 없이 고른다(demoReuseOpen, 서버 SetupDemoAccounts 와
// 같은 판정). 보정이 없거나 완료 전인 맵(EXCLUDED)만 기술적으로 쓸 수 없어 꺼 둔다.

/** 재사용을 골랐을 때 보이는 이전 맵 수(최근 완료 순). */
export const DEMO_REUSE_MAP_COUNT = 2;

const CONNECTED_BADGE: CameraBadge = { kind: 'READY', label: '연결됨', tone: 'ok' };

/**
 * 지금 영상이 나오는 카메라 ID 를 쉼표로 이은 글. 스토어는 영상 한 장마다 바뀌므로 연결 상태가 바뀔 때만 다시 그리게 글로 견준다.
 * 꺼 두면(시연 계정이 아니면) 늘 빈 글이다.
 */
function usePlayingCameraKey(cameraIds: readonly string[], enabled: boolean): string {
  return useCctvStore((s) =>
    enabled && s.link === 'open'
      ? cameraIds.filter((id) => s.views[id]?.phase === 'playing').join(',')
      : '',
  );
}

function asConnected(camera: CoverageCameraView): CoverageCameraView {
  return {
    ...camera,
    badge: CONNECTED_BADGE,
    tone: CONNECTED_BADGE.tone,
    guideLabel: camera.guides.length > 0 ? camera.guideLabel : '',
  };
}

/** 영상이 나오는 카메라를 연결됨으로 바꾼 1단계 카메라 상태. 모든 카메라가 그렇다면 연결 요약 글도 뺀다. 시연 계정이 아니면 그대로다. */
export function useDemoCoverage(coverage: Step1CoverageView, demo: boolean): Step1CoverageView {
  const playingKey = usePlayingCameraKey(
    coverage.cameras.map((camera) => camera.id),
    demo,
  );
  return useMemo(() => {
    if (playingKey === '') return coverage;
    const playing = new Set(playingKey.split(','));
    const cameras = coverage.cameras.map((camera) =>
      playing.has(camera.id) ? asConnected(camera) : camera,
    );
    const allPlaying = cameras.every((camera) => playing.has(camera.id));
    return {
      ...coverage,
      cameras,
      connectivitySummary: allPlaying ? '' : coverage.connectivitySummary,
    };
  }, [coverage, playingKey]);
}

/** 「맵」 칸에 보일 이전 맵: 새 맵을 골랐으면 없고, 재사용이면 최근 완료 맵 DEMO_REUSE_MAP_COUNT 개. */
export function demoReuseShown(reuse: ReuseChoiceState, mode: SetupMode): ReuseChoiceState {
  const newest = [...reuse.maps]
    .sort((a, b) => b.completedAtMs - a.completedAtMs)
    .slice(0, DEMO_REUSE_MAP_COUNT);
  return { ...reuse, maps: mode === 'NEW' ? [] : newest };
}

/**
 * 시연 계정의 이전 맵 재사용: 제외(EXCLUDED)가 아닌 맵은 카메라 시점 확인과 관계없이 모두 고를 수 있고, 추천 표시·상태 문구가 없다.
 * 기본 선택은 가장 최근에 완료된 맵이다(서버도 고른 맵이 없으면 그 맵을 쓴다). 고를 맵이 하나라도 있으면 재사용을 막지 않는다.
 */
export function demoReuseOpen(reuse: ReuseChoiceState): ReuseChoiceState {
  const maps = reuse.maps.map((map) =>
    map.status === 'EXCLUDED' ? map : { ...map, selectable: true, recommended: false, note: '' },
  );
  const newest = maps
    .filter((map) => map.selectable)
    .sort((a, b) => b.completedAtMs - a.completedAtMs)[0];
  if (!newest) return { ...reuse, maps };
  return { ...reuse, blocked: null, note: null, maps, recommendedId: newest.id };
}
