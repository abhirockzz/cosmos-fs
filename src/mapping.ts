import type { PartitionKey, SqlParameter } from "@azure/cosmos";

/**
 * Read-time field mapping. cosmos-fs explores an item's *roles* — `content`
 * (readable/searchable text, the one required role), `key` (the address whose
 * value builds the tree and that `cat` reads), and `namespace` (an optional
 * scope/partition filter). This module binds those roles to whatever *fields* an
 * existing container actually uses, so the reader works over data it did not
 * ingest. v1 is single-field (one dotted field path per role); composed-key
 * templates (`{basename(source)}/{chunk}`) are additive later with no rework.
 */

/** Default field names for the canonical cosmos-fs schema (Phase 8a). */
export const DEFAULT_CONTENT_FIELD = "content";
export const DEFAULT_KEY_FIELD = "key";
export const DEFAULT_NAMESPACE_FIELD = "namespace";

/** Raw, unresolved bindings (from CLI flags / env); undefined means "use the default". */
export interface BindingOptions {
    contentField?: string;
    keyField?: string;
    namespaceField?: string;
    /** The scope value to select; absent => whole container (cross-partition). */
    namespaceValue?: string;
    /** The container's real partition-key field, auto-detected at startup. */
    pkField: string;
    /** Full-text index paths on the container (e.g. `/content`), auto-detected at startup. */
    fullTextIndexPaths?: string[];
}

/**
 * A resolved mapping: field paths turned into validated Cosmos SQL accessors,
 * plus the scope and whether a query can pin to a single logical partition.
 * Built once at startup ({@link buildMapping}); every field is validated there,
 * so the precomputed `*Expr` strings never re-throw.
 */
export interface ReaderMapping {
    /** Dotted field path holding the text; used to read a fetched item (`cat`). */
    contentField: string;
    /** `c.<content>` accessor for SELECT / CONTAINS. */
    contentExpr: string;
    /** `c.<key>` accessor for SELECT (builds the tree/index). */
    keyExpr: string;
    /** `c.<pk>` accessor for SELECT (per-item partition-key value for point reads). */
    pkExpr: string;
    /** Scope filter; absent => whole container. */
    namespace?: { field: string; value: string };
    /** `c.<namespaceField>` accessor, present iff a scope is bound. */
    nsExpr?: string;
    /** True when the scope filters on the real PK, so queries stay single-partition. */
    pinPartition: boolean;
    /** True when the content field is covered by a full-text index (enables the `grep -w` FTS coarse filter). */
    ftsContent: boolean;
}

// A Cosmos property name (one path segment). Field names cannot be query
// parameters, so they are interpolated into the SQL string; restricting them to
// this identifier-safe charset keeps them off the injection surface.
const SAFE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Turn a dotted field path (e.g. `metadata.source`) into a Cosmos SQL property
 * accessor (`c.metadata.source`). Each segment is validated against an
 * identifier-safe charset; anything else throws, since field names are
 * interpolated into the query text and must never carry SQL.
 */
export function fieldToSql(path: string): string {
    const segments = path.split(".");
    for (const segment of segments) {
        if (!SAFE_SEGMENT.test(segment)) {
            throw new Error(
                `Invalid field path '${path}': segment '${segment}' must match [A-Za-z_][A-Za-z0-9_]*`,
            );
        }
    }
    return `c.${segments.join(".")}`;
}

/** Read a dotted field path from a fetched item; undefined if any segment is missing. */
export function getField(item: unknown, path: string): unknown {
    let current: unknown = item;
    for (const segment of path.split(".")) {
        if (current === null || typeof current !== "object") {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

/** Convert a container partition-key path (`/namespace`, `/a/b`) to a field path (`namespace`, `a.b`). */
export function pkPathToField(path: string): string {
    return path.replace(/^\//, "").replace(/\//g, ".");
}

/** Resolve raw binding options into a validated {@link ReaderMapping}. */
export function buildMapping(options: BindingOptions): ReaderMapping {
    const contentField = options.contentField ?? DEFAULT_CONTENT_FIELD;
    const keyField = options.keyField ?? DEFAULT_KEY_FIELD;
    const namespaceField = options.namespaceField ?? DEFAULT_NAMESPACE_FIELD;

    const namespace =
        options.namespaceValue !== undefined
            ? { field: namespaceField, value: options.namespaceValue }
            : undefined;

    // The content field is FTS-searchable only if a full-text index covers its
    // path (field `content` -> index path `/content`), detected at startup.
    const contentIndexPath = `/${contentField.split(".").join("/")}`;
    const ftsContent = (options.fullTextIndexPaths ?? []).some(
        (p) => p === contentIndexPath || p === `${contentIndexPath}/*`,
    );

    return {
        contentField,
        contentExpr: fieldToSql(contentField),
        keyExpr: fieldToSql(keyField),
        pkExpr: fieldToSql(options.pkField),
        namespace,
        nsExpr: namespace ? fieldToSql(namespace.field) : undefined,
        // Pinning to a single logical partition is only correct when the scope
        // filter is the container's real PK; otherwise the query is cross-partition.
        pinPartition: namespace !== undefined && namespace.field === options.pkField,
        ftsContent,
    };
}

/**
 * The shared WHERE conditions, parameters, and (when safe) single-partition pin
 * for the current scope. Callers append their own conditions (e.g. grep's
 * CONTAINS) and assemble the final `WHERE`.
 */
export function scopeParts(mapping: ReaderMapping): {
    conditions: string[];
    parameters: SqlParameter[];
    partitionKey?: PartitionKey;
} {
    if (!mapping.namespace || !mapping.nsExpr) {
        return { conditions: [], parameters: [] };
    }
    const parts = {
        conditions: [`${mapping.nsExpr} = @ns`],
        parameters: [{ name: "@ns", value: mapping.namespace.value }],
    };
    return mapping.pinPartition ? { ...parts, partitionKey: mapping.namespace.value } : parts;
}
