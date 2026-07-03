/**
 * Cosmos DB item ids cannot contain `/ \ ? #` (and must be non-empty, <= 1023 chars,
 * no trailing whitespace). A `key` (the item's address) contains `/`, so we derive a
 * valid, reversible id from the key with base64url, which emits only `[A-Za-z0-9-_]`.
 *
 * We deliberately avoid `encodeURIComponent` here: it escapes forbidden characters into
 * `%XX` triplets, but a `%` in an item id is a point-read hazard. The id travels in the
 * `read()` request URL, gets re-encoded to `%25XX`, and the gateway decodes it
 * inconsistently, so `container.item(id, pk).read()` returns intermittent 404s for any id
 * that contains `%`. base64url keeps the id URL-safe, so point reads stay stable. See
 * LEARNINGS.md for the diagnosis.
 */

const FORBIDDEN_ID_CHARS = /[/\\?#]/;
const MAX_ID_LENGTH = 1023;

/** Encode a key (e.g. `query/functions/array-length.md`) into a Cosmos item id. */
export function keyToId(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

/** Inverse of {@link keyToId}. */
export function idToKey(id: string): string {
  return Buffer.from(id, "base64url").toString("utf8");
}

/** True when `id` satisfies Cosmos DB's id constraints. */
export function isValidCosmosId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= MAX_ID_LENGTH &&
    !FORBIDDEN_ID_CHARS.test(id) &&
    id === id.trimEnd()
  );
}
