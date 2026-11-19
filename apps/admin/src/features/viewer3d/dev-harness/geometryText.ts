import type { ZoneContract } from '@/features/viewer3d/data/spatialFrame';
import type { WorkSurfaceContract } from '@/features/viewer3d/surfaces/workSurfaceGeometry';

// 개발 진단의 형상 출처 문구(-234). 받은 형식(DEMO·BE 정식)과 적용(ACK) 확인 여부를 섞지 않는다.
// READY 는 형상을 받아 검사했다는 뜻일 뿐이고, 적용 확인 계약은 아직 없어 어느 출처든 "적용 미확인" 이다.

const ZONE_TEXT: Record<ZoneContract, string> = {
  DEMO_UNCONFIRMED: 'DEMO 형상(계약 미확정) · 적용 미확인',
  BE_ZONES_V1: 'BE 정식 형상(GET /api/zones) · 적용(ACK) 미확인',
};

const SURFACE_TEXT: Record<WorkSurfaceContract, string> = {
  OPERATIONAL_GEOMETRY_UNCONFIRMED: '등록 OBB · 전달 계약 미확정 · 적용 미확인',
  BE_STATIC_OBJECTS_V1: 'BE 정식 등록 OBB(GET /api/static-objects) · 적용(ACK) 미확인',
};

export const zoneContractText = (contract: ZoneContract) => ZONE_TEXT[contract];
export const surfaceContractText = (contract: WorkSurfaceContract) => SURFACE_TEXT[contract];
