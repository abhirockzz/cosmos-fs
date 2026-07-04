import { posix } from "node:path";
import type { Container } from "@azure/cosmos";
import type { FileContent, FsStat, IFileSystem } from "just-bash";
import { getField, type ReaderMapping } from "./mapping.js";
import type { RuMeter } from "./ru.js";
import type { DirTree, PointRef } from "./tree.js";

const DIR_MODE = 0o755;
const FILE_MODE = 0o644;
const EPOCH = new Date(0);

/** Entry shape returned by `readdirWithFileTypes` (structurally just-bash's `DirentEntry`). */
interface Dirent {
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
}

function readOnly(path: string, op: string): Error {
    return new Error(`EROFS: read-only file system, ${op} '${path}'`);
}

/**
 * Read-only just-bash filesystem backed by a Cosmos-derived {@link DirTree}.
 *
 * Structural navigation (`ls`/`cd`/`find`) resolves entirely from the in-memory
 * tree. Reading file content (`cat`) is a single Cosmos point read via the
 * startup index (`key -> {id, pk}`), returning the item's mapped content field
 * (~1 RU). Every mutating operation throws `EROFS`.
 */
export class CosmosFs implements IFileSystem {
    constructor(
        private readonly tree: DirTree,
        private readonly container: Container,
        private readonly mapping: ReaderMapping,
        private readonly refs: Map<string, PointRef>,
        private readonly meter?: RuMeter,
    ) { }

    private norm(p: string): string {
        return posix.resolve("/", p);
    }

    private statAs(p: string, op: string): FsStat {
        const abs = this.norm(p);
        if (this.tree.isDir(abs)) {
            return {
                isFile: false,
                isDirectory: true,
                isSymbolicLink: false,
                mode: DIR_MODE,
                size: 0,
                mtime: EPOCH,
            };
        }
        if (this.tree.isFile(abs)) {
            return {
                isFile: true,
                isDirectory: false,
                isSymbolicLink: false,
                mode: FILE_MODE,
                size: 0,
                mtime: EPOCH,
            };
        }
        throw new Error(`ENOENT: no such file or directory, ${op} '${p}'`);
    }

    async stat(p: string): Promise<FsStat> {
        return this.statAs(p, "stat");
    }

    // No symlinks in the virtual corpus, so lstat mirrors stat.
    async lstat(p: string): Promise<FsStat> {
        return this.statAs(p, "lstat");
    }

    async exists(p: string): Promise<boolean> {
        return this.tree.has(this.norm(p));
    }

    async readdir(p: string): Promise<string[]> {
        const abs = this.norm(p);
        if (this.tree.isFile(abs)) {
            throw new Error(`ENOTDIR: not a directory, scandir '${p}'`);
        }
        if (!this.tree.isDir(abs)) {
            throw new Error(`ENOENT: no such file or directory, scandir '${p}'`);
        }
        return this.tree.childrenOf(abs);
    }

    async readdirWithFileTypes(p: string): Promise<Dirent[]> {
        const abs = this.norm(p);
        if (this.tree.isFile(abs)) {
            throw new Error(`ENOTDIR: not a directory, scandir '${p}'`);
        }
        if (!this.tree.isDir(abs)) {
            throw new Error(`ENOENT: no such file or directory, scandir '${p}'`);
        }
        return this.tree.childrenOf(abs).map((name) => {
            const child = abs === "/" ? `/${name}` : `${abs}/${name}`;
            return {
                name,
                isFile: this.tree.isFile(child),
                isDirectory: this.tree.isDir(child),
                isSymbolicLink: false,
            };
        });
    }

    resolvePath(base: string, path: string): string {
        // Anchor at "/" so a stray relative base can never leak the host cwd and
        // ".." always clamps at the virtual root (same idiom as norm()).
        return posix.resolve("/", base || "/", path);
    }

    getAllPaths(): string[] {
        return this.tree.allPaths();
    }

    async realpath(p: string): Promise<string> {
        const abs = this.norm(p);
        if (this.tree.has(abs)) {
            return abs;
        }
        throw new Error(`ENOENT: no such file or directory, realpath '${p}'`);
    }

    async readlink(p: string): Promise<string> {
        const abs = this.norm(p);
        if (!this.tree.has(abs)) {
            throw new Error(`ENOENT: no such file or directory, readlink '${p}'`);
        }
        throw new Error(`EINVAL: invalid argument, readlink '${p}'`);
    }

    // --- File content: a single Cosmos point read (~1 RU) ---

    /**
     * Fetch an item's content via a point read. The in-memory tree is the source
     * of truth for existence, so directory/missing cases fail (matching a real
     * fs: `EISDIR`/`ENOENT`) before any Cosmos call. The point read is keyed by
     * the index's `{id, pk}` for this key, so it stays ~1 RU and single-partition
     * even when the mapped `key` is not the `id`; the SDK retries 429s on its own.
     */
    private async fetchContent(p: string): Promise<string> {
        const abs = this.norm(p);
        if (this.tree.isDir(abs)) {
            throw new Error(`EISDIR: illegal operation on a directory, read '${p}'`);
        }
        const ref = this.refs.get(abs);
        if (!this.tree.isFile(abs) || ref === undefined) {
            throw new Error(`ENOENT: no such file or directory, open '${p}'`);
        }
        const response = await this.container.item(ref.id, ref.pk).read();
        this.meter?.add(response.requestCharge);
        const content = getField(response.resource, this.mapping.contentField);
        if (content === null || content === undefined) {
            // Tree lists it as a file but the item has no content: treat as missing.
            throw new Error(`ENOENT: no such file or directory, open '${p}'`);
        }
        return typeof content === "string" ? content : String(content);
    }

    async readFile(p: string): Promise<string> {
        return this.fetchContent(p);
    }

    async readFileBuffer(p: string): Promise<Uint8Array> {
        return new TextEncoder().encode(await this.fetchContent(p));
    }

    // --- Mutations: read-only filesystem ---

    async writeFile(p: string, _content: FileContent): Promise<void> {
        throw readOnly(p, "open");
    }

    async appendFile(p: string, _content: FileContent): Promise<void> {
        throw readOnly(p, "open");
    }

    async mkdir(p: string): Promise<void> {
        throw readOnly(p, "mkdir");
    }

    async rm(p: string): Promise<void> {
        throw readOnly(p, "unlink");
    }

    async cp(_src: string, dest: string): Promise<void> {
        throw readOnly(dest, "copyfile");
    }

    async mv(_src: string, dest: string): Promise<void> {
        throw readOnly(dest, "rename");
    }

    async chmod(p: string): Promise<void> {
        throw readOnly(p, "chmod");
    }

    async symlink(_target: string, linkPath: string): Promise<void> {
        throw readOnly(linkPath, "symlink");
    }

    async link(_existingPath: string, newPath: string): Promise<void> {
        throw readOnly(newPath, "link");
    }

    async utimes(p: string): Promise<void> {
        throw readOnly(p, "utime");
    }
}
