import { useSpatialData } from '@/features/viewer3d/data/SpatialDataProvider';
import type { ZoneView } from '@/features/viewer3d/data/spatialFrame';
import { LabelSprite } from '@/features/viewer3d/LabelSprite';
import { cssHex } from '@/features/viewer3d/palette';
import { ZoneRiskMark } from '@/features/viewer3d/risk/RiskMarks';
import { riskStyle, type RiskStyle } from '@/features/viewer3d/risk/riskPresentation';
import { useRiskHighlight } from '@/features/viewer3d/risk/RiskScope';
import { useScenePalette } from '@/features/viewer3d/sceneTheme';
import { Selectable } from '@/features/viewer3d/Selectable';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint, worldToThree } from '@/features/viewer3d/worldCoordinates';
import {
  aerialGuides,
  boxEdges,
  FLOOR_GUIDE_LIFT,
  isAerialZone,
  zoneBox,
} from '@/features/viewer3d/zones/zoneGeometry';
import {
  footprintMesh,
  labelVertex,
  prismEdges,
  prismMesh,
  ringEdges,
  type PolygonMesh,
} from '@/features/viewer3d/zones/zonePolygon';
import {
  personOnRay,
  ZoneApplyContext,
  zoneLabel,
  zoneSeverity,
  zoneStyle,
} from '@/features/viewer3d/zones/zonePresentation';
import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { memo, useContext, useEffect, useMemo, type ComponentProps } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import { useStore } from 'zustand';

// -47 구역 레이어. -194 Provider 의 구역(ZoneSnapshot)을 같은 Canvas·Scene 안에 zone_id 마다 하나씩 그린다.
// 구역 목록이 바뀔 때만 다시 그리고 10 Hz World 갱신에는 반응하지 않는다. 구역이 없거나 거부됐으면 아무것도 그리지 않는다.
// BE 정식 구역(-234)의 비직사각형은 다각형 기둥(PRISM), 바닥 판정 구역은 바닥면(FOOTPRINT)으로 그린다(둘레 상자로 넓히지 않는다).
// 레이어 값(-234): hidden 이면 그리지 않고, visible 이면 그리되 클릭을 받지 않는다.

const noRaycast = () => null;
/** 구역 이름표 높이(m). */
const ZONE_LABEL_HEIGHT = 0.3;
/** 이름표 아래쪽과 모서리 사이 간격(m). 윤곽선·바닥 안내선에 닿지 않게 조금 띄운다. */
const ZONE_LABEL_GAP = 0.05;
/** 이름표 중심을 모서리 위로 띄우는 높이(m). */
const ZONE_LABEL_LIFT = ZONE_LABEL_HEIGHT / 2 + ZONE_LABEL_GAP;
/** 가려진 부분을 덧그리는 선의 그리기 순서. 구역 채움(0) 뒤, 이름표(10) 앞이다. */
const HIDDEN_EDGE_ORDER = 2;
/** 윤곽선 굵기. 선택하면 굵고, 위험이 걸린 다각형 구역은 위험 모양(이중선이면 더 굵게)을 따른다. */
const EDGE_WIDTH = { normal: 1.5, selected: 2.5, risk: 2.5, riskDouble: 3.5 } as const;
/** 적용 상태는 실선인데 위험이 점선으로 걸릴 때 쓰는 점선 크기(m). */
const RISK_DASH = { dashSize: 0.2, gapSize: 0.12 } as const;
const pickPerson = (event: ThreeEvent<MouseEvent>) => personOnRay(event.intersections);

const edgeWidth = (selected: boolean, riskLook: RiskStyle | null) => {
  if (riskLook) return riskLook.double ? EDGE_WIDTH.riskDouble : EDGE_WIDTH.risk;
  return selected ? EDGE_WIDTH.selected : EDGE_WIDTH.normal;
};

interface ZoneEdgesProps {
  name?: string;
  points: ComponentProps<typeof Line>['points'];
  color: number;
  lineWidth: number;
  dashed: boolean;
  dashSize: number;
  gapSize: number;
  opacity: number;
  /** 배경에 가려진 부분을 덧그리는 선의 불투명도. */
  hiddenOpacity: number;
}

