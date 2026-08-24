import { Buffer } from "node:buffer";

export function normalizeWebResourceOpenUrl(value: string): string | null {
  if (value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (Buffer.byteLength(url.href, "utf8") > 2048) return null;
    return url.href;
  } catch {
    return null;
  }
}
