import { describe, expect, it } from "vitest";
import { RuMeter } from "../../src/ru.js";

// The meter is the single seam every Cosmos response funnels its requestCharge
// into, so its arithmetic and its tolerance of missing/garbage charges are what
// keep the reported total honest.
describe("RuMeter", () => {
    it("starts at zero and sums added charges", () => {
        const meter = new RuMeter();
        expect(meter.total).toBe(0);
        meter.add(1);
        meter.add(2.89);
        meter.add(0.5);
        expect(meter.total).toBeCloseTo(4.39, 5);
    });

    it("ignores undefined and non-finite charges instead of poisoning the total", () => {
        const meter = new RuMeter();
        meter.add(2.5);
        meter.add(undefined); // a response missing the header (or an offline fake)
        meter.add(Number.NaN);
        meter.add(Number.POSITIVE_INFINITY);
        expect(meter.total).toBe(2.5);
    });
});
