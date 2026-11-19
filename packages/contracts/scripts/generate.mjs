// 저장소 루트 contracts/ 의 JSON Schema 에서 관제 앱이 받는 I2 메시지의 TS 타입과 검증기를 만든다.
//   node scripts/generate.mjs          src/generated 를 다시 만든다
//   node scripts/generate.mjs --check  다시 만든 결과가 지금 파일과 다르면 실패한다(계약만 바뀌고 생성을 잊은 경우)
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { compile } from 'json-schema-to-typescript';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS = path.resolve(here, '../../../../contracts');
const OUT = path.resolve(here, '../src/generated');
const BASE = 'https://simai.dev/contracts/';

// 관제 앱이 STOMP 로 받는 메시지(명세 12.4)와 타입 이름. 메시지를 늘릴 때는 여기만 고친다(목록·타입·검증기를 함께 만든다).
const MESSAGES = {
  world_state: 'WorldState',
  risk_event: 'RiskEvent',
  viewer_health: 'ViewerHealth',
  avatar_frame: 'AvatarFrame',
  watch_escalation: 'WatchEscalation',
  ppe_view: 'PpeView',
};
// 메시지 스키마가 $ref 하는 파일. 새 파일을 $ref 하면 여기에 더한다.
const SCHEMAS = [
  'common/defs',
  'common/scene_compatibility',
  'messages/envelope',
  ...Object.keys(MESSAGES).map((m) => `messages/${m}`),
];

const HEADER =
  '// contracts/ 에서 생성한 파일이다. 손으로 고치지 않는다.\n' +
  '// 다시 만들기: pnpm --filter @simai/contracts generate\n';

const readSchema = (rel) =>
  JSON.parse(readFileSync(path.join(CONTRACTS, `${rel}.schema.json`), 'utf8'));

// 검증에 쓰지 않는 설명문을 뺀다. 검증기 코드에 스키마가 그대로 들어가서 크기가 준다.
// const·enum·default 는 값 자체라 그 안은 건드리지 않는다.
const ANNOTATIONS = new Set(['description', '$comment', 'examples']);
const VALUE_KEYWORDS = new Set(['const', 'enum', 'default']);
function stripAnnotations(node) {
  if (Array.isArray(node)) return node.map(stripAnnotations);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !ANNOTATIONS.has(key))
      .map(([key, value]) => {
        if (VALUE_KEYWORDS.has(key)) return [key, value];
        if (key === 'properties' || key === '$defs' || key === 'patternProperties') {
          return [key, mapValues(value, stripAnnotations)];
        }
        return [key, stripAnnotations(value)];
      }),
  );
}
const mapValues = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));

// 타입을 만들 때만 이름을 붙인다(title 은 검증에 영향이 없다). payload 는 봉투에서 필수라 메시지에서도 필수로 둔다.
function nameForTypes(rel, schema) {
  if (rel === 'messages/envelope') return { ...schema, title: 'Envelope' };
  const name = MESSAGES[rel.replace('messages/', '')];
  if (!name) return schema;
  return {
    ...schema,
    title: `${name}Message`,
    required: [...new Set([...(schema.required ?? []), 'payload'])],
    properties: {
      ...schema.properties,
      payload: { ...schema.properties.payload, title: `${name}Payload` },
    },
  };
}

// $ref 가 $id(https://simai.dev/contracts/...) 로 풀리든 로컬 경로로 풀리든 저장소 파일을 읽고, 타입용 이름을 붙인다.
function schemaRel(url) {
  if (url.startsWith(BASE)) return url.slice(BASE.length);
  const file = url.startsWith('file:') ? fileURLToPath(url) : decodeURIComponent(url);
  const rel = path.relative(CONTRACTS, path.resolve(file));
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.replaceAll('\\', '/');
}
const localResolver = {
  order: 1,
  canRead: (file) => schemaRel(file.url)?.endsWith('.schema.json') ?? false,
  read: (file) => {
    const rel = schemaRel(file.url).replace(/\.schema\.json$/, '');
    return JSON.stringify(nameForTypes(rel, readSchema(rel)));
  },
};

async function buildTypes() {
  const root = {
    $id: `${BASE}front-contracts.schema.json`,
    title: 'FrontContracts',
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.keys(MESSAGES).map((m) => [m, { $ref: `messages/${m}.schema.json` }]),
    ),
  };
  return compile(root, 'FrontContracts', {
    bannerComment: HEADER,
    cwd: CONTRACTS,
    $refOptions: { resolve: { simai: localResolver, http: false, https: false } },
    // 열린 객체에 [k: string]: unknown 을 붙이지 않는다. 실행 중 검증은 모르는 필드를 그대로 받고(계약 규칙),
    // 타입에서만 닫아 두어 track.heda_z 같은 오타가 컴파일에서 걸리게 한다.
    additionalProperties: false,
    format: false,
    unreachableDefinitions: false,
  });
}

