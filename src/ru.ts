/**
 * Accumulates the request-unit (RU) charge Cosmos returns on every response, so
 * a session can report what it cost. One meter is created per {@link Session} in
 * `openCorpus`; the explore engine feeds each point read and query into it (the
 * startup shape read and tree build, `cat`'s point read, and `grep`'s coarse
 * filter), and the CLI prints the running total when the session ends.
 *
 * Structural commands (`ls`/`cd`/`find`) resolve from the in-memory tree and make
 * no Cosmos call, so they add nothing here. The meter never touches stdout; the
 * total surfaces only as a stderr diagnostic, keeping the output contract intact.
 */
export class RuMeter {
    private charged = 0;

    /**
     * Add one response's `requestCharge`. Tolerates `undefined`/non-finite values
     * so offline fakes (and any response missing the header) are a safe no-op
     * rather than turning the total into `NaN`.
     */
    add(charge: number | undefined): void {
        if (typeof charge === "number" && Number.isFinite(charge)) {
            this.charged += charge;
        }
    }

    /** Total RU accumulated so far this session. */
    get total(): number {
        return this.charged;
    }
}
