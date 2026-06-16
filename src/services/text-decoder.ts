import { TextDecoder } from "node:util";

export function decodeAutoShopText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer).replace(/^\uFEFF/, "");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer).replace(/^\uFEFF/, "");
  }
  if (looksLikeUtf16Le(buffer)) {
    return new TextDecoder("utf-16le").decode(buffer).replace(/^\uFEFF/, "");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("gb18030").decode(buffer).replace(/^\uFEFF/, "");
  }
}

function looksLikeUtf16Le(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false;
  }
  const sampleLength = Math.min(buffer.length, 200);
  let oddNulls = 0;
  for (let index = 1; index < sampleLength; index += 2) {
    if (buffer[index] === 0) {
      oddNulls += 1;
    }
  }
  return oddNulls > sampleLength / 4;
}
