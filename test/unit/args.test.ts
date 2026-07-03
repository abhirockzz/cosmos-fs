import { describe, expect, it } from "vitest";
import { type ParsedArgs, parseArgs } from "../../src/args.js";

// parseArgs is pure and total (never throws, never reads env). These lock its
// classification of every mode: help/version, one-shot, REPL, config overrides,
// and the footgun errors a user or agent is likely to hit.
describe("parseArgs", () => {
    it("defaults to an interactive REPL with no args", () => {
        expect(parseArgs([])).toEqual({ kind: "repl", overrides: {} });
    });

    it("recognizes --help / -h (and it wins over other tokens)", () => {
        expect(parseArgs(["--help"])).toEqual({ kind: "help" });
        expect(parseArgs(["-h"])).toEqual({ kind: "help" });
        expect(parseArgs(["-c", "ls", "--help"])).toEqual({ kind: "help" });
    });

    it("recognizes --version / -V", () => {
        expect(parseArgs(["--version"])).toEqual({ kind: "version" });
        expect(parseArgs(["-V"])).toEqual({ kind: "version" });
    });

    it("parses -c / --command into a one-shot run", () => {
        expect(parseArgs(["-c", "ls query"])).toEqual({
            kind: "run",
            command: "ls query",
            overrides: {},
        });
        expect(parseArgs(["--command", "cat overview.md"])).toEqual({
            kind: "run",
            command: "cat overview.md",
            overrides: {},
        });
    });

    it("takes a -c command verbatim even when it contains dashes and pipes", () => {
        expect(parseArgs(["-c", "grep -rn 'x' . | head"])).toEqual({
            kind: "run",
            command: "grep -rn 'x' . | head",
            overrides: {},
        });
    });

    it("errors when -c has no command", () => {
        const r = parseArgs(["-c"]) as Extract<ParsedArgs, { kind: "error" }>;
        expect(r.kind).toBe("error");
        expect(r.message).toContain("-c requires a command");
    });

    it("collects config overrides in both --flag value and --flag=value forms", () => {
        expect(parseArgs(["--endpoint", "https://x/", "--namespace", "s", "-c", "ls"])).toEqual({
            kind: "run",
            command: "ls",
            overrides: { endpoint: "https://x/", namespace: "s" },
        });
        expect(parseArgs(["--database=mydb", "--container=items"])).toEqual({
            kind: "repl",
            overrides: { database: "mydb", container: "items" },
        });
    });

    it("errors when a value flag is missing its value", () => {
        const r = parseArgs(["--endpoint"]) as Extract<ParsedArgs, { kind: "error" }>;
        expect(r.kind).toBe("error");
        expect(r.message).toContain("--endpoint requires a value");
    });

    it("errors on an unknown option", () => {
        const r = parseArgs(["--nope"]) as Extract<ParsedArgs, { kind: "error" }>;
        expect(r.kind).toBe("error");
        expect(r.message).toContain("unknown option: --nope");
    });

    it("errors on a bare positional and suggests -c", () => {
        const r = parseArgs(["ls"]) as Extract<ParsedArgs, { kind: "error" }>;
        expect(r.kind).toBe("error");
        expect(r.message).toContain('did you mean -c "ls"');
    });

    it("parses the ingest subcommand with a folder and overrides", () => {
        expect(parseArgs(["ingest", "./docs"])).toEqual({
            kind: "ingest",
            folder: "./docs",
            overrides: {},
        });
        expect(parseArgs(["ingest", "./docs", "--namespace", "notes"])).toEqual({
            kind: "ingest",
            folder: "./docs",
            overrides: { namespace: "notes" },
        });
        expect(parseArgs(["ingest", "--namespace=notes", "./docs"])).toEqual({
            kind: "ingest",
            folder: "./docs",
            overrides: { namespace: "notes" },
        });
    });

    it("errors when ingest has no folder or an extra positional", () => {
        const noFolder = parseArgs(["ingest"]) as Extract<ParsedArgs, { kind: "error" }>;
        expect(noFolder.kind).toBe("error");
        expect(noFolder.message).toContain("ingest requires a folder path");

        const extra = parseArgs(["ingest", "a", "b"]) as Extract<ParsedArgs, { kind: "error" }>;
        expect(extra.kind).toBe("error");
        expect(extra.message).toContain("unexpected argument: b");
    });
});
