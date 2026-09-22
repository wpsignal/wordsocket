/*
 * AES-256-GCM decryption for the relay's `encrypted` envelope.
 *
 * SubtleCrypto only exists in a secure context, so on a plain http:// page it
 * is undefined.
 */
import { gcm } from "@noble/ciphers/aes.js";

/** Bytes of the random IV the PHP Publisher prepends to every payload. */
const IV_BYTES = 12;

/*
 * Bytes backed by a plain ArrayBuffer. SubtleCrypto rejects views over a
 * SharedArrayBuffer, which a bare `Uint8Array` (TS 5.7+) may be; both callers
 * build theirs with `Uint8Array.from`, which is always this.
 */
type Bytes = Uint8Array<ArrayBuffer>;

/** Decrypts one `IV || ciphertext || tag` payload to its plaintext bytes. */
export type Decryptor = (payload: Bytes) => Promise<Uint8Array>;

/**
 * Build a decryptor for the site's raw 32-byte key: SubtleCrypto when the page
 * has it and the key imports, the pure-JS cipher otherwise.
 */
export async function createDecryptor(rawKey: Bytes): Promise<Decryptor> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
      return async (payload) => {
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: payload.slice(0, IV_BYTES) },
          key,
          payload.slice(IV_BYTES),
        );
        return new Uint8Array(plain);
      };
    } catch {
      // A key SubtleCrypto refuses is still a valid AES key: fall through.
    }
  }
  return async (payload) => gcm(rawKey, payload.slice(0, IV_BYTES)).decrypt(payload.slice(IV_BYTES));
}
