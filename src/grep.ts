import { posix } from "node:path";
import type { Container } from "@azure/cosmos";
import { Bash, type Command, defineCommand, InMemoryFs, latin1FromBytes } from "just-bash";
import { type ReaderMapping, scopeParts } from "./mapping.js";
import type { RuMeter } from "./ru.js";
import type { DirTree } from "./tree.js";

/**
 * How to fetch page content for a grep run.
 *
 * - `contains`: the pattern is a plain, non-inverted literal, so a single
 *   `CONTAINS(c.content, needle)` query returns a superset of the pages whose
 *   lines can match (coarse pushdown). Only those pages' content is fetched.
 * - `all`: we cannot safely push a substring filter down (inverted match, a
 *   regex with metacharacters, `-e`/`-f`, or any flag we don't recognize), so
 *   we fetch every page's content for the namespace in one query and let the
 *   real grep decide. Still a single single-partition query, never N point reads.
 * - `word`: the pattern is a literal AND `-w`/`--word-regexp` was given, so a
 *   whole-word match is wanted. When the content field is full-text indexed this
 *   becomes an index-accelerated `FullTextContains(All)` coarse filter (RU stays
 *   ~flat with corpus size); otherwise it degrades to the `contains` substring
 *   filter. Either candidate set is a superset of the `-w` matches, so the
 *   in-memory fine `grep -w` trims to byte-identical output.
 */
export type CoarsePlan =
    | { mode: "contains"; needle: string; caseInsensitive: boolean }
    | { mode: "word"; needle: string; caseInsensitive: boolean }
    | { mode: "all" };

// Characters that make a grep pattern a regex rather than a plain literal. If a
// pattern contains any of these (and `-F` was not given) we cannot treat it as a
// substring, so we fall back to fetching all content.
const REGEX_META = /[.^$*+?()[\]{}|\\]/;

// Short flags we understand and that do NOT change our ability to push a literal
// substring filter down: recursion, line numbers, listing, counting, word/line
// anchoring, only-matching, filename control, quiet, and the regex-flavor flags
// (flavor only matters once the pattern actually contains metacharacters, which
// REGEX_META already guards). `i`/`y` set case-insensitivity; `v` inverts.
const KNOWN_LITERAL_SAFE_SHORT = new Set([
    "r", "R", "n", "l", "L", "c", "w", "x", "o", "H", "h", "s", "a", "z", "U", "I", "q", "E", "G", "P", "F",
]);

const LONG_FLAG_IGNORE_CASE = new Set(["--ignore-case"]);
const LONG_FLAG_INVERT = new Set(["--invert-match"]);
// Long flags that keep a literal pushdown viable (booleans that don't take a value
// and don't invert). Anything not here forces the safe `all` fallback.
const LONG_FLAG_LITERAL_SAFE = new Set([
    "--recursive", "--dereference-recursive", "--line-number", "--files-with-matches",
    "--files-without-match", "--count", "--word-regexp", "--line-regexp", "--only-matching",
    "--with-filename", "--no-filename", "--fixed-strings", "--extended-regexp", "--basic-regexp",
    "--perl-regexp", "--no-messages",
]);

/**
 * Decide how to fetch content for a grep invocation from its argv (everything
 * after `grep`). Pure: no Cosmos, no I/O — unit-tested offline.
 *
 * The rule is conservative: only return `contains` when we are certain a
 * substring filter cannot drop a page the real grep would match (a false
 * negative would break parity). Every uncertain case returns `all`.
 */
export function planCoarseFilter(args: string[]): CoarsePlan {
    let caseInsensitive = false;
    let fixed = false;
    let forceAll = false;
    let wordFlag = false;
    let needle: string | undefined;
    let afterDoubleDash = false;

    for (const token of args) {
        if (!afterDoubleDash && token === "--") {
            afterDoubleDash = true;
            continue;
        }
        const isFlag = !afterDoubleDash && token.length > 1 && token.startsWith("-");
        if (!isFlag) {
            if (needle === undefined) {
                needle = token; // first positional is the pattern; the rest are paths
            }
            continue;
        }
        if (token.startsWith("--")) {
            if (LONG_FLAG_IGNORE_CASE.has(token)) {
                caseInsensitive = true;
            } else if (LONG_FLAG_INVERT.has(token)) {
                forceAll = true;
            } else if (token === "--fixed-strings") {
                fixed = true;
            } else if (token === "--word-regexp") {
                wordFlag = true;
            } else if (!LONG_FLAG_LITERAL_SAFE.has(token)) {
                forceAll = true; // unknown / value-taking (--regexp=, --file=, --color, ...)
            }
            continue;
        }
        for (const ch of token.slice(1)) {
            if (ch === "i" || ch === "y") {
                caseInsensitive = true;
            } else if (ch === "v") {
                forceAll = true; // inverted match: any page may match
            } else if (ch === "F") {
                fixed = true;
            } else if (ch === "w") {
                wordFlag = true; // whole-word: enables the FTS coarse filter when available
            } else if (!KNOWN_LITERAL_SAFE_SHORT.has(ch)) {
                forceAll = true; // e/f (extra patterns), value-takers (m/A/B/C/d), unknowns
            }
        }
    }

    if (forceAll || needle === undefined || needle === "") {
        return { mode: "all" };
    }
    if (!fixed && REGEX_META.test(needle)) {
        return { mode: "all" };
    }
    if (wordFlag) {
        return { mode: "word", needle, caseInsensitive };
    }
    return { mode: "contains", needle, caseInsensitive };
}

