// 생성한 검증기(generated/validators.js)가 쓰는 보조 함수. ajv 의 runtime/equal·runtime/ucs2length 와 같은 동작이다.

/** JSON 값의 깊은 비교(const·enum·uniqueItems). */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    // NaN 끼리는 같다고 본다(fast-deep-equal 과 같음).
    return a !== a && b !== b;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, i) => equal(value, b[i]));
  }
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) => Object.hasOwn(b, key) && equal(Reflect.get(a, key), Reflect.get(b, key)),
  );
}

/** 문자열 길이를 코드 포인트로 센다(서로게이트 쌍은 한 글자). minLength·maxLength 용. 10 Hz 로 불려서 배열을 만들지 않는다. */
export function ucs2length(value: string): number {
  let length = 0;
  for (let i = 0; i < value.length; i++) {
    length++;
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      if ((value.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i++;
    }
  }
  return length;
}
