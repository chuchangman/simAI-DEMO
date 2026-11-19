/** 서버가 고르는 ID 는 접두 뒤에 8자리 hex 다. */
const ID_HEX_LENGTH = 8;
const HEX_RADIX = 16;

/** 서버가 고르는 `<접두>-<8 hex>` ID. */
export const hexId = (prefix: string, serial: number) =>
  `${prefix}-${serial.toString(HEX_RADIX).padStart(ID_HEX_LENGTH, '0')}`;