// Short flags that consume the following token as their value, so the value is
// not mistaken for a file operand when deciding whether grep reads the corpus.
const SHORT_VALUE_TAKERS = new Set(["A", "B", "C", "m", "d", "D"]);
// Long flags that take a value as a SEPARATE token (so the next token is skipped).
const LONG_VALUE_TAKERS = new Set([
    "--after-context", "--before-context", "--context", "--max-count", "--color",
    "--colour", "--group-separator", "--devices", "--binary-files", "--label",
]);

/**
 * Does this grep read the corpus (files), or only stdin? grep reads the corpus
 * when given `-r`/`-R` (or `--recursive`) or one or more file operands; otherwise
 * it filters piped stdin. When it only reads stdin (e.g. `cat x | grep y`,
 * `find . | grep y`), the Cosmos coarse fetch is pure waste, so the caller can
 * skip it. `-e`/`-f` supply the pattern, so the first positional then counts as a
 * file operand. Conservative: any ambiguity resolves to "reads the corpus" so we
 * never drop content grep would actually need.
 */
export function grepReadsCorpus(args: string[]): boolean {
    let afterDoubleDash = false;
    let patternFromFlag = false; // -e/-f already gave the pattern
    let sawPositionalPattern = false;
    let operandCount = 0; // non-flag tokens that are not the pattern (file operands)

    for (let i = 0; i < args.length; i++) {
        const token = args[i] as string;
        if (!afterDoubleDash && token === "--") {
            afterDoubleDash = true;
            continue;
        }
        const isFlag = !afterDoubleDash && token.length > 1 && token.startsWith("-");
        if (!isFlag) {
            if (patternFromFlag || sawPositionalPattern) {
                operandCount++;
            } else {
                sawPositionalPattern = true; // this positional is the pattern
            }
            continue;
        }
        if (token.startsWith("--")) {
            const eq = token.indexOf("=");
            const name = eq === -1 ? token : token.slice(0, eq);
            if (name === "--recursive" || name === "--dereference-recursive") {
                return true;
            }
            if (name === "--regexp" || name === "--file") {
                patternFromFlag = true;
                if (eq === -1) {
                    i++; // pattern/file is the next token
                }
            } else if (LONG_VALUE_TAKERS.has(name) && eq === -1) {
                i++; // skip the separate value token
            }
            continue;
        }
        // Short-flag group, e.g. -rn, -A, -e, -A3.
        const chars = token.slice(1);
        for (let j = 0; j < chars.length; j++) {
            const ch = chars[j] as string;
            if (ch === "r" || ch === "R") {
                return true;
            }
            if (ch === "e" || ch === "f") {
                patternFromFlag = true;
                if (j === chars.length - 1) {
                    i++; // value is the next token
                }
                break; // rest of the group is this flag's value
            }
            if (SHORT_VALUE_TAKERS.has(ch)) {
                if (j === chars.length - 1) {
                    i++; // value is the next token
                }
                break; // rest of the group is this flag's value
            }
        }
    }
    return operandCount > 0;
}

