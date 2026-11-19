import type { Viewer3DProps } from '@/features/viewer3d/types';
import { ViewerShell } from '@/features/viewer3d/ViewerShell';

/**
 * 관제 화면 배경 3D 뷰어. 부모 크기를 채우며, 부모가 크기와 위치를 정한다.
 * 같은 인스턴스가 살아 있는 동안 props 가 바뀌거나 명령을 받아도 Canvas·카메라를 다시 만들지 않는다.
 */
export function Viewer3D(props: Viewer3DProps) {
  return <ViewerShell {...props} />;
}
