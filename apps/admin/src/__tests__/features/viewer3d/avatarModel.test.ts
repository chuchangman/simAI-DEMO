import {
  AVATAR_HEIGHT_M,
  instantiateAvatar,
  loadAvatarModel,
  scaleToHeight,
  stripRootMotion,
  type AvatarModel,
} from '@/features/viewer3d/people/avatarModel';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('stripRootMotion', () => {
  it('골반 위치 트랙의 수평 이동만 없애고 높이·다른 트랙은 둔다', () => {
    const hips = new VectorKeyframeTrack(
      'mixamorigHips.position',
      [0, 1],
      [0, 100, 0, 30, 104, -20],
    );
    const spine = new VectorKeyframeTrack('mixamorigSpine.position', [0, 1], [0, 1, 0, 5, 1, 5]);
    const other = new NumberKeyframeTrack('x.morphTargetInfluences[0]', [0, 1], [0, 1]);
    const clip = stripRootMotion(new AnimationClip('walk', 1, [hips, spine, other]));
    expect(Array.from(clip.tracks[0]!.values)).toEqual([0, 100, 0, 0, 104, 0]);
    expect(clip.tracks[1]).toBe(spine);
    expect(clip.tracks[2]).toBe(other);
    expect([clip.name, clip.duration]).toEqual(['walk', 1]);
  });
});

describe('scaleToHeight', () => {
  it('모델 키를 정해진 키로 맞추는 배율', () => {
    const scene = new Group();
    const mesh = new Mesh(new BoxGeometry(0.5, 2, 0.3));
    mesh.position.y = 1;
    scene.add(mesh);
    expect(scaleToHeight(scene)).toBeCloseTo(AVATAR_HEIGHT_M / 2, 9);
    expect(scaleToHeight(new Group())).toBe(1);
  });
});

describe('loadAvatarModel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('읽지 못하면 예외 없이 null 이고 같은 주소는 한 번만 읽는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = 'http://127.0.0.1:9/missing-avatar.glb';
    const first = loadAvatarModel(url);
    expect(loadAvatarModel(url)).toBe(first);
    await expect(first).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('instantiateAvatar', () => {
  function model(): { model: AvatarModel; material: MeshStandardMaterial } {
    const scene = new Group();
    const material = new MeshStandardMaterial({ name: 'Alpha_Body_MAT' });
    const mesh = new Mesh(new BoxGeometry(1, 1.8, 1), material);
    mesh.name = 'body';
    scene.add(mesh);
    const track = () => new VectorKeyframeTrack('body.position', [0, 1], [0, 0, 0, 0, 0.1, 0]);
    return {
      material,
      model: {
        url: 'test',
        scene,
        idle: new AnimationClip('idle', 1, [track()]),
        walk: new AnimationClip('walk', 1, [track()]),
        scale: 0.95,
      },
    };
  }

  it('사람마다 복제본·재질·mixer 를 따로 두고 해제 때 공유 원본은 건드리지 않는다', () => {
    const { model: m, material } = model();
    const a = instantiateAvatar(m, 0.2);
    const b = instantiateAvatar(m, 0.7);
    expect(a.root).not.toBe(m.scene);
    expect(a.root.scale.x).toBeCloseTo(0.95, 9);
    expect(a.materials).toHaveLength(1);
    expect(a.materials[0]).not.toBe(material);
    expect(a.materials[0]).not.toBe(b.materials[0]);
    expect(a.materials[0]!.transparent).toBe(true);
    expect([a.idle.getEffectiveWeight(), a.walk.getEffectiveWeight()]).toEqual([1, 0]);
    expect(a.idle.time).toBeCloseTo(0.2, 9);

    const disposed = vi.fn();
    a.materials[0]!.addEventListener('dispose', disposed);
    const original = vi.fn();
    material.addEventListener('dispose', original);
    a.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalled();
    expect(a.idle.isRunning()).toBe(false);
    b.dispose();
  });

  it('리깅 모델 복제본의 뼈대(뼈 텍스처)를 해제 때 함께 지운다(재시작 누수 방지)', () => {
    const scene = new Group();
    const bone = new Bone();
    bone.name = 'hips';
    const geometry = new BoxGeometry(1, 1.8, 1);
    geometry.setAttribute(
      'skinIndex',
      new Uint16BufferAttribute(new Array(geometry.attributes.position!.count * 4).fill(0), 4),
    );
    geometry.setAttribute(
      'skinWeight',
      new Float32BufferAttribute(new Array(geometry.attributes.position!.count * 4).fill(0.25), 4),
    );
    const skinned = new SkinnedMesh(geometry, new MeshStandardMaterial());
    skinned.add(bone);
    skinned.bind(new Skeleton([bone]));
    scene.add(skinned);
    const track = () => new VectorKeyframeTrack('hips.position', [0, 1], [0, 0, 0, 0, 0.1, 0]);
    const m: AvatarModel = {
      url: 'skinned',
      scene,
      idle: new AnimationClip('idle', 1, [track()]),
      walk: new AnimationClip('walk', 1, [track()]),
      scale: 1,
    };
    const original = vi.spyOn(skinned.skeleton, 'dispose');
    const a = instantiateAvatar(m, 0);
    let cloned: Skeleton | null = null;
    a.root.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh) cloned = (node as SkinnedMesh).skeleton;
    });
    expect(cloned).not.toBe(skinned.skeleton);
    const disposed = vi.spyOn(cloned!, 'dispose');
    a.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalled();
  });
});
