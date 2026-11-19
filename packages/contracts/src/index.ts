import { MESSAGE_TYPES, type MessageByType, type MessageType } from './generated/messages';
import type { ValidateFunction, ValidationError } from './generated/validators';
import * as validators from './generated/validators';

export { MESSAGE_TYPES } from './generated/messages';
export type { MessageByType, MessageType } from './generated/messages';
export type * from './generated/types';
export type { ValidateFunction, ValidationError } from './generated/validators';

export type ValidationResult<T> =
  { ok: true; message: T } | { ok: false; errors: ValidationError[] };

const VALIDATORS: { [K in MessageType]: ValidateFunction<MessageByType[K]> } = validators;

/** 관제 앱이 아는 msg_type 인지 본다. 받은 메시지의 msg_type 으로 검증기를 고르기 전에 쓴다. */
export function isMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && (MESSAGE_TYPES as readonly string[]).includes(value);
}

/**
 * 계약 스키마로 검사한다. 통과한 메시지만 화면에 쓴다(front/CONVENTION.md 「데이터」).
 * 모르는 type 은 예외 대신 실패로 돌려준다.
 */
export function validateMessage<K extends MessageType>(
  type: K,
  data: unknown,
): ValidationResult<MessageByType[K]> {
  if (!isMessageType(type)) {
    const message = `모르는 msg_type: ${String(type)}`;
    return {
      ok: false,
      errors: [{ instancePath: '', schemaPath: '', keyword: 'msg_type', params: {}, message }],
    };
  }
  const validate = VALIDATORS[type];
  if (validate(data)) return { ok: true, message: data };
  return { ok: false, errors: validate.errors ?? [] };
}
