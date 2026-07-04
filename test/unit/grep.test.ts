import { describe, expect, it } from "vitest";
import { type CoarsePlan, grepReadsCorpus, planCoarseFilter } from "../../src/grep.js";

// planCoarseFilter decides whether a grep invocation can push a substring filter
// down to Cosmos (`contains`) or must fetch all page content and let the real
// grep decide (`all`). It must never return `contains` when doing so could drop
// a page the real grep would match — a false negative would break parity — so
// everything uncertain falls back to `all`.
describe("planCoarseFilter", () => {
    const contains = (needle: string, caseInsensitive = false): CoarsePlan => ({
        mode: "contains",
        needle,
        caseInsensitive,
    });

    const word = (needle: string, caseInsensitive = false): CoarsePlan => ({
        mode: "word",
        needle,
        caseInsensitive,
    });

    it("pushes down a plain literal pattern", () => {
        expect(planCoarseFilter(["partition"])).toEqual(contains("partition"));
    });

    it("keeps literal pushdown across recursion / line-number / listing flags", () => {
        expect(planCoarseFilter(["-rn", "throughput", "."])).toEqual(contains("throughput"));
        expect(planCoarseFilter(["-rl", "throughput", "."])).toEqual(contains("throughput"));
        expect(planCoarseFilter(["-c", "throughput", "overview.md"])).toEqual(
            contains("throughput"),
        );
    });

    it("treats the first positional as the pattern and ignores path args", () => {
        expect(planCoarseFilter(["-r", "index", "query/advisor"])).toEqual(contains("index"));
    });

    it("sets caseInsensitive for -i / -y / --ignore-case (incl. combined flags)", () => {
        expect(planCoarseFilter(["-i", "Cosmos"])).toEqual(contains("Cosmos", true));
        expect(planCoarseFilter(["-ri", "Cosmos", "."])).toEqual(contains("Cosmos", true));
        expect(planCoarseFilter(["--ignore-case", "Cosmos"])).toEqual(contains("Cosmos", true));
    });

    it("returns `word` mode for a literal with -w / --word-regexp", () => {
        expect(planCoarseFilter(["-w", "partition"])).toEqual(word("partition"));
        expect(planCoarseFilter(["-rwl", "throughput", "."])).toEqual(word("throughput"));
        expect(planCoarseFilter(["--word-regexp", "index"])).toEqual(word("index"));
    });

    it("carries case-insensitivity into `word` mode (-wi)", () => {
        expect(planCoarseFilter(["-wi", "Cosmos"])).toEqual(word("Cosmos", true));
    });

    it("keeps a multi-word literal in `word` mode", () => {
        expect(planCoarseFilter(["-rw", "partition key", "."])).toEqual(word("partition key"));
    });

    it("treats a metacharacter -w pattern as `word` only under -F", () => {
        expect(planCoarseFilter(["-w", "a.b()"])).toEqual({ mode: "all" });
        expect(planCoarseFilter(["-Fw", "a.b()"])).toEqual(word("a.b()"));
    });

    it("falls back to `all` for -wv (word + inverted)", () => {
        expect(planCoarseFilter(["-wv", "Cosmos"])).toEqual({ mode: "all" });
    });

    it("preserves a multi-word literal (no metacharacters)", () => {
        expect(planCoarseFilter(["-rn", "partition key", "."])).toEqual(contains("partition key"));
    });

    it("falls back to `all` for inverted match (-v / --invert-match)", () => {
        expect(planCoarseFilter(["-v", "Cosmos", "overview.md"])).toEqual({ mode: "all" });
        expect(planCoarseFilter(["-rv", "Cosmos", "."])).toEqual({ mode: "all" });
        expect(planCoarseFilter(["--invert-match", "Cosmos"])).toEqual({ mode: "all" });
    });

    it("falls back to `all` for a regex pattern with metacharacters", () => {
        expect(planCoarseFilter(["-rn", "partition.*key", "."])).toEqual({ mode: "all" });
        expect(planCoarseFilter(["-E", "ttl|TimeToLive", "."])).toEqual({ mode: "all" });
    });

    it("treats a metacharacter pattern as literal under -F / --fixed-strings", () => {
        expect(planCoarseFilter(["-F", "a.b()"])).toEqual(contains("a.b()"));
        expect(planCoarseFilter(["--fixed-strings", "a.b()"])).toEqual(contains("a.b()"));
    });

    it("falls back to `all` for -e / -f (extra patterns or pattern files)", () => {
        expect(planCoarseFilter(["-e", "Cosmos", "."])).toEqual({ mode: "all" });
        expect(planCoarseFilter(["-f", "patterns.txt", "."])).toEqual({ mode: "all" });
    });

    it("falls back to `all` for value-taking or unknown flags", () => {
        expect(planCoarseFilter(["-m", "3", "Cosmos", "."])).toEqual({ mode: "all" });
        expect(planCoarseFilter(["-A", "2", "Cosmos", "."])).toEqual({ mode: "all" });
    });

    it("falls back to `all` when there is no pattern or the pattern is empty", () => {
        expect(planCoarseFilter([])).toEqual({ mode: "all" });
        expect(planCoarseFilter(["-r"])).toEqual({ mode: "all" });
        expect(planCoarseFilter([""])).toEqual({ mode: "all" });
    });

    it("stops flag parsing after -- so a dashed literal is still pushed down", () => {
        expect(planCoarseFilter(["-r", "--", "-n", "."])).toEqual(contains("-n"));
    });
});

