// 시연 계정이 보는 3D 맵 GLB. 이 폴더의 assets/ 에 .glb 파일 하나를 넣으면 그 파일을 쓰고, 없으면 서버 맵을 그대로 쓴다.
// GLB 는 서버 맵과 같은 좌표(World)여야 사람·구역 위치가 맞는다. 지금 파일은 11-17 16:38 맵(map-2026-11-17-1638)을 손질한 것이라
// 시연은 그 맵(또는 그 보정)을 써야 한다 — 11-16 맵과는 벽이 최대 20 cm, 바닥이 7 cm 어긋난다.
const files = import.meta.glob<string>('./assets/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const DEMO_MAP_GLB_URL: string | null = Object.values(files)[0] ?? null;

/**
 * 서버 Scene 응답(GET /api/scenes/current·/{scene_version}/view)의 3D 맵 주소를 시연 GLB 로 바꾼다. 서명 주소가 아니라 만료가 없고,
 * 카메라 사진 투영(vdt)·표면 출처 지도는 서버 맵 기준이라 빼서 GLB 를 그대로 보인다.
 */
export function withDemoMap(raw: unknown, glbUrl: string): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const scene: Record<string, unknown> = { ...raw, gltf_url: glbUrl, gltf_expires_at_ms: null };
  delete scene.vdt;
  delete scene.surface_source_map_urls;
  return scene;
}
