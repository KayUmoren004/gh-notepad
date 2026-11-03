/** 16 random bytes as base64url: 22 characters, no padding. */
const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;

/**
 * A new share id: 128 bits from the platform's random source, so a link can't
 * be guessed, written as base64url so it reads as one word in a URL.
 */
export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Whether `value` has the shape of a share id; anything else is refused before it reaches a store. */
export function isShareId(value: string): boolean {
  return SHARE_ID.test(value);
}
