import type { AvatarMeshFetch } from '@/features/viewer3d';
import { api } from '@/lib/api';
import { z } from 'zod';

const meshBytes = z.instanceof(ArrayBuffer);

/** 뷰어 자산도 REST 와 같은 Bearer·401 갱신·세션 종료 규칙을 쓴다. */
export const avatarMeshFetch: AvatarMeshFetch = (url) =>
  api(url, { responseType: 'arrayBuffer', schema: meshBytes });
