import { describe, expect, test } from "bun:test";
import { join, length, made, MissingBlob, Op, resolve, span, validate, VERSION } from "../../src/format/index";

const meta = [Op.META, VERSION, "https://exemple.test/", 1000, 390, 844, 0];

describe("validate", () => {
	test("a snapshot with a doctype, an element and a text", () => {
		expect(validate([...meta, Op.D, "html", "", "", Op.E, "html", 1, "lang", "fr", Op.T, "x", Op.X])).toBeNull();
	});
	test("refuses an unknown fixed op, a bad version, an unclosed element", () => {
		expect(validate([...meta, 77])?.reason).toContain("bad op");
		expect(validate([Op.META, 9, "u", 0, 1, 1, 0])?.reason).toContain("version");
		expect(validate([...meta, Op.E, "p", 0])?.reason).toBe("unclosed");
	});
	test("refuses a node number that does not exist yet", () => {
		expect(validate([Op.DEL, 5], 3)?.reason).toBe("unknown node");
		expect(validate([Op.DEL, 2], 3)).toBeNull();
	});
	test("skips a framed op it does not know", () => {
		const tape = [...meta, 200, 2, "a", 1, Op.E, "p", 0, Op.X];
		expect(validate(tape)).toBeNull();
		expect(length(tape, 7)).toBe(4);
	});
});

test("made and span", () => {
	const tape = [...meta, Op.E, "p", 0, Op.T, "a", Op.X, Op.TICK, 40, Op.TICK, 10];
	expect(made(tape)).toEqual({ nodes: 3, fromMeta: true });
	expect(span(tape)).toEqual({ start: 1000, ms: 50 });
});

test("resolve puts pieces and long strings back, and says what is missing", () => {
	const blobs = new Map([
		["p1", JSON.stringify([Op.E, "p", 0, Op.T, ["s1"], Op.X])],
		["s1", "long"],
	]);
	expect(resolve([...meta, ["p1", 1]], (h) => blobs.get(h))).toEqual([...meta, Op.E, "p", 0, Op.T, "long", Op.X]);
	expect(() => resolve([["nope"]], () => undefined)).toThrow(MissingBlob);
});

describe("join", () => {
	const snap = { base: 1, seq: 0, tape: [...meta, Op.E, "p", 0, Op.X] };
	test("follows chunks whose numbers follow", () => {
		const out = join([snap, { base: 3, seq: 1, tape: [Op.TICK, 5, Op.INS, 2, 0, Op.T, "x", Op.X] }]);
		expect(out.gaps).toEqual([]);
	});
	test("a lost chunk is a hole until the next snapshot, even one that made no node", () => {
		const out = join([
			snap,
			{ base: 3, seq: 2, tape: [Op.TICK, 30, Op.ATTR, 2, "class", "a"] },
			{ base: 3, seq: 3, tape: [Op.TICK, 5, Op.INS, 2, 0, Op.T, "x", Op.X] },
			{ base: 1, seq: 4, tape: [...meta, Op.E, "p", 0, Op.X] },
		]);
		expect(out.gaps.length).toBe(2);
		expect(out.state.broken).toBe(false);
		// What the holes spanned is kept as time, not played.
		expect(out.tape.filter((t) => t === "class")).toEqual([]);
	});
});
