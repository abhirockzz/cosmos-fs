import type { Container, PartitionKey } from "@azure/cosmos";
import { posix } from "node:path";
import { type ReaderMapping, scopeParts } from "./mapping.js";

const ROOT = "/";

/**
 * In-memory directory tree derived from a flat list of corpus keys (the
 * Mintlify path-tree trick: a `Set` of paths plus a `Map` of directory
 * children). `ls`/`cd`/`find` resolve against this with no network calls.
 *
 * Keys are the raw item keys stored in Cosmos (e.g.
 * `query/functions/array-length.md`); they are mounted under the virtual root
 * (`/query/functions/array-length.md`).
 */
export class DirTree {
    private readonly files = new Set<string>();
    private readonly dirs = new Set<string>([ROOT]);
    private readonly children = new Map<string, Set<string>>();

    constructor(relPaths: Iterable<string>) {
        for (const rel of relPaths) {
            this.add(rel);
        }
    }

    private add(rel: string): void {
        const clean = rel.replace(/^\/+|\/+$/g, "");
        if (clean === "") {
            return;
        }
        const parts = clean.split("/");
        const base = parts.pop();
        if (base === undefined) {
            return;
        }
        let dir = ROOT;
        for (const name of parts) {
            this.linkChild(dir, name);
            dir = dir === ROOT ? `/${name}` : `${dir}/${name}`;
            this.dirs.add(dir);
        }
        this.linkChild(dir, base);
        this.files.add(dir === ROOT ? `/${base}` : `${dir}/${base}`);
    }

    private linkChild(dir: string, name: string): void {
        let set = this.children.get(dir);
        if (!set) {
            set = new Set();
            this.children.set(dir, set);
        }
        set.add(name);
    }

    /** True when `abs` names a known file or directory. */
    has(abs: string): boolean {
        return this.files.has(abs) || this.dirs.has(abs);
    }

    isFile(abs: string): boolean {
        return this.files.has(abs);
    }

    isDir(abs: string): boolean {
        return this.dirs.has(abs);
    }

    /** Sorted child names (not full paths) of a directory; `[]` if unknown or a file. */
    childrenOf(abs: string): string[] {
        const set = this.children.get(abs);
        return set ? [...set].sort() : [];
    }

    /** Every directory and file (including root), sorted; for glob matching. */
    allPaths(): string[] {
        return [...new Set([...this.dirs, ...this.files])].sort();
    }

    /** Absolute paths of every file (not directories), sorted. */
    filePaths(): string[] {
        return [...this.files].sort();
    }
}

/** Point-read coordinates for one item: its `id` and partition-key value. */
export interface PointRef {
    id: string;
    pk: PartitionKey;
}

/** The in-memory tree plus a `key -> {id, pk}` index that keeps `cat` a point read. */
export interface CorpusIndex {
    tree: DirTree;
    /** Absolute key path (e.g. `/query/where.md`) -> how to point-read that item. */
    refs: Map<string, PointRef>;
}

/**
 * Load the corpus in one query and build both the directory tree and the
 * point-read index. `key` (the address) comes from the mapped key field and
 * falls back to the item's `id` when unmapped (a flat tree of opaque ids). The
 * index records each item's `id` and partition-key value so `cat` stays a ~1-RU
 * point read even when `key` is neither the `id` nor derivable from it. The query
 * is single-partition when the scope is the real PK, else cross-partition.
 */
export async function buildCorpusIndex(
    container: Container,
    mapping: ReaderMapping,
): Promise<CorpusIndex> {
    const { conditions, parameters, partitionKey } = scopeParts(mapping);
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const query = `SELECT c.id, ${mapping.keyExpr} AS k, ${mapping.pkExpr} AS pk FROM c${where}`;
    const feedOptions = partitionKey !== undefined ? { partitionKey } : {};

    const { resources } = await container.items
        .query<{ id: string; k?: string; pk: PartitionKey }>({ query, parameters }, feedOptions)
        .fetchAll();

    const keys: string[] = [];
    const refs = new Map<string, PointRef>();
    for (const row of resources) {
        const key = row.k ?? row.id; // unmapped/absent key falls back to the id (flat)
        keys.push(key);
        refs.set(posix.resolve("/", key), { id: row.id, pk: row.pk });
    }
    return { tree: new DirTree(keys), refs };
}
