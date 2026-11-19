// contracts/ 에서 생성한 파일이다. 손으로 고치지 않는다.
// 다시 만들기: pnpm --filter @simai/contracts generate
import type { WorldStateMessage, RiskEventMessage, ViewerHealthMessage, AvatarFrameMessage, WatchEscalationMessage, PpeViewMessage } from './types';

export interface ValidationError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

export interface ValidateFunction<T> {
  (data: unknown): data is T;
  errors?: ValidationError[] | null;
}

export declare const world_state: ValidateFunction<WorldStateMessage>;
export declare const risk_event: ValidateFunction<RiskEventMessage>;
export declare const viewer_health: ValidateFunction<ViewerHealthMessage>;
export declare const avatar_frame: ValidateFunction<AvatarFrameMessage>;
export declare const watch_escalation: ValidateFunction<WatchEscalationMessage>;
export declare const ppe_view: ValidateFunction<PpeViewMessage>;
