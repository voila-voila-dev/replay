// The tape: one flat array of numbers, strings and nulls. An opcode, then its operands.
// Nodes carry no number on the tape: each op that makes a node takes the next number, on
// both sides. After a META, the document is node 1.
//
// Codes 0 to 127 have a fixed length, frozen for the whole of version 2. Codes from 128 are
// framed (`code, n, …n operands`), so that a player skips the ones it does not know: every op
// added after version 2.0 goes there.

export const VERSION = 2;

export enum Op {
	/** Closes the node opened last. */
	X = 0,
	/** name, n, then n (name, value) pairs. Makes an element and opens it. */
	E = 1,
	/** data. Makes a text node. */
	T = 2,
	/** name, publicId, systemId. Makes a doctype. */
	D = 3,
	/** name, width, height. Makes an element recorded as an empty box. */
	B = 4,
	/** Opens the content of the template opened last. Makes a node. */
	TPL = 5,
	/** mode. Opens the shadow root of the element opened last. Makes a node. */
	SHADOW = 6,
	/** Opens the document of the iframe opened last. Makes a node. */
	FRAME = 7,
	/** id. A node already numbered, moved here. */
	R = 8,

	/** parent, anchor (0: at the end). Opens a node to insert before the anchor. */
	INS = 16,
	/** id */
	DEL = 17,
	/** id, name, value or null */
	ATTR = 18,
	/** id, data */
	TEXT = 19,
	/** id, value: a string, or 0/1 for `checked` and for an option's `selected` */
	VAL = 20,
	/** id, state: 0 closed, 1 open, 2 modal */
	OPEN = 21,

	/** node or 0 (a constructed sheet), sheet number, rules as text */
	SHEET = 32,
	/** sheet number, index path ("3", "3.1"), rule text or null (deleted) */
	RULE = 33,
	/** node (the document or a shadow root), n, then n sheet numbers */
	ADOPT = 34,

	/** milliseconds since the previous tick */
	TICK = 48,
	/** x, y */
	MOVE = 49,
	/** kind (1 down, 2 up, 3 click), id, x, y */
	TAP = 50,
	/** id (1: the page), x, y */
	SCROLL = 51,
	/** width, height */
	SIZE = 52,
	/** id, or 0 when nothing has focus */
	FOCUS = 53,
	/** 0 visible, 1 hidden */
	HIDE = 54,

	/** version, url, time (ms since epoch), width, height, mode (0 standards, 1 quirks) */
	META = 96,
	/** nodes, fingerprint: what the player checks its copy against */
	PRINT = 97,
	/** reason (see End) */
	END = 98,

	/** framed: id, a canvas as a data URL */
	SHOT = 128,
	/** framed: the name of a module cut off after it threw */
	ERR = 129,
	/** framed: id, the address of the picture an image shows, picked from its `srcset` or its `<picture>` */
	SHOWN = 130,
}

export enum End {
	Consent = 1,
	Budget = 2,
	Network = 3,
}

export type Token = number | string | null;
export type Tape = Array<Token>;
/** On the wire, `[hash]` stands for a long string and `[hash, 1]` for a piece of tape. */
export type WireToken = Token | [string] | [string, 1];
export type WireTape = Array<WireToken>;

/** Operand count of each fixed op. E and ADOPT carry their own counts. */
const ARITY: ReadonlyArray<number | undefined> = (() => {
	const a: Array<number | undefined> = [];
	const set = (op: Op, n: number) => {
		a[op] = n;
	};
	set(Op.X, 0);
	set(Op.E, -1);
	set(Op.T, 1);
	set(Op.D, 3);
	set(Op.B, 3);
	set(Op.TPL, 0);
	set(Op.SHADOW, 1);
	set(Op.FRAME, 0);
	set(Op.R, 1);
	set(Op.INS, 2);
	set(Op.DEL, 1);
	set(Op.ATTR, 3);
	set(Op.TEXT, 2);
	set(Op.VAL, 2);
	set(Op.OPEN, 2);
	set(Op.SHEET, 3);
	set(Op.RULE, 3);
	set(Op.ADOPT, -1);
	set(Op.TICK, 1);
	set(Op.MOVE, 2);
	set(Op.TAP, 4);
	set(Op.SCROLL, 3);
	set(Op.SIZE, 2);
	set(Op.FOCUS, 1);
	set(Op.HIDE, 1);
	set(Op.META, 6);
	set(Op.PRINT, 2);
	set(Op.END, 1);
	return a;
})();

/** The ops that make a node, and so take the next number. */
export function makesNode(op: number): boolean {
	return (
		op === Op.E ||
		op === Op.T ||
		op === Op.D ||
		op === Op.B ||
		op === Op.TPL ||
		op === Op.SHADOW ||
		op === Op.FRAME
	);
}

/** The ops a matching X closes. */
export function opens(op: number): boolean {
	return (
		op === Op.E ||
		op === Op.TPL ||
		op === Op.SHADOW ||
		op === Op.FRAME ||
		op === Op.INS
	);
}

/**
 * How many tokens the op at `i` takes, its code included; -1 when the tape is cut short or the
 * code is unknown and not framed.
 */