/** Fetch `{ absPath -> content }` for the pages a grep run needs. */
async function fetchContent(
    container: Container,
    mapping: ReaderMapping,
    plan: CoarsePlan,
    meter?: RuMeter,
): Promise<Map<string, string>> {
    const { conditions, parameters, partitionKey } = scopeParts(mapping);
    if (plan.mode === "word") {
        const tokens = plan.needle.split(/\s+/).filter((t) => t.length > 0);
        // FTS terms must be simple tokens; validating them as [A-Za-z0-9]+ also
        // keeps inlining them injection-safe (same discipline as field names).
        const clean = tokens.length > 0 && tokens.every((t) => /^[A-Za-z0-9]+$/.test(t));
        if (mapping.ftsContent && clean) {
            const quoted = tokens.map((t) => `"${t}"`);
            // FullTextContains for one term, FullTextContainsAll for several. The
            // index returns a superset of the whole-word matches; the fine grep trims.
            conditions.push(
                tokens.length === 1
                    ? `FullTextContains(${mapping.contentExpr}, ${quoted[0]})`
                    : `FullTextContainsAll(${mapping.contentExpr}, ${quoted.join(", ")})`,
            );
        } else {
            // No full-text index (or a non-word needle): a substring CONTAINS is
            // still a superset of the whole-word matches, so parity holds.
            conditions.push(`CONTAINS(${mapping.contentExpr}, @needle, @ci)`);
            parameters.push(
                { name: "@needle", value: plan.needle },
                { name: "@ci", value: plan.caseInsensitive },
            );
        }
    } else if (plan.mode === "contains") {
        conditions.push(`CONTAINS(${mapping.contentExpr}, @needle, @ci)`);
        parameters.push(
            { name: "@needle", value: plan.needle },
            { name: "@ci", value: plan.caseInsensitive },
        );
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const query = `SELECT c.id, ${mapping.keyExpr} AS k, ${mapping.contentExpr} AS content FROM c${where}`;
    const feedOptions = partitionKey !== undefined ? { partitionKey } : {};

    const response = await container.items
        .query<{ id: string; k?: string; content?: string }>({ query, parameters }, feedOptions)
        .fetchAll();
    meter?.add(response.requestCharge);
    const { resources } = response;
    const byPath = new Map<string, string>();
    for (const row of resources) {
        // Same key fallback as the tree/index so grep's paths line up with `ls`.
        byPath.set(posix.resolve("/", row.k ?? row.id), row.content ?? "");
    }
    return byPath;
}

/**
 * A Cosmos-backed `grep` that overrides just-bash's built-in (which would read
 * every page with a separate point read). It pushes a coarse substring filter to
 * Cosmos, then delegates the fine match to the built-in grep running over an
 * in-memory filesystem seeded with the corpus: pages that survive the coarse
 * filter carry their real content, the rest are seeded empty. Empty stand-ins
 * keep the directory structure identical to the real corpus, so recursive walks,
 * per-file counts (`-c`), and "files without match" (`-L`) format exactly as the
 * real grep would while contributing no spurious matches.
 *
 * Delegating to the built-in grep (rather than reimplementing regex + output
 * formatting) is what makes the result byte-identical to a real grep, which the
 * parity oracle asserts. The agent-supplied pattern only ever reaches Cosmos as
 * a query parameter and reaches grep as a raw argv entry (no shell re-parsing),
 * so neither path is an injection surface.
 */
export function createGrepCommand(
    container: Container,
    mapping: ReaderMapping,
    tree: DirTree,
    meter?: RuMeter,
): Command {
    const files = tree.filePaths();
    return defineCommand("grep", async (args, ctx) => {
        const plan = planCoarseFilter(args);
        // When grep will only read piped stdin (no -r, no file operands), it never
        // touches the corpus, so the Cosmos coarse fetch would be pure cost. Skip
        // it and seed an empty fs; the built-in grep filters the stdin in memory.
        // This is what makes `cat x | grep y` and `find . | grep y` cost only the
        // upstream command (or nothing), instead of a full coarse query.
        const content = grepReadsCorpus(args)
            ? await fetchContent(container, mapping, plan, meter)
            : new Map<string, string>();

        const mem = new InMemoryFs();
        for (const abs of files) {
            await mem.mkdir(posix.dirname(abs), { recursive: true });
            await mem.writeFile(abs, content.get(abs) ?? "");
        }
        // defenseInDepth is a process-global singleton; it is disabled on the
        // outer shell (see src/cli.ts), so the throwaway must match. The corpus
        // is mounted at "/", so strip the default bin/dev/proc/usr layout Bash
        // seeds into an InMemoryFs to mirror the corpus-only view.
        const inner = new Bash({ fs: mem, cwd: ctx.cwd, defenseInDepth: false });
        await inner.exec("rm -rf /bin /dev /proc /usr");
        // Forward stdin verbatim: with no file operands (and no -r) the built-in
        // grep reads stdin, so piped uses like `find . | grep x` and `cat p | grep y`
        // filter the piped bytes; with file operands or -r it reads the seeded
        // corpus and ignores stdin. Passing both lets grep's own operand logic
        // choose the source, so we never need to branch.
        const result = await inner.exec("grep", {
            cwd: ctx.cwd,
            args,
            stdin: latin1FromBytes(ctx.stdin),
            stdinKind: "bytes",
        });
        // A whole-word search that found nothing is often too narrow (`-w config`
        // misses `configuration`). Nudge toward broadening, on stderr so it never
        // pollutes stdout (grep exit 1 with empty stdout == no lines selected).
        const noMatch = result.exitCode === 1 && result.stdout === "";
        const stderr =
            plan.mode === "word" && noMatch
                ? `${result.stderr}grep: no whole-word matches; retry without -w for a partial-word or substring match.\n`
                : result.stderr;
        return { stdout: result.stdout, stderr, exitCode: result.exitCode };
    });
}
