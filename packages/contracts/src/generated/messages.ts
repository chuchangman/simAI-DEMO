// contracts/ 에서 생성한 파일이다. 손으로 고치지 않는다.
// 다시 만들기: pnpm --filter @simai/contracts generate
import type { WorldStateMessage, RiskEventMessage, ViewerHealthMessage, AvatarFrameMessage, WatchEscalationMessage, PpeViewMessage } from './types';

/** 관제 앱이 STOMP 로 받는 메시지의 msg_type(명세 12.4). */
export const MESSAGE_TYPES = ['world_state', 'risk_event', 'viewer_health', 'avatar_frame', 'watch_escalation', 'ppe_view'] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

/** msg_type 별 메시지 모양. */
export interface MessageByType {
  world_state: WorldStateMessage;
  risk_event: RiskEventMessage;
  viewer_health: ViewerHealthMessage;
  avatar_frame: AvatarFrameMessage;
  watch_escalation: WatchEscalationMessage;
  ppe_view: PpeViewMessage;
}
