import type { SpatialDataState } from '@/features/viewer3d/data/spatialData.store';
import { useSpatialData, useSpatialDataStore } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  trackPlacement,
  type TrackView,
  type WorldFrame,
} from '@/features/viewer3d/data/spatialFrame';
import { LabelSprite } from '@/features/viewer3d/LabelSprite';
import { PALETTE, type ScenePalette } from '@/features/viewer3d/palette';
import {
  applyAvatarAppearanceToMaterials,
  AVATAR_ENV_MAP_INTENSITY,
  AVATAR_PBR_METALNESS,
  AVATAR_PBR_ROUGHNESS,
  avatarAppearanceKey,
  updateAvatarBaseColors,
  useAvatarAppearance,
  useAvatarPmremEnvMap,
  type AvatarAppearanceTextures,
  type AvatarFacePolicy,
} from '@/features/viewer3d/people/avatarAppearance';
import {
  avatarAssetKey,
  avatarAssetState,
  AvatarMeshContext,
  instantiateAvatarMesh,
  useAvatarMesh,
  type AvatarMeshAsset,
} from '@/features/viewer3d/people/avatarMesh';
import {
  AVATAR_PLAYBACK_DELAY_MS,
  avatarMeshStatus,
} from '@/features/viewer3d/people/avatarMeshPolicy';
import {
  instantiateAvatar,
  useAvatarModel,
  type AvatarInstance,
  type AvatarModel,
} from '@/features/viewer3d/people/avatarModel';
import { applyPose, PosePlayer } from '@/features/viewer3d/people/avatarPose';
import { CAPSULE } from '@/features/viewer3d/people/capsuleShape';
import { PersonHighlight } from '@/features/viewer3d/people/PersonHighlight';
import {
  approach,
  approachAngle,
  headingFromSamples,
  isWalking,
  needsSnap,
  personPose,
  personTone,
  POSITION_RATE,
  WALK_RATE,
  YAW_RATE,
  type PersonPose,
  type PersonTone,
} from '@/features/viewer3d/people/personMotion';
import { PpeWarningMark } from '@/features/viewer3d/people/ppe/PpeWarningMark';
import { SkeletonBody } from '@/features/viewer3d/people/SkeletonBody';
import {
  skeletonFigure,
  skeletonUsable,
  type SkeletonFigure,
} from '@/features/viewer3d/people/skeletonPose';
import { PersonRiskMark } from '@/features/viewer3d/risk/RiskMarks';
import { riskStyle } from '@/features/viewer3d/risk/riskPresentation';
import { useRiskHighlight } from '@/features/viewer3d/risk/RiskScope';
import { useScenePalette } from '@/features/viewer3d/sceneTheme';
import { Selectable } from '@/features/viewer3d/Selectable';
import type { ViewerLabelCell } from '@/features/viewer3d/types';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Vector3, type Group, type Material, type MeshStandardMaterial, type Texture } from 'three';
import { useStore } from 'zustand';

// -44 사람 레이어. -194 Provider 의 World 를 같은 Canvas·Scene 안에서 world_id 마다 하나씩 그린다.
// React 는 사람 목록이 바뀔 때만 다시 그리고, 10 Hz 위치·방향·걷기 동작은 useFrame 에서 기존 Group 만 바꾼다.

/** 사람 모델 주소(XBot 같은 리깅 glTF). 없으면 캡슐 아바타. 배포 경로가 정해지기 전에는 개발 화면만 넘긴다. */
export const PersonModelContext = createContext<string | null>(null);

// 몸·관절·선택·이름표 색은 장면 색표(palette)를 따른다.
type PersonColor = ScenePalette['person'];
const OPACITY: Record<PersonTone, number> = { observed: 1, predicted: 0.45, unknown: 0.3 };
const LABEL_Y = 2.05;
const COLUMN_TOP = 2.0;
/** 골격 머리가 없을 때 경고 표식을 두는 높이(캡슐 머리 구 1.58 m 위, -531). */
const HELMET_Y = 1.64;
const noRaycast = () => null;