export function length(tape: ReadonlyArray<unknown>, i: number): number {
	const op = tape[i];
	if (typeof op !== "number") return -1;
	let n: number;
	if (op >= 128) {
		const framed = tape[i + 1];
		if (!isCount(framed)) return -1;
		n = 2 + framed;
	} else if (op === Op.E) {
		const count = tape[i + 2];
		if (!isCount(count)) return -1;
		n = 3 + 2 * count;
	} else if (op === Op.ADOPT) {
		const count = tape[i + 2];
		if (!isCount(count)) return -1;
		n = 3 + count;
	} else {
		const arity = ARITY[op];
		if (arity === undefined) return -1;
		n = 1 + arity;
	}
	return i + n <= tape.length ? n : -1;
}

function isCount(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e6;
}

const isNum = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);
const isId = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v) && v > 0;
const isStr = (v: unknown): v is string => typeof v === "string";

export type Invalid = { readonly at: number; readonly reason: string };

/**
 * Checks a tape before anything reads it: lengths, operand types, balanced opens, and node
 * numbers that exist. `base` is the number the first node made in this tape takes (from the
 * envelope); a tape that starts on a META needs none.
 */
export function validate(
	tape: ReadonlyArray<unknown>,
	base?: number,
): Invalid | null {
	if (!Array.isArray(tape)) return { at: 0, reason: "not an array" };
	let made = base === undefined ? Number.POSITIVE_INFINITY : base - 1;
	let depth = 0;
	for (let i = 0; i < tape.length; ) {
		const n = length(tape, i);
		if (n < 0) return { at: i, reason: `bad op ${String(tape[i])}` };
		const op = tape[i] as number;
		const a = (k: number) => tape[i + k];
		const known = (v: unknown) => isId(v) && v <= made;
		const bad = (reason: string) => ({ at: i, reason });
		switch (op) {
			case Op.X:
				if (--depth < 0) return bad("X without open");
				break;
			case Op.E:
				if (!isStr(a(1))) return bad("E name");
				for (let k = 3; k < n; k++) if (!isStr(a(k))) return bad("E attribute");
				break;
			case Op.T:
				if (!isStr(a(1))) return bad("T data");
				break;
			case Op.D:
				if (!isStr(a(1)) || !isStr(a(2)) || !isStr(a(3))) return bad("D");
				break;
			case Op.B:
				if (!isStr(a(1)) || !isNum(a(2)) || !isNum(a(3))) return bad("B");
				break;
			case Op.SHADOW:
				if (!isStr(a(1))) return bad("SHADOW mode");
				break;
			case Op.R:
			case Op.DEL:
				if (!known(a(1))) return bad("unknown node");
				break;
			case Op.INS:
				if (!known(a(1)) || !(a(2) === 0 || known(a(2))))
					return bad("INS nodes");
				break;
			case Op.ATTR:
				if (!known(a(1)) || !isStr(a(2)) || !(a(3) === null || isStr(a(3))))
					return bad("ATTR");
				break;
			case Op.TEXT:
				if (!known(a(1)) || !isStr(a(2))) return bad("TEXT");
				break;
			case Op.VAL:
				if (!known(a(1)) || !(isStr(a(2)) || a(2) === 0 || a(2) === 1))
					return bad("VAL");
				break;
			case Op.OPEN:
				if (!known(a(1)) || !(a(2) === 0 || a(2) === 1 || a(2) === 2))
					return bad("OPEN");
				break;
			case Op.SHEET:
				if (!(a(1) === 0 || known(a(1))) || !isCount(a(2)) || !isStr(a(3)))
					return bad("SHEET");
				break;
			case Op.RULE:
				if (!isCount(a(1)) || !isStr(a(2)) || !(a(3) === null || isStr(a(3))))
					return bad("RULE");
				break;
			case Op.ADOPT:
				if (!known(a(1))) return bad("ADOPT node");
				for (let k = 3; k < n; k++) if (!isCount(a(k))) return bad("ADOPT sheet");
				break;
			case Op.TICK:
				if (!isNum(a(1)) || (a(1) as number) < 0) return bad("TICK");
				break;
			case Op.MOVE:
			case Op.SIZE:
				if (!isNum(a(1)) || !isNum(a(2))) return bad("numbers");
				break;
			case Op.TAP:
				if (!isNum(a(1)) || !isNum(a(2)) || !isNum(a(3)) || !isNum(a(4)))
					return bad("TAP");
				break;
			case Op.SCROLL:
				if (!isNum(a(1)) || !isNum(a(2)) || !isNum(a(3))) return bad("SCROLL");
				break;
			case Op.FOCUS:
			case Op.HIDE:
			case Op.END:
				if (!isNum(a(1))) return bad("number");
				break;
			case Op.PRINT:
				if (!isNum(a(1)) || !isNum(a(2))) return bad("PRINT");
				break;
			case Op.META:
				if (a(1) !== VERSION) return bad(`version ${String(a(1))}`);
				if (!isStr(a(2)) || !isNum(a(3)) || !isNum(a(4)) || !isNum(a(5)))
					return bad("META");
				if (depth !== 0) return bad("META inside an open node");
				made = 1;
				break;
		}
		if (makesNode(op)) made++;
		if (opens(op)) depth++;
		i += n;
	}
	if (depth !== 0) return { at: tape.length, reason: "unclosed" };
	return null;
}