/**
 * 구역 윤곽선. 깊이 검사를 하는 선은 스캔 배경(바닥·책상·벽)에 가려지는 부분이 숨는다. 그 위에 깊이 검사 없이 흐리게
 * 한 겹을 더 그려, 가려진 부분도 윤곽이 이어져 늘 보이게 한다.
 */
const ZoneEdges = memo(function ZoneEdges({
  name,
  hiddenOpacity,
  opacity,
  ...look
}: ZoneEdgesProps) {
  const line = { segments: true, transparent: true, raycast: noRaycast, ...look };
  return (
    <>
      <Line name={name} {...line} opacity={opacity} />
      <Line
        {...line}
        opacity={hiddenOpacity}
        depthTest={false}
        depthWrite={false}
        renderOrder={HIDDEN_EDGE_ORDER}
      />
    </>
  );
});

export function ZoneLayer() {
  const zones = useSpatialData((s) => s.zones.zones);
  const layer = useStore(useViewerStore(), (s) => s.layers.zones);
  if (layer === 'hidden') return null;
  const interactive = layer === 'interactive';
  return (
    <group name="zone-layer">
      {zones.map((zone) =>
        zone.shape === 'PRISM' || zone.shape === 'FOOTPRINT' ? (
          <ZonePolygon key={zone.zoneId} zone={zone} interactive={interactive} />
        ) : (
          <ZoneVolume key={zone.zoneId} zone={zone} interactive={interactive} />
        ),
      )}
    </group>
  );
}

interface ZoneEntryProps {
  zone: ZoneView;
  interactive: boolean;
}

function ZoneVolume({ zone, interactive }: ZoneEntryProps) {
  const applyState = useContext(ZoneApplyContext);
  const selected = useStore(
    useViewerStore(),
    (s) => s.selected?.type === 'zone' && s.selected.id === zone.zoneId,
  );
  const box = zoneBox(zone);
  const palette = useScenePalette();
  // 위험 강조는 형상·적용 상태 표시와 따로 얹는다. 구역 상자·모서리·이름표는 바꾸지 않는다.
  const risk = useRiskHighlight('zone', zone.zoneId);
  const [sx, sy, sz] = box?.size ?? [0, 0, 0];
  const [, py] = box?.position ?? [0, 0, 0];
  // 같은 크기면 선 형상을 다시 만들지 않는다.
  const edges = useMemo(() => boxEdges([sx, sy, sz]), [sx, sy, sz]);
  const guides = useMemo(() => aerialGuides([sx, sy, sz], py), [sx, sy, sz, py]);
  if (!box) return null;
  const style = zoneStyle(applyState, selected, palette, zoneSeverity(zone), zone.needsReview);

  return (
    <group name={`zone-entry:${zone.zoneId}`}>
      {/* 초점은 이 그룹(상자와 모서리)의 중심이다. 안내선·이름표는 바깥에 둬 중심을 옮기지 않는다. */}
      <Selectable
        target={{ type: 'zone', id: zone.zoneId }}
        pickInstead={pickPerson}
        interactive={interactive}
      >
        <group position={box.position}>
          <mesh name={`zone-box:${zone.zoneId}`}>
            <boxGeometry args={box.size} />
            <meshBasicMaterial
              color={style.color}
              transparent
              opacity={style.fillOpacity}
              depthWrite={false}
            />
          </mesh>
          <ZoneEdges
            points={edges}
            color={style.color}
            lineWidth={edgeWidth(selected, null)}
            dashed={style.dashed}
            dashSize={style.dashSize}
            gapSize={style.gapSize}
            opacity={style.edgeOpacity}
            hiddenOpacity={style.hiddenEdgeOpacity}
          />
        </group>
      </Selectable>
      <group position={box.position}>
        {isAerialZone(zone) && (
          <Line
            points={guides}
            segments
            color={style.color}
            lineWidth={1}
            dashed
            dashSize={0.1}
            gapSize={0.1}
            transparent
            opacity={0.45}
            raycast={noRaycast}
          />
        )}
        {/* 이름표는 상자 앞쪽(World min X·min Y, 기본 시점 쪽) 모서리의 윗면 높이에 둔다.
            구역을 가리지 않고 위로 읽히며, 구역 이름만 늘 보인다. 왼쪽 띠는 심각도 색이고,
            위험이 있으면 글자 색이 위험 색이 된다. */}
        <group position={[-sx / 2, sy / 2, sz / 2]}>
          <LabelSprite
            text={zoneLabel(zone)}
            y={ZONE_LABEL_LIFT}
            height={ZONE_LABEL_HEIGHT}
            color={risk ? riskStyle(risk, palette).labelColor : undefined}
            accent={cssHex(style.color)}
          />
        </group>
        {risk && <ZoneRiskMark risk={risk} zoneId={zone.zoneId} size={[sx, sy, sz]} />}
      </group>
    </group>
  );
}

