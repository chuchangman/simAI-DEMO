import { useThree } from '@react-three/fiber';
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import { createContext, useContext } from 'react';
import type { WebGLRenderer } from 'three';

// 후처리 레이어(S15P31A101-360). 가벼운 AO(N8AO)와 안티앨리어싱(SMAA)을 선택으로 켠다.
// 현장 노트북에서 배경 메시·다인원 렌더링 시 후처리 비용이 추가되므로 기본값은 끔(enabled: false)으로 두고,
// props(postProcessing) 또는 개발 화면 쿼리(?post=on)로 켜고 끌 수 있게 한다.

export interface ViewerPostProcessingOptions {
  enabled?: boolean;
  /** 화면 공간 주변 차폐(N8AO). 기본 true(후처리를 켰을 때). */
  ao?: boolean;
  /** 서브픽셀 형태 안티앨리어싱(SMAA). 기본 true(후처리를 켰을 때). */
  smaa?: boolean;
  /** AO 반경(m). 기본 0.6. */
  aoRadius?: number;
  /** AO 강도. 기본 1.5. */
  aoIntensity?: number;
}

export type ViewerPostProcessingInput = boolean | ViewerPostProcessingOptions | null | undefined;

export interface ResolvedPostProcessing {
  readonly enabled: boolean;
  readonly ao: boolean;
  readonly smaa: boolean;
  readonly aoRadius: number;
  readonly aoIntensity: number;
}

export const DEFAULT_POST_PROCESSING: ResolvedPostProcessing = Object.freeze({
  enabled: false,
  ao: true,
  smaa: true,
  aoRadius: 0.6,
  aoIntensity: 1.5,
});

const isPositiveFinite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

export function resolvePostProcessing(input: ViewerPostProcessingInput): ResolvedPostProcessing {
  if (!input) return DEFAULT_POST_PROCESSING;
  if (input === true) {
    return Object.freeze({ ...DEFAULT_POST_PROCESSING, enabled: true });
  }
  if (typeof input !== 'object') return DEFAULT_POST_PROCESSING;
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
  const ao = typeof input.ao === 'boolean' ? input.ao : DEFAULT_POST_PROCESSING.ao;
  const smaa = typeof input.smaa === 'boolean' ? input.smaa : DEFAULT_POST_PROCESSING.smaa;
  const aoRadius = isPositiveFinite(input.aoRadius)
    ? input.aoRadius
    : DEFAULT_POST_PROCESSING.aoRadius;
  const aoIntensity = isPositiveFinite(input.aoIntensity)
    ? input.aoIntensity
    : DEFAULT_POST_PROCESSING.aoIntensity;
  if (!enabled || (!ao && !smaa)) {
    return Object.freeze({
      enabled: false,
      ao,
      smaa,
      aoRadius,
      aoIntensity,
    });
  }
  return Object.freeze({ enabled: true, ao, smaa, aoRadius, aoIntensity });
}

/** 개발 화면 주소에서 ?post=on|1|true 를 읽는다. 없거나 그 밖의 값이면 false(기본 끔). */
export function readPostProcessingParam(search: string): boolean {
  const raw = new URLSearchParams(search).get('post')?.toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true';
}

export function withPostProcessingParam(href: string, enabled: boolean): string {
  const url = new URL(href);
  if (enabled) url.searchParams.set('post', 'on');
  else url.searchParams.delete('post');
  return url.toString();
}

export const PostProcessingContext = createContext<ResolvedPostProcessing>(DEFAULT_POST_PROCESSING);

function canMountComposer(gl: WebGLRenderer): boolean {
  const candidate = gl as unknown as {
    getSize?: unknown;
    getPixelRatio?: unknown;
    getContext?: () => unknown;
  };
  return (
    typeof candidate.getSize === 'function' &&
    typeof candidate.getPixelRatio === 'function' &&
    typeof candidate.getContext === 'function' &&
    candidate.getContext() !== null
  );
}

export function PostProcessingLayer() {
  const config = useContext(PostProcessingContext);
  const gl = useThree((s) => s.gl);
  if (!config.enabled) return null;
  const composerSupported = canMountComposer(gl);
  return (
    <group name="post-processing-layer" userData={{ postProcessing: config }}>
      {composerSupported && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <>
            {config.ao && (
              <N8AO
                halfRes
                quality="performance"
                aoRadius={config.aoRadius}
                intensity={config.aoIntensity}
                distanceFalloff={1.0}
              />
            )}
            {config.smaa && <SMAA />}
          </>
        </EffectComposer>
      )}
    </group>
  );
}