// ajv 의 실행 보조 함수를 require 대신 이 패키지의 ESM 함수(src/runtime.ts)로 바꾼다. 실행 중에 ajv 가 필요 없다.
const RUNTIME = {
  'require("ajv/dist/runtime/equal").default': 'equal',
  'require("ajv/dist/runtime/ucs2length").default': 'ucs2length',
};

function buildValidators() {
  // 모르는 키워드(오타)와 잘못된 숫자만 엄격히 막는다. 계약은 if 조건 안의 type 없는 pattern,
  // not: { required: [...] } 처럼 표준대로 맞지만 ajv 의 작성 스타일 검사(strictTypes·strictRequired)에 걸리는 형태를 쓴다.
  const ajv = new Ajv2020({
    code: { source: true, esm: true },
    allErrors: true,
    strict: false,
    strictSchema: true,
    strictNumbers: true,
  });
  for (const rel of SCHEMAS) ajv.addSchema(stripAnnotations(readSchema(rel)));
  const exports = Object.fromEntries(
    Object.keys(MESSAGES).map((m) => [m, `${BASE}messages/${m}.schema.json`]),
  );
  let code = standaloneCode(ajv, exports);
  for (const [from, to] of Object.entries(RUNTIME)) code = code.replaceAll(from, to);
  const leftover = code.match(/require\([^)]*\)/);
  if (leftover) {
    throw new Error(
      `바꾸지 못한 require 가 남았다: ${leftover[0]} (RUNTIME 과 src/runtime.ts 에 더한다)`,
    );
  }
  return `${HEADER}import { equal, ucs2length } from '../runtime';\n${code}\n`;
}

const messageTypeNames = () => Object.values(MESSAGES).map((n) => `${n}Message`);

function buildValidatorTypes() {
  const lines = Object.entries(MESSAGES).map(
    ([m, name]) => `export declare const ${m}: ValidateFunction<${name}Message>;`,
  );
  return (
    `${HEADER}import type { ${messageTypeNames().join(', ')} } from './types';\n\n` +
    'export interface ValidationError {\n  instancePath: string;\n  schemaPath: string;\n  keyword: string;\n  params: Record<string, unknown>;\n  message?: string;\n}\n\n' +
    'export interface ValidateFunction<T> {\n  (data: unknown): data is T;\n  errors?: ValidationError[] | null;\n}\n\n' +
    `${lines.join('\n')}\n`
  );
}

function buildMessages() {
  const list = Object.keys(MESSAGES)
    .map((m) => `'${m}'`)
    .join(', ');
  const fields = Object.entries(MESSAGES)
    .map(([m, name]) => `  ${m}: ${name}Message;`)
    .join('\n');
  return (
    `${HEADER}import type { ${messageTypeNames().join(', ')} } from './types';\n\n` +
    '/** 관제 앱이 STOMP 로 받는 메시지의 msg_type(명세 12.4). */\n' +
    `export const MESSAGE_TYPES = [${list}] as const;\n\n` +
    'export type MessageType = (typeof MESSAGE_TYPES)[number];\n\n' +
    '/** msg_type 별 메시지 모양. */\n' +
    `export interface MessageByType {\n${fields}\n}\n`
  );
}

// 줄바꿈은 비교에서 빼고 본다(Windows 에서 CRLF 로 체크아웃해도 같은 내용이면 같다).
const normalize = (text) => text.replaceAll('\r\n', '\n');

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length) throw new Error(`모르는 옵션: ${unknown.join(' ')} (--check 만 받는다)`);

  const files = {
    'types.ts': await buildTypes(),
    'validators.js': buildValidators(),
    'validators.d.ts': buildValidatorTypes(),
    'messages.ts': buildMessages(),
  };

  if (args.includes('--check')) {
    const stale = Object.entries(files).filter(([name, text]) => {
      const file = path.join(OUT, name);
      return !existsSync(file) || normalize(readFileSync(file, 'utf8')) !== text;
    });
    if (stale.length) {
      console.error(`생성 파일이 contracts/ 와 다르다: ${stale.map(([n]) => n).join(', ')}`);
      console.error('pnpm --filter @simai/contracts generate 로 다시 만들어 커밋한다.');
      process.exit(1);
    }
    return;
  }
  mkdirSync(OUT, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(OUT, name), text);
}

main().catch((error) => {
  console.error(`계약에서 타입·검증기를 만들지 못했다: ${error.message}`);
  console.error(
    '- 메시지 이름이 contracts/messages/*.schema.json 과 맞는지(MESSAGES), 메시지가 $ref 하는 파일이 SCHEMAS 에 있는지 확인한다.',
  );
  process.exit(1);
});