const NO_LAST_VALID: ThreePoint | null = null;
// 렌더에서 표시 종류만 고를 때 쓰는 자리표시자. 실제 위치는 useFrame 이 마지막 유효 위치로 정한다.
const SOME_LAST_VALID = [0, 0, 0] as unknown as ThreePoint;
const DEFAULT_PERSON_CELLS: readonly ViewerLabelCell[] = Object.freeze([
  { kind: 'text', text: '미확인' },
]);

const trackOf = (world: WorldFrame | null, worldId: string): TrackView | undefined =>
  world?.tracks.find((track) => track.worldId === worldId);

/** 사람 목록(순서 유지). 문자열로 묶어 목록이 같으면 다시 그리지 않는다. */
const selectIds = (state: SpatialDataState) =>
  (state.world?.tracks ?? []).map((track) => track.worldId).join('\n');

/** 이 사람의 표시가 바뀌는 상태만 묶는다(관측 상태·위치 근거·골격 사용 여부·ID 교정). 좌표는 넣지 않는다. */
function statusKey(state: SpatialDataState, worldId: string) {
  const track = trackOf(state.world, worldId);
  if (!track) return '';
  return [
    track.observationState,
    trackPlacement(track).basis,
    skeletonUsable(track) ? 'SKELETON' : 'BODY',
    track.identityRevision,
  ].join('|');
}

