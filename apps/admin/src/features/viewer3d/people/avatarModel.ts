import { useEffect, useState } from 'react';
import {
  AnimationClip,
  AnimationMixer,
  Box3,
  VectorKeyframeTrack,
  type AnimationAction,
  type Material,
  type Object3D,
  type Skeleton,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// 선택형 사람 모델(XBot 같은 리깅 glTF). 주소를 받았을 때만 읽고, 못 읽으면 null 이라 캡슐 아바타로 계속 그린다.
// 모델은 표시용이다. 동작(idle·walk)은 움직임을 보여 줄 뿐 위치를 바꾸지 않는다.

/** 모델 키(m). 원본 크기와 상관없이 이 키로 맞춘다. */
export const AVATAR_HEIGHT_M = 1.72;
const REQUIRED_CLIPS = ['idle', 'walk'] as const;

export interface AvatarModel {
  url: string;
  scene: Object3D;
  idle: AnimationClip;
  walk: AnimationClip;
  scale: number;
}

/**
 * 골반(Hips) 위치 트랙의 수평 이동을 첫 값으로 고정한다. 동작이 아바타를 옮기면(root motion) World 위치와 이중으로 움직이기 때문이다.
 * 위아래 흔들림(Y)은 남긴다.
 */
export function stripRootMotion(clip: AnimationClip): AnimationClip {
  const tracks = clip.tracks.map((track) => {
    if (!/hips\.position$/i.test(track.name) || !(track instanceof VectorKeyframeTrack))
      return track;
    const values = Float32Array.from(track.values);
    for (let i = 0; i < values.length; i += 3) {
      values[i] = values[0]!;
      values[i + 2] = values[2]!;
    }
    return new VectorKeyframeTrack(track.name, Array.from(track.times), Array.from(values));
  });
  return new AnimationClip(clip.name, clip.duration, tracks);
}

/** 모델 전체 높이를 AVATAR_HEIGHT_M 로 맞추는 배율. 높이를 잴 수 없으면 1. */
export function scaleToHeight(scene: Object3D): number {
  const box = new Box3().setFromObject(scene);
  const height = box.max.y - box.min.y;
  return Number.isFinite(height) && height > 0.1 ? AVATAR_HEIGHT_M / height : 1;
}

const cache = new Map<string, Promise<AvatarModel | null>>();

/** 같은 주소는 한 번만 읽는다. 실패하면 경고만 남기고 null 이다(Viewer 오류로 번지지 않는다). */
export function loadAvatarModel(url: string): Promise<AvatarModel | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
        if (!REQUIRED_CLIPS.every((name) => clips.has(name))) {
          console.warn(`사람 모델에 idle·walk 동작이 없어 캡슐로 그린다: ${url}`);
          return null;
        }
        return {
          url,
          scene: gltf.scene,
          idle: stripRootMotion(clips.get('idle')!),
          walk: stripRootMotion(clips.get('walk')!),
          scale: scaleToHeight(gltf.scene),
        };
      })
      .catch((error: unknown) => {
        console.warn(`사람 모델을 읽지 못해 캡슐로 그린다: ${url}`, error);
        return null;
      });
    cache.set(url, pending);
  }
  return pending;
}

/** 주소의 모델. 읽는 중이거나 실패·주소 없음이면 null. 언마운트 뒤 늦게 끝난 읽기는 반영하지 않는다. */
export function useAvatarModel(url: string | null): AvatarModel | null {
  const [loaded, setLoaded] = useState<AvatarModel | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void loadAvatarModel(url).then((model) => {
      if (alive) setLoaded(model);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return url && loaded?.url === url ? loaded : null;
}

export interface AvatarInstance {
  root: Object3D;
  mixer: AnimationMixer;
  idle: AnimationAction;
  walk: AnimationAction;
  /** 사람마다 따로 복제한 재질. 상태 색·투명도를 바꾸고 해제할 때 쓴다. */
  materials: Material[];
  dispose(): void;
}

/**
 * 사람 하나의 모델 복제본. 뼈대는 따로, 형상·텍스처는 원본과 공유한다(해제 때 공유 자원은 건드리지 않는다).
 * idle·walk 를 둘 다 재생하고 가중치로 섞는다.
 */
export function instantiateAvatar(model: AvatarModel, phase: number): AvatarInstance {
  const root = cloneSkinned(model.scene);
  root.scale.setScalar(model.scale);
  const materials: Material[] = [];
  const skeletons: Skeleton[] = [];
  root.traverse((node) => {
    const mesh = node as Object3D & {
      isMesh?: boolean;
      material?: Material | Material[];
      skeleton?: Skeleton;
    };
    // 복제본은 뼈대를 따로 가지며, 뼈대는 그리는 동안 뼈 텍스처(GPU)를 만든다. 해제 때 같이 지운다.
    if (mesh.skeleton && !skeletons.includes(mesh.skeleton)) skeletons.push(mesh.skeleton);
    if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material)) return;
    const material = mesh.material.clone();
    material.transparent = true;
    mesh.material = material;
    // 스키닝 뒤 경계 상자가 실제 자세와 달라 화면 밖으로 잘리지 않게 한다.
    node.frustumCulled = false;
    materials.push(material);
  });
  const mixer = new AnimationMixer(root);
  const idle = mixer.clipAction(model.idle);
  const walk = mixer.clipAction(model.walk);
  idle.play();
  walk.play();
  // 여러 사람이 같은 박자로 움직이지 않게 시작 위치를 어긋낸다.
  idle.time = phase * model.idle.duration;
  walk.time = phase * model.walk.duration;
  idle.setEffectiveWeight(1);
  walk.setEffectiveWeight(0);
  return {
    root,
    mixer,
    idle,
    walk,
    materials,
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      materials.forEach((material) => material.dispose());
      skeletons.forEach((skeleton) => skeleton.dispose());
    },
  };
}