// grepReadsCorpus decides whether a grep run needs the Cosmos coarse fetch at all.
// When grep only filters piped stdin (no -r, no file operands) the fetch is pure
// RU waste, so this must return false there — but stay conservative (true) whenever
// grep might read the corpus, or dropping content would break output.
describe("grepReadsCorpus", () => {
    it("is false for a stdin-only filter (cat x | grep y, find | grep y)", () => {
        expect(grepReadsCorpus(["vector"])).toBe(false);
        expect(grepReadsCorpus(["-n", "vector"])).toBe(false);
        expect(grepReadsCorpus(["-in", "Vector"])).toBe(false);
    });

    it("is true with -r / -R / --recursive (reads the corpus tree)", () => {
        expect(grepReadsCorpus(["-r", "vector", "."])).toBe(true);
        expect(grepReadsCorpus(["-rn", "vector", "."])).toBe(true);
        expect(grepReadsCorpus(["-R", "vector", "."])).toBe(true);
        expect(grepReadsCorpus(["--recursive", "vector", "."])).toBe(true);
    });

    it("is true when a file operand is present (grep pattern file.md)", () => {
        expect(grepReadsCorpus(["vector", "overview.md"])).toBe(true);
        expect(grepReadsCorpus(["-n", "vector", "a.md", "b.md"])).toBe(true);
    });

    it("does not mistake a value-taking flag's value for a file operand", () => {
        expect(grepReadsCorpus(["-A", "3", "vector"])).toBe(false); // -A 3, then stdin
        expect(grepReadsCorpus(["-A3", "vector"])).toBe(false); // bundled value
        expect(grepReadsCorpus(["-m", "1", "vector"])).toBe(false);
        expect(grepReadsCorpus(["--after-context", "2", "vector"])).toBe(false);
    });

    it("treats the first positional after -e/-f as a file operand (pattern came from the flag)", () => {
        expect(grepReadsCorpus(["-e", "vector"])).toBe(false); // pattern only, stdin
        expect(grepReadsCorpus(["-e", "vector", "overview.md"])).toBe(true); // now a file operand
        expect(grepReadsCorpus(["-f", "pats.txt"])).toBe(false);
    });

    it("honors -- then counts the following tokens as operands", () => {
        expect(grepReadsCorpus(["--", "vector"])).toBe(false); // just the pattern
        expect(grepReadsCorpus(["--", "vector", "file.md"])).toBe(true); // pattern + operand
    });
});