/** 이름의 문자 코드로 0~1 위상을 만든다. 사람마다 동작 시작점이 어긋나게 한다. */
const phaseOf = (id: string) => ([...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 97) / 97;

export function PersonLayer() {
  const sourceId = useSpatialData((s) => s.sourceId);
  const idsKey = useSpatialData(selectIds);
  const ids = useMemo(() => (idsKey ? idsKey.split('\n') : []), [idsKey]);
  const model = useAvatarModel(useContext(PersonModelContext));
  const envMap = useAvatarPmremEnvMap();
  return (
    <group name="person-layer">
      {ids.map((id) => (
        // Source 가 바뀌면 key 가 달라져 이전 Source 의 위치·방향·동작 기록을 이어받지 않는다.
        <PersonAvatar key={`${sourceId}:${id}`} worldId={id} model={model} envMap={envMap} />
      ))}
    </group>
  );
}

interface Motion {
  world: WorldFrame | null;
  pose: PersonPose | null;
  lastValid: ThreePoint | null;
  revision: number | null;
  sampleAt: number;
  observation: TrackView['observationState'];
  display: [number, number, number];
  yaw: number;
  heading: number | null;
  speed: number;
  /** 0 = idle, 1 = walk. */
  walk: number;
  /** 이번 표본의 Tier 0 골격 모양(발 위치 기준). 골격을 쓸 수 없으면 null. */
  figure: SkeletonFigure | null;
  /** 이번 표본의 Tier 0 pelvis(Three). 메시 정렬 기준. 없으면 null. */
  pelvis: ThreePoint | null;
}

function PersonAvatar({
  worldId,
  model,
  envMap,
}: {
  worldId: string;
  model: AvatarModel | null;
  envMap: Texture;
}) {
  const store = useSpatialDataStore();
  const viewerStore = useViewerStore();
  const selected = useStore(
    viewerStore,
    (s) => s.selected?.type === 'person' && s.selected.id === worldId,
  );
  // 호스트가 넘긴 사람 이름표 칸 목록(-658 A안). 있으면 World ID 대신 [선택 워치 아이콘 칸 + 이름 칸 + PPE 칸]을 그린다.
  const useCellLabels = useStore(viewerStore, (s) => s.personLabels !== null);
  const labelCells = useStore(viewerStore, (s) => s.personLabels?.[worldId] ?? null);
  // 레거시 문자열 배지(-342, personLabels 를 넘기지 않는 단독 시험·하네스용).
  const badge = useStore(viewerStore, (s) => s.personBadges[worldId] ?? null);
  // 호스트가 잠깐 켜는 강조(-509 워치 연결 순간). 고리 펄스와 큰 이름표
  const highlight = useStore(viewerStore, (s) => s.personHighlights[worldId] ?? null);
  // 호스트가 따진 안전모·조끼 상태(-531·-552). 장비 형상은 그리지 않고(-783), 하나라도 미착용이면 경고 표식만 보인다
  const notWorn = useStore(
    viewerStore,
    (s) => s.personHelmets[worldId] === 'NOT_WORN' || s.personVests[worldId] === 'NOT_WORN',
  );
  // 관측 상태·위치 근거·연결이 바뀔 때만 다시 그린다.
  useSpatialData((s) => statusKey(s, worldId));
  // 위험 강조는 이벤트가 바뀔 때만 달라진다. 위치·동작 기록(motion)은 그대로 둔다.
  const risk = useRiskHighlight('person', worldId);
  const palette = useScenePalette();
  const [hasLastValid, setHasLastValid] = useState(false);
  // EXP-02 메시(-65). 자산 key 가 바뀔 때만 다시 그린다(포즈는 5 Hz 로 오지만 useFrame 에서만 읽는다).
  const meshConfig = useContext(AvatarMeshContext);
  const meshKey = useSpatialData((s) => {
    const asset = meshConfig.enabled ? s.avatars.get(worldId)?.asset : undefined;
    return asset ? avatarAssetKey(asset) : null;
  });
  const { mesh } = useAvatarMesh(
    meshKey,
    () => store.getState().avatars.get(worldId)?.asset ?? null,
    meshConfig.fetch,
  );
  // EXP-02 외형 텍스처(-359). 사람(worldId)별 appearance_version 이 바뀔 때만 새로 받는다.
  const appearanceKey = useSpatialData((s) =>
    meshConfig.enabled ? avatarAppearanceKey(worldId, s.avatars.get(worldId)) : null,
  );
  const facePolicy = useSpatialData((s) =>
    meshConfig.enabled ? (s.avatars.get(worldId)?.asset?.facePolicy ?? 'EXCLUDED') : 'EXCLUDED',
  );
  const { appearance } = useAvatarAppearance(
    worldId,
    appearanceKey,
    () => store.getState().avatars.get(worldId),
    meshConfig.fetch,
  );
  const [player] = useState(() => new PosePlayer());
  const [meshUse, setMeshUse] = useState(false);
  const meshUseRef = useRef(meshUse);
  const root = useRef<Group>(null);
  // 위험 표식 자리. 선택 그룹 밖에 두어 초점 중심·클릭 경계에 끼지 않게 하고, 위치만 아바타를 따라간다.
  const riskRoot = useRef<Group>(null);
  // 골격 자리. 루트는 보간되며 따라가지만 관절·접지 고리는 표본의 World 위치에 그대로 있어야 해서, 보간 차이만큼 되돌린다.
  const skeletonRoot = useRef<Group>(null);
  // 표식이 새로 붙는 순간에도 원점에 한 프레임 보이지 않게 지금 아바타 위치에서 시작한다.
  const attachRisk = useCallback((group: Group | null) => {
    riskRoot.current = group;
    if (group && root.current) group.position.copy(root.current.position);
  }, []);
  const body = useRef<Group>(null);
  const motion = useRef<Motion>({
    world: null,
    pose: null,
    lastValid: null,
    revision: null,
    sampleAt: 0,
    observation: 'OBSERVED',
    display: [0, 0, 0],
    yaw: 0,
    heading: null,
    speed: 0,
    walk: 0,
    figure: null,
    pelvis: null,
  });

  useFrame((_, dt) => {
    const group = root.current;
    const data = store.getState();
    const m = motion.current;
    if (!group || !data.world) return;

    // 새 World 표본이 왔을 때만 목표를 다시 정한다.
    if (data.world !== m.world) {
      m.world = data.world;
      const track = trackOf(data.world, worldId);
      if (track) {
        const pose = personPose(track, m.lastValid);
        const at = data.world.meta.receivedAt;
        let { heading, speed } = pose;
        // 계약 velocity 가 없으면 연속한 두 관측 위치로만 방향을 구한다.
        if (heading === null && pose.fresh && pose.feet && m.pose?.fresh && m.pose.feet) {
          const derived = headingFromSamples(m.pose.feet, pose.feet, at - m.sampleAt);
          if (derived && track.observationState === 'OBSERVED') ({ heading, speed } = derived);
        }
        const snap = needsSnap(
          m.pose,
          pose,
          m.revision !== null && m.revision !== track.identityRevision,
        );
        if (pose.fresh && pose.feet) {
          m.lastValid = pose.feet;
          if (!hasLastValid) setHasLastValid(true);
        }
        m.pose = pose;
        m.revision = track.identityRevision;
        m.sampleAt = at;
        m.observation = track.observationState;
        m.speed = speed;
        m.pelvis = track.pelvis ? worldToThree(track.pelvis) : null;
        // 관절은 이번 표본의 목표 발 위치 기준으로 둔다. 확인된 접지면 그 지지면 높이까지 발 막대를 잇는다.
        const placement = trackPlacement(track);
        m.figure =
          pose.fresh && pose.feet && skeletonUsable(track)
            ? skeletonFigure(
                track.skeleton!,
                pose.feet,
                placement.basis === 'GROUND_ANCHOR' ? placement.world[2] : null,
              )
            : null;
        if (heading !== null) m.heading = heading;
        if (snap) {
          const target = pose.feet ?? [pose.columnXz![0], 0, pose.columnXz![1]];
          m.display = [target[0], target[1], target[2]];
          if (m.heading !== null) m.yaw = m.heading;
        }
      }
    }

    const pose = m.pose;
    if (!pose) return;
    const target = pose.feet ?? [pose.columnXz![0], 0, pose.columnXz![1]];
    m.display = [
      approach(m.display[0], target[0], dt, POSITION_RATE),
      approach(m.display[1], target[1], dt, POSITION_RATE),
      approach(m.display[2], target[2], dt, POSITION_RATE),
    ];
    group.position.set(...m.display);
    riskRoot.current?.position.set(...m.display);
    // 골격은 보간하지 않는다: 루트(이름표·선택·위험 표식)는 부드럽게 따라가도 관절은 늘 이번 표본의 World 위치다.
    if (skeletonRoot.current && pose.feet) {
      skeletonRoot.current.position.set(
        pose.feet[0] - m.display[0],
        pose.feet[1] - m.display[1],
        pose.feet[2] - m.display[2],
      );
    }
    if (m.heading !== null) m.yaw = approachAngle(m.yaw, m.heading, dt, YAW_RATE);
    if (body.current) body.current.rotation.y = m.yaw;
    const walking = isWalking({
      speed: m.speed,
      observationState: m.observation,
      connectionOpen: data.connection?.state === 'OPEN',
      frameAgeMs: Date.now() - m.sampleAt,
      fresh: pose.fresh,
    });
    m.walk = approach(m.walk, walking ? 1 : 0, dt, WALK_RATE);

    // 메시를 쓸지 프레임마다 다시 본다(끊김·늦음은 시간이 지나며 생긴다). 바뀔 때만 다시 그린다.
    const track = trackOf(data.world, worldId);
    if (track) {
      const avatar = meshConfig.enabled ? data.avatars.get(worldId) : undefined;
      if (avatar) player.push(avatar);
      const status = avatarMeshStatus({
        enabled: meshConfig.enabled,
        track,
        world: data.world,
        avatar,
        asset: avatarAssetState(avatar?.asset ?? null),
        now: Date.now(),
      });
      if (status.use !== meshUseRef.current) {
        meshUseRef.current = status.use;
        setMeshUse(status.use);
      }
    }
  });

  const { world } = store.getState();
  const track = trackOf(world, worldId);
  if (!track) return null;
  // 표시 종류·이름표만 정한다. 좌표는 useFrame 이 마지막 유효 위치로 채운다.
  const pose = personPose(track, hasLastValid ? SOME_LAST_VALID : NO_LAST_VALID);
  const tone = personTone(track);
  // Tier 0 골격을 쓸 수 있으면 관절 사이 막대 아바타로, 아니면 -44 의 기본 캡슐(또는 개발용 모델)로 그린다.
  const skeleton = pose.kind === 'BODY' && skeletonUsable(track);
  const placement = trackPlacement(track).basis;
  const meshOn = meshUse && mesh !== null && pose.kind === 'BODY';
  // 메시가 보이는 사람은 골격 막대를 그리지 않으므로 미착용 표식도 캡슐 머리 위에 둔다.
  const skeletonOn = skeleton && !meshOn;

  return (
    <>
      <Selectable target={{ type: 'person', id: worldId }}>
        {meshOn && mesh && (
          // 메시는 보간되는 루트 밖에 둔다. 관절은 재생 지연만큼 늦지만 pelvis 는 늘 이번 표본의 Tier 0 위치다.
          <MeshBody
            key={mesh.key}
            mesh={mesh}
            player={player}
            motion={motion}
            tone={tone}
            selected={selected}
            color={palette.person}
            appearance={appearance}
            facePolicy={facePolicy}
            envMap={envMap}
          />
        )}
        <group ref={root} name={`person-avatar:${worldId}`}>
          {skeletonOn ? (
            <group ref={skeletonRoot} name="person-skeleton-root">
              <SkeletonBody
                motion={motion}
                color={bodyColor(palette.person, tone, selected)}
                opacity={OPACITY[tone]}
                anchor={
                  placement === 'GROUND_ANCHOR'
                    ? 'CONFIRMED'
                    : placement === 'GROUND_ANCHOR_UNCERTAIN'
                      ? 'UNCERTAIN'
                      : 'NONE'
                }
              />
              {notWorn && <PpeWarningMark figure={motion} fallbackY={HELMET_Y} />}
            </group>
          ) : pose.kind === 'BODY' ? (
            <group ref={body}>
              {meshOn ? null : model ? (
                <ModelBody
                  key={model.url}
                  model={model}
                  tone={tone}
                  selected={selected}
                  motion={motion}
                  worldId={worldId}
                  envMap={envMap}
                />
              ) : (
                <CapsuleBody color={palette.person} tone={tone} selected={selected} />
              )}
            </group>
          ) : (
            <HeightUnknownColumn color={palette.person} selected={selected} />
          )}
          {notWorn && !skeletonOn && (
            <PpeWarningMark fallbackY={pose.kind === 'BODY' ? HELMET_Y : COLUMN_TOP} />
          )}
          {/* A안 이름표(-658): 왼쪽 워치 아이콘 칸 + 이름 칸(+ PPE 칸). World ID·기기 ID·'워치' 글자는 빼고 상세 패널로 옮긴다. */}
          {useCellLabels ? (
            <LabelSprite
              cells={labelCells ?? DEFAULT_PERSON_CELLS}
              y={pose.kind === 'BODY' ? LABEL_Y : COLUMN_TOP + 0.2}
              height={0.24}
              color={risk ? riskStyle(risk, palette).labelColor : palette.label[tone]}
            />
          ) : (
            <LabelSprite
              text={badge ? `${track.worldId} · ${badge}` : track.worldId}
              y={pose.kind === 'BODY' ? LABEL_Y : COLUMN_TOP + 0.2}
              height={0.24}
              color={risk ? riskStyle(risk, palette).labelColor : palette.label[tone]}
            />
          )}
          {highlight && <PersonHighlight text={highlight} labelY={LABEL_Y + 0.4} />}
        </group>
      </Selectable>
      {risk && (
        <group ref={attachRisk}>
          <PersonRiskMark risk={risk} kind={pose.kind} worldId={worldId} />
        </group>
      )}
    </>
  );
}

function bodyColor(COLOR: PersonColor, tone: PersonTone, selected: boolean) {
  if (selected) return COLOR.selected;
  return tone === 'unknown' ? COLOR.unknown : COLOR.body;
}

/** 캡슐 아바타(명세 13.1 MVP). 모델이 없어도 늘 그린다. 앞쪽 표식으로 진행 방향을 보인다. */
function CapsuleBody({
  color: COLOR,
  tone,
  selected,
}: {
  color: PersonColor;
  tone: PersonTone;
  selected: boolean;
}) {
  const color = bodyColor(COLOR, tone, selected);
  const opacity = OPACITY[tone];
  const solid = tone === 'observed';
  return (
    <>
      <mesh position-y={CAPSULE.bodyY}>
        <capsuleGeometry args={[CAPSULE.bodyRadius, CAPSULE.bodyLength, 6, 14]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={opacity}
          depthWrite={solid}
          roughness={0.6}
        />
      </mesh>
      <mesh position-y={CAPSULE.headY}>
        <sphereGeometry args={[CAPSULE.headRadius, 16, 12]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={opacity}
          depthWrite={solid}
          roughness={0.6}
        />
      </mesh>
      <mesh position={[0, CAPSULE.headY, 0.12]} raycast={noRaycast}>
        <boxGeometry args={[0.14, 0.05, 0.04]} />
        <meshBasicMaterial color={COLOR.joint} transparent opacity={opacity} />
      </mesh>
    </>
  );
}

/** 높이를 모르는 사람의 세로 표식. 바닥에 세우지 않고 높이 범위를 점선으로만 보인다(Z 를 지어내지 않는다). */
function HeightUnknownColumn({
  color: COLOR,
  selected,
}: {
  color: PersonColor;
  selected: boolean;
}) {
  const color = selected ? COLOR.selected : COLOR.unknown;
  return (
    <>
      <Line
        points={[
          [0, 0.1, 0],
          [0, COLUMN_TOP, 0],
        ]}
        color={color}
        lineWidth={2}
        dashed
        dashSize={0.12}
        gapSize={0.08}
        raycast={noRaycast}
      />
      {/* 클릭을 받는 투명 기둥. */}
      <mesh position-y={(COLUMN_TOP + 0.1) / 2}>
        <cylinderGeometry args={[0.18, 0.18, COLUMN_TOP - 0.1, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}

interface ModelBodyProps {
  model: AvatarModel;
  tone: PersonTone;
  selected: boolean;
  motion: RefObject<Motion>;
  worldId: string;
  envMap: Texture | null;
}

/** 리깅 모델 아바타. 사람마다 복제본·mixer 를 따로 두고 Canvas 의 useFrame 으로만 돌린다. */
function ModelBody({ model, tone, selected, motion, worldId, envMap }: ModelBodyProps) {
  const { person: color } = useScenePalette();
  const holder = useRef<Group>(null);
  const instance = useRef<AvatarInstance | null>(null);

  // 복제·해제를 효과 안에서 짝지어 StrictMode 이중 마운트에도 남는 mixer·재질이 없게 한다.
  useEffect(() => {
    const parent = holder.current;
    if (!parent) return;
    const created = instantiateAvatar(model, phaseOf(worldId));
    parent.add(created.root);
    instance.current = created;
    return () => {
      parent.remove(created.root);
      created.dispose();
      instance.current = null;
    };
  }, [model, worldId]);

  // 위 효과 다음에 돌아 새 복제본에도 바로 칠한다.
  useEffect(() => {
    if (instance.current) paint(instance.current.materials, tone, selected, color, envMap);
  }, [color, tone, selected, model, worldId, envMap]);

  useFrame((_, dt) => {
    const avatar = instance.current;
    if (!avatar) return;
    const { walk, speed } = motion.current;
    avatar.walk.setEffectiveWeight(walk);
    avatar.idle.setEffectiveWeight(1 - walk);
    // 걸음 빠르기를 실제 속력에 맞춘다(동작은 위치를 옮기지 않는다).
    avatar.walk.timeScale = Math.min(1.6, Math.max(0.5, speed / 1.1));
    avatar.mixer.update(dt);
  });

  return <group ref={holder} />;
}

interface MeshBodyProps {
  mesh: AvatarMeshAsset;
  player: PosePlayer;
  motion: RefObject<Motion>;
  tone: PersonTone;
  selected: boolean;
  color: PersonColor;
  appearance: AvatarAppearanceTextures | null;
  facePolicy: AvatarFacePolicy;
  envMap: Texture | null;
}

/**
 * EXP-02 스키닝 메시(-65·-359). 사람마다 복제본을 두고, 관절 회전은 재생 버퍼에서 보간하며 pelvis 를 Tier 0 pelvis_xyz 에 맞춘다.
 * 처음 자세를 넣기 전에는 숨겨 바인드 자세가 원점에 한 번 보이지 않게 한다.
 */
function MeshBody({
  mesh,
  player,
  motion,
  tone,
  selected,
  color,
  appearance,
  facePolicy,
  envMap,
}: MeshBodyProps) {
  const holder = useRef<Group>(null);
  const instance = useRef<ReturnType<typeof instantiateAvatarMesh> | null>(null);
  const [target] = useState(() => new Vector3());

  useEffect(() => {
    const parent = holder.current;
    if (!parent) return;
    const created = instantiateAvatarMesh(mesh);
    parent.add(created.root);
    instance.current = created;
    return () => {
      parent.remove(created.root);
      created.dispose();
      instance.current = null;
    };
  }, [mesh]);

  useEffect(() => {
    if (!instance.current) return;
    paint(instance.current.materials, tone, selected, color, envMap);
    applyAvatarAppearanceToMaterials(
      instance.current.materials,
      appearance,
      facePolicy,
      envMap,
      mesh.scene,
    );
  }, [tone, selected, color, appearance, facePolicy, envMap, mesh]);

  useFrame(() => {
    const group = holder.current;
    const rig = instance.current;
    const pelvis = motion.current.pelvis;
    if (!group || !rig || !pelvis) return;
    const frame = player.frame(Date.now(), AVATAR_PLAYBACK_DELAY_MS);
    if (!frame) return;
    applyPose(rig, group, frame, target.set(pelvis[0], pelvis[1], pelvis[2]));
    group.visible = true;
  });

  return <group ref={holder} name="person-mesh" visible={false} />;
}

/** 상태 색·투명도·PBR·환경맵. 관절(Joints) 재질은 경보색과 헷갈리지 않게 무채색으로 둔다. */
function paint(
  materials: readonly Material[],
  tone: PersonTone,
  selected: boolean,
  COLOR: PersonColor = PALETTE.dark.person,
  envMap: Texture | null = null,
) {
  for (const material of materials) {
    const m = material as MeshStandardMaterial;
    const joint = /joints/i.test(m.name);
    const hex = selected
      ? COLOR.selected
      : tone === 'unknown'
        ? COLOR.unknown
        : joint
          ? COLOR.joint
          : COLOR.body;
    m.color?.setHex(hex);
    m.opacity = OPACITY[tone];
    m.depthWrite = tone === 'observed';
    if ('metalness' in m) {
      m.metalness = AVATAR_PBR_METALNESS;
      m.roughness = AVATAR_PBR_ROUGHNESS;
    }
    if ('envMap' in m && m.envMap !== envMap) {
      m.envMap = envMap;
      m.envMapIntensity = AVATAR_ENV_MAP_INTENSITY;
    }
    updateAvatarBaseColors([m], hex, tone, selected);
    m.needsUpdate = true;
  }
}
