import { PALETTE } from '@/features/viewer3d/palette';
import { useBackgroundShown } from '@/features/viewer3d/scene/useBackgroundShown';
import type { ViewerMode } from '@/features/viewer3d/types';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { WorldScene } from '@/features/viewer3d/WorldScene';
import { useStore } from 'zustand';

// 기준 장면: 조명·1m 격자·World 바닥과 벽 경계. 격자 선은 World 원점(Three 원점)을 지나는 1m 간격이다.
// 격자 색은 장면 색표(palette)를 따른다. 격자는 스캔(정적 배경)이 없을 때의 목업 바탕이라 스캔이 보이는 동안은 숨긴다.
const GRID_SIZE = 20;

// 모드마다 기준 격자 농도를 달리해 실시간 화면과 구분한다. 모드별 장면 내용은 후속 티켓에서 붙인다.
const GRID_OPACITY: Record<ViewerMode, number> = { LIVE: 0.5, PLANNED: 0.3, REPLAY: 0.2 };

export function SceneBase() {
  const store = useViewerStore();
  const mode = useStore(store, (s) => s.mode);
  const theme = useStore(store, (s) => s.theme);
  const palette = PALETTE[theme];
  const backgroundShown = useBackgroundShown();

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1} />
      {/* 격자 색은 만들 때만 정해져 테마가 바뀌면 다시 만든다. */}
      <gridHelper
        key={theme}
        visible={!backgroundShown}
        args={[GRID_SIZE, GRID_SIZE, palette.gridCenter, palette.gridLine]}
        material-transparent
        material-opacity={GRID_OPACITY[mode]}
      />
      <WorldScene />
    </>
  );
}
