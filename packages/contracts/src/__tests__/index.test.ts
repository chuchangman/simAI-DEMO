import Ajv2020 from 'ajv/dist/2020.js';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMessageType, MESSAGE_TYPES, type MessageType, validateMessage } from '../index';

// 계약 저장소(contracts/)가 정본으로 두는 예제·스키마로 생성한 검증기를 확인한다.
const CONTRACTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../contracts',
);
const EXAMPLES = path.join(CONTRACTS, 'examples');

type Json = Record<string, unknown>;

const filesOf = (dir: string, type: MessageType) =>
  readdirSync(dir).filter(
    (f) => f === `${type}.json` || (f.startsWith(`${type}.`) && f.endsWith('.json')),
  );

// contracts/scripts/validate_examples.py 와 같이 맨 위의 설명용 키(_expect_error 등)는 빼고 검사한다.
function readExample(file: string): Json {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Json;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('_')));
}

const omit = (obj: Json, key: string): Json =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

describe.each(MESSAGE_TYPES)('%s', (type) => {
  const valid = filesOf(EXAMPLES, type);
  const invalid = filesOf(path.join(EXAMPLES, 'invalid'), type);
  const first = () => readExample(path.join(EXAMPLES, valid[0]!));

  it('계약 예제가 있다', () => {
    expect(valid.length).toBeGreaterThan(0);
  });

  it.each(valid)('예제 %s 를 통과시킨다', (file) => {
    const result = validateMessage(type, readExample(path.join(EXAMPLES, file)));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it.each(invalid)('잘못된 예제 invalid/%s 를 거부한다', (file) => {
    const result = validateMessage(type, readExample(path.join(EXAMPLES, 'invalid', file)));
    expect(result.ok).toBe(false);
  });

  it('모르는 필드는 받는다(수신 측은 모르는 필드를 무시한다, contracts/README)', () => {
    const message = first();
    const payload = message.payload as Json;
    const extra = {
      ...message,
      unknown_top: 1,
      payload: { ...payload, unknown_payload: { nested: true } },
    };
    expect(validateMessage(type, extra).ok).toBe(true);
  });

  it('다른 msg_type 의 메시지는 거부한다', () => {
    for (const other of MESSAGE_TYPES.filter((t) => t !== type)) {
      const message = readExample(path.join(EXAMPLES, filesOf(EXAMPLES, other)[0]!));
      expect(validateMessage(type, message).ok).toBe(false);
    }
  });
});

describe('msg_type 확인', () => {
  it('아는 msg_type 만 참이다', () => {
    expect(isMessageType('world_state')).toBe(true);
    expect(isMessageType('health')).toBe(false);
    expect(isMessageType('toString')).toBe(false);
    expect(isMessageType(undefined)).toBe(false);
  });

  it('모르는 type 은 예외 대신 실패로 돌려준다', () => {
    for (const type of ['nope', 'toString', '__proto__', 'constructor']) {
      const result = validateMessage(type as MessageType, {});
      expect(result.ok).toBe(false);
    }
  });
});

// 생성 검증기(설명문 제거, src/runtime.ts 사용)가 원본 스키마를 그대로 컴파일한 ajv 와 같은 판단을 하는지,
// 예제를 바꿔 가며 비교한다.
describe('원본 스키마와 같은 판단', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const rel of [
    'common/defs',
    'common/scene_compatibility',
    'messages/envelope',
    ...MESSAGE_TYPES.map((m) => `messages/${m}`),
  ]) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(CONTRACTS, `${rel}.schema.json`), 'utf8')));
  }
  const reference = (type: MessageType) =>
    ajv.getSchema(`https://simai.dev/contracts/messages/${type}.schema.json`)!;
  const VALUES: unknown[] = [null, 'x', '', 0, -1, 1.5, true, {}, [], 'a'.repeat(300)];

  function* mutate(obj: Json): Generator<Json> {
    for (const key of Object.keys(obj)) {
      yield omit(obj, key);
      for (const value of VALUES) yield { ...obj, [key]: value };
    }
  }

  function* mutations(message: Json): Generator<Json> {
    yield* mutate(message);
    const payload = message.payload as Json;
    for (const changed of mutate(payload)) yield { ...message, payload: changed };
    // 배열 안 첫 객체(트랙, 확인 기록 등)도 바꿔 본다.
    for (const [key, value] of Object.entries(payload)) {
      if (!Array.isArray(value) || typeof value[0] !== 'object' || value[0] === null) continue;
      for (const changed of mutate(value[0] as Json)) {
        yield { ...message, payload: { ...payload, [key]: [changed, ...value.slice(1)] } };
      }
    }
  }

  it.each(MESSAGE_TYPES)('%s', (type) => {
    const check = reference(type);
    const differences: string[] = [];
    let count = 0;
    for (const file of filesOf(EXAMPLES, type)) {
      for (const message of mutations(readExample(path.join(EXAMPLES, file)))) {
        count++;
        const expected = check(message);
        if (validateMessage(type, message).ok !== expected) {
          differences.push(`${file}: ${JSON.stringify(message).slice(0, 120)}`);
        }
      }
    }
    expect(count).toBeGreaterThan(100);
    expect(differences).toEqual([]);
  });
});