/** How many nodes a tape makes; when it holds a META, counted from its last META. */
export function made(tape: Tape): { nodes: number; fromMeta: boolean } {
	let nodes = 0;
	let fromMeta = false;
	for (let i = 0; i < tape.length; ) {
		const n = length(tape, i);
		if (n < 0) break;
		const op = tape[i] as number;
		if (op === Op.META) {
			nodes = 1;
			fromMeta = true;
		} else if (makesNode(op)) nodes++;
		i += n;
	}
	return { nodes, fromMeta };
}

/** Recorded milliseconds of a tape: the time of its first META (if any) plus its ticks. */
export function span(tape: Tape): { start: number | null; ms: number } {
	let start: number | null = null;
	let ms = 0;
	for (let i = 0; i < tape.length; ) {
		const n = length(tape, i);
		if (n < 0) break;
		const op = tape[i];
		if (op === Op.META && start === null) start = tape[i + 3] as number;
		else if (op === Op.TICK) ms += tape[i + 1] as number;
		i += n;
	}
	return { start, ms };
}

/** Puts back what the wire replaced by hashes. Throws on a hash it cannot find. */
export function resolve(
	wire: ReadonlyArray<WireToken>,
	blob: (hash: string) => string | undefined,
	depth = 0,
): Tape {
	if (depth > 4) throw new Error("replay: pieces nested too deep");
	const out: Tape = [];
	for (const token of wire) {
		if (!Array.isArray(token)) {
			out.push(token);
			continue;
		}
		const hash = token[0];
		const stored = typeof hash === "string" ? blob(hash) : undefined;
		if (stored === undefined) throw new MissingBlob(String(hash));
		if (token[1] === 1) {
			const piece: unknown = JSON.parse(stored);
			if (!Array.isArray(piece)) throw new Error("replay: a piece is no tape");
			for (const t of resolve(piece as WireTape, blob, depth + 1)) out.push(t);
		} else out.push(stored);
	}
	return out;
}

export class MissingBlob extends Error {
	constructor(readonly hash: string) {
		super(`replay: missing ${hash}`);
	}
}

/** The hashes a wire tape refers to, pieces' own references not included. */
export function references(wire: ReadonlyArray<WireToken>): Array<string> {
	const out: Array<string> = [];
	for (const token of wire)
		if (Array.isArray(token) && typeof token[0] === "string") out.push(token[0]);
	return out;
}

/** 32-bit FNV-1a, step by step: what PRINT's fingerprint is made of. */
export function fnv(h: number, v: number): number {
	return Math.imul(h ^ (v & 0xffff), 16777619) >>> 0;
}
export const FNV_START = 2166136261;

/** What a chunk carries besides its tape, as both sides see it. */
export interface Chunk {
	/** The number the first node made in this chunk takes. */
	readonly base: number;
	/** Its rank in the page view: 0, 1, 2… A missing rank is a hole, even one that made no node. */
	readonly seq?: number;
	readonly tape: Tape;
}

/**
 * Joins chunks into one tape: a hole (a chunk lost on the way) becomes a tick of the time it
 * spanned, and nothing is played until the next snapshot.
 */
export function join(
	chunks: ReadonlyArray<Chunk>,
	into: Tape = [],
	from: { next: number; broken: boolean; seq?: number } = { next: 0, broken: true },
) {
	const gaps: Array<{ index: number; ms: number }> = [];
	for (const chunk of chunks) {
		const tape = chunk.tape;
		if (validate(tape, tape[0] === Op.META ? undefined : chunk.base)) {
			// A chunk that does not read is a hole like a lost one.
			const ms = span(tape).ms;
			gaps.push({ index: into.length, ms });
			if (ms) into.push(Op.TICK, ms);
			from.broken = true;
			continue;
		}
		let start = 0;
		const skipped = chunk.seq !== undefined && from.seq !== undefined && chunk.seq !== from.seq + 1;
		if (chunk.seq !== undefined) from.seq = chunk.seq;
		if (from.broken || skipped || chunk.base !== from.next) {
			const meta = findMeta(tape);
			if (meta < 0) {
				const ms = span(tape).ms;
				gaps.push({ index: into.length, ms });
				if (ms) into.push(Op.TICK, ms);
				from.broken = true;
				continue;
			}
			start = meta;
		}
		const part = start ? tape.slice(start) : tape;
		for (const t of part) into.push(t);
		const m = made(part);
		from.next = m.fromMeta ? m.nodes + 1 : from.next + m.nodes;
		from.broken = false;
	}
	return { tape: into, gaps, state: from };
}

function findMeta(tape: Tape): number {
	for (let i = 0; i < tape.length; ) {
		if (tape[i] === Op.META) return i;
		const n = length(tape, i);
		if (n < 0) return -1;
		i += n;
	}
	return -1;
}