/** 버퍼 형상. 형상이 바뀌거나 내려가면 해제한다. */
function usePolygonGeometry(mesh: PolygonMesh) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    g.setIndex(mesh.indices);
    g.computeBoundingSphere();
    return g;
  }, [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/** BE 정식 비직사각형(PRISM)·바닥 판정(FOOTPRINT) 구역. 꼭짓점은 official.polygonXy 그대로다. */
function ZonePolygon({ zone, interactive }: ZoneEntryProps) {
  const applyState = useContext(ZoneApplyContext);
  const selected = useStore(
    useViewerStore(),
    (s) => s.selected?.type === 'zone' && s.selected.id === zone.zoneId,
  );
  const palette = useScenePalette();
  const risk = useRiskHighlight('zone', zone.zoneId);
  const points = zone.official!.polygonXy;
  const footprint = zone.shape === 'FOOTPRINT';
  const [zMin, zMax] = [zone.min[2], zone.max[2]];
  const mesh = useMemo(
    () => (footprint ? footprintMesh(points) : prismMesh(points, zMin, zMax)),
    [footprint, points, zMin, zMax],
  );
  const geometry = usePolygonGeometry(mesh);
  const edges = useMemo(
    () => (footprint ? ringEdges(points, FLOOR_GUIDE_LIFT) : prismEdges(points, zMin, zMax)),
    [footprint, points, zMin, zMax],
  );
  const style = zoneStyle(applyState, selected, palette, zoneSeverity(zone), zone.needsReview);
  const riskLook = risk && riskStyle(risk, palette);
  const [lx, ly] = labelVertex(points);
  // 기둥은 윗면 높이, 바닥 판정(FOOTPRINT)은 바닥에 둔다.
  const labelAt = worldToThree(worldPoint(lx, ly, footprint ? 0 : zMax));

  return (
    <group name={`zone-entry:${zone.zoneId}`}>
      <Selectable
        target={{ type: 'zone', id: zone.zoneId }}
        pickInstead={pickPerson}
        interactive={interactive}
      >
        <mesh name={`zone-polygon:${zone.zoneId}`} geometry={geometry}>
          <meshBasicMaterial
            color={style.color}
            transparent
            opacity={footprint ? style.fillOpacity + 0.06 : style.fillOpacity}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      </Selectable>
      <ZoneEdges
        name={`zone-polygon-edges:${zone.zoneId}`}
        points={edges}
        color={riskLook ? riskLook.color : style.color}
        lineWidth={edgeWidth(selected, riskLook)}
        dashed={riskLook ? riskLook.dashed : style.dashed}
        dashSize={style.dashed ? style.dashSize : RISK_DASH.dashSize}
        gapSize={style.dashed ? style.gapSize : RISK_DASH.gapSize}
        opacity={style.edgeOpacity}
        hiddenOpacity={style.hiddenEdgeOpacity}
      />
      <group position={labelAt}>
        <LabelSprite
          text={zoneLabel(zone)}
          y={ZONE_LABEL_LIFT}
          height={ZONE_LABEL_HEIGHT}
          color={riskLook?.labelColor}
          accent={cssHex(style.color)}
        />
      </group>
    </group>
  );
}
