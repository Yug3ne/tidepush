/** Minimal DER (ASN.1) encoding and reading, for keys and X.509 certificates. */

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function derLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  const bytes: number[] = [];
  for (let n = len; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

export function derTlv(tag: number, value: Uint8Array): Uint8Array {
  return concat(new Uint8Array([tag]), derLength(value.length), value);
}

export const sequence = (...items: Uint8Array[]) => derTlv(0x30, concat(...items));
export const set = (...items: Uint8Array[]) => derTlv(0x31, concat(...items));
export const octetString = (value: Uint8Array) => derTlv(0x04, value);
export const utf8String = (s: string) => derTlv(0x0c, new TextEncoder().encode(s));
export const NULL = new Uint8Array([0x05, 0x00]);
export const TRUE = new Uint8Array([0x01, 0x01, 0xff]);

/** BIT STRING with no unused bits. */
export const bitString = (value: Uint8Array) => derTlv(0x03, concat(new Uint8Array([0]), value));

/** Context-specific, constructed, explicit tag `[n]`. */
export const explicit = (n: number, value: Uint8Array) => derTlv(0xa0 + n, value);

/** A non-negative INTEGER from big-endian bytes. */
export function integer(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.subarray(start);
  return derTlv(0x02, trimmed[0]! & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed);
}

export function oid(dotted: string): Uint8Array {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [a! * 40 + b!];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return derTlv(0x06, new Uint8Array(out));
}

/** UTCTime before 2050, GeneralizedTime from 2050 on (RFC 5280 §4.1.2.5). */
export function time(date: Date): Uint8Array {
  const iso = date.toISOString();
  const digits = iso.slice(0, 19).replace(/[-:T]/g, "");
  const year = date.getUTCFullYear();
  return year < 2050
    ? derTlv(0x17, new TextEncoder().encode(`${digits.slice(2)}Z`))
    : derTlv(0x18, new TextEncoder().encode(`${digits}Z`));
}

// ---- Reading ------------------------------------------------------------------

export interface Tlv {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
}

export function readTlv(der: Uint8Array, offset: number): Tlv {
  const tag = der[offset]!;
  let len = der[offset + 1]!;
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | der[offset + 2 + i]!;
    header += n;
  }
  const end = offset + header + len;
  if (end > der.length) throw new Error("Truncated DER");
  return { tag, start: offset, contentStart: offset + header, end };
}

export function children(der: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let o = parent.contentStart; o < parent.end; ) {
    const tlv = readTlv(der, o);
    out.push(tlv);
    o = tlv.end;
  }
  return out;
}
