// Sends a page view's tapes, in order. What the server may already hold goes as its hash: the
// pieces of a snapshot and long strings (stylesheets, pictures). The server answers with the
// hashes it wants (`need`), and with `snap` when it saw a hole: the caller then takes a new
// snapshot. On the way out, one beacon carries what is left, as much as fits.
import type { Tape, WireTape } from "../format/index";

/** Strings longer than this are sent by hash. */
const LONG = 256;
/** `sendBeacon` and `fetch` with `keepalive` refuse more than 64 KiB. */
const BEACON_BYTES = 60_000;
const RETRIES = [1000, 4000, 16000];

export interface Head {
	readonly property?: string;
	readonly visitor?: string;
	readonly url: string;
	readonly pv: string;
}

export interface Answer {
	readonly need?: ReadonlyArray<string>;
	readonly snap?: boolean;
}

export interface Envelope extends Head {
	readonly v: 2;
	readonly seq?: number;
	readonly base?: number;
	readonly startedAt?: number;
	readonly endedAt?: number;
	readonly tape?: WireTape;
	readonly blobs?: Readonly<Record<string, string>>;
	readonly last?: true;
}

export interface Piece {
	readonly tape: Tape;
	readonly base: number;
	readonly startedAt: number;
	readonly endedAt: number;
	/** For a snapshot: where it may be cut into pieces hashed one by one. */
	readonly cuts?: ReadonlyArray<number>;
}

export interface ConnectOptions {
	readonly endpoint: string;
	/** The page view this goes with; undefined while it has no id yet (a prerendered page). */
	readonly head: () => Head | undefined;
	/** Posts a body and reads the answer; `fetch` by default. */
	readonly post?: (endpoint: string, body: string) => Promise<Answer | undefined>;
	/** Sends a body that must outlive the page; `navigator.sendBeacon` by default. */
	readonly beacon?: (endpoint: string, body: string) => boolean;
	/** The server saw a hole: take a new snapshot and send it. */
	readonly onSnap?: () => void;
	/** Sending failed for good: nothing more goes for this page view. */
	readonly onFail?: () => void;
	/** Waits between two tries; `setTimeout` by default. */
	readonly wait?: (ms: number) => Promise<void>;
}

export interface Link {
	send(piece: Piece): Promise<void>;
	/** The page is going away: one beacon with what is left. */
	leave(piece?: Piece): void;
	/** Settles once everything queued has been sent, or given up. */
	idle(): Promise<void>;
	readonly failed: boolean;
}

const encoder = new TextEncoder();

/** 16 bytes of SHA-256, base64url. Null where `crypto.subtle` is missing (a page in `http`). */
export async function hash(text: string): Promise<string | null> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) return null;
	const digest = await subtle.digest("SHA-256", encoder.encode(text));
	let s = "";
	for (const byte of new Uint8Array(digest, 0, 16)) s += String.fromCharCode(byte);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Replaces long strings and, for a snapshot, each piece by its hash. `kept` gets what was replaced. */
export async function pack(
	tape: Tape,
	cuts: ReadonlyArray<number> | undefined,
	kept: Map<string, string>,
): Promise<WireTape> {
	const strings = async (from: number, to: number) => {
		const out: WireTape = [];
		for (let i = from; i < to; i++) {
			const token = tape[i] as Tape[0];
			if (typeof token === "string" && token.length > LONG) {
				const h = await hash(token);
				if (h === null) {
					out.push(token);
					continue;
				}
				kept.set(h, token);
				out.push([h]);
			} else out.push(token);
		}
		return out;
	};
	if (!cuts?.length) return strings(0, tape.length);
	const out = await strings(0, cuts[0] as number);
	for (let c = 0; c < cuts.length; c++) {
		const from = cuts[c] as number;
		const to = c + 1 < cuts.length ? (cuts[c + 1] as number) : tape.length;
		if (to <= from) continue;
		const part = await strings(from, to);
		const text = JSON.stringify(part);
		const h = await hash(text);
		if (h === null) {
			for (const t of part) out.push(t);
			continue;
		}
		kept.set(h, text);
		out.push([h, 1]);
	}
	return out;
}

const bytesOf = (s: string) => encoder.encode(s).length;

export function connect(o: ConnectOptions): Link {
	const post =
		o.post ||
		(async (endpoint: string, body: string) => {
			const W = globalThis as typeof globalThis & { CompressionStream?: typeof CompressionStream };
			let payload: BodyInit = body;
			if (W.CompressionStream)
				payload = await new Response(
					new Blob([body]).stream().pipeThrough(new W.CompressionStream("gzip")),
				).blob();
			const response = await fetch(endpoint, {
				method: "POST",
				body: payload,
				headers: { "content-type": "text/plain" },
			});
			if (!response.ok) throw new Error(`replay: ${response.status}`);
			const text = await response.text();
			return text ? (JSON.parse(text) as Answer) : undefined;
		});
	const beacon =
		o.beacon ||
		((endpoint: string, body: string) => {
			try {
				if (navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }))) return true;
			} catch {}
			try {
				fetch(endpoint, {
					method: "POST",
					body,
					keepalive: true,
					headers: { "content-type": "text/plain" },
				}).catch(() => {});
				return true;
			} catch {
				return false;
			}
		});
	const wait = o.wait || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

	let queue: Promise<void> = Promise.resolve();
	let pv: string | undefined;
	let seq = 0;
	let failed = false;
	/** What was replaced by a hash and not yet known to be on the server. */
	const kept = new Map<string, string>();
	/** What the server asked for and has not received yet. */
	const wanted = new Set<string>();
	/** Pieces waiting for the page view to have an id. */
	let held: Array<Piece> = [];

	function envelope(head: Head, rest: Partial<Envelope>): Envelope {
		return {
			v: 2,
			...(head.property === undefined ? {} : { property: head.property }),
			...(head.visitor === undefined ? {} : { visitor: String(head.visitor).slice(0, 64) }),
			url: head.url,
			pv: head.pv,
			...rest,
		};
	}

	async function attempt(body: string): Promise<Answer | undefined> {
		for (let k = 0; ; k++) {
			try {
				return await post(o.endpoint, body);
			} catch (e) {
				const delay = RETRIES[k];
				if (delay === undefined) throw e;
				await wait(delay);
			}
		}
	}

	interface Entry {
		readonly head: Head;
		readonly piece: Piece;
		readonly seq: number;
		cancelled: boolean;
	}
	/** Queued and not started: a beacon may still take them along. */
	const pending: Array<Entry> = [];

	async function deliver(entry: Entry) {
		const { head, piece } = entry;
		const local = new Map<string, string>();
		const tape = await pack(piece.tape, piece.cuts, local);
		for (const [h, v] of local) kept.set(h, v);
		const body = JSON.stringify(
			envelope(head, {
				seq: entry.seq,
				base: piece.base,
				startedAt: piece.startedAt,
				endedAt: piece.endedAt,
				tape,
			}),
		);
		let answer = await attempt(body);
		// A piece may itself refer to long strings: the server asks again once it read the piece,
		// so what this chunk refers to is kept until the server stops asking.
		for (let round = 0; round < 3; round++) {
			if (answer?.snap) o.onSnap?.();
			const need = (answer?.need || []).filter((h) => kept.has(h));
			if (!need.length) break;
			for (const h of need) wanted.add(h);
			const blobs: Record<string, string> = {};
			for (const h of need) blobs[h] = kept.get(h) as string;
			answer = await attempt(JSON.stringify(envelope(head, { blobs })));
			for (const h of need) {
				wanted.delete(h);
				kept.delete(h);
			}
		}
		for (const h of local.keys()) kept.delete(h);
	}

	/** The head of the page view, numbering again from 0 when it changed. */
	function current(): Head | undefined {
		const head = o.head();
		if (head && head.pv !== pv) {
			pv = head.pv;
			seq = 0;
		}
		return head;
	}

	function send(piece: Piece): Promise<void> {
		if (failed) return queue;
		const head = current();
		if (!head) {
			held.push(piece);
			return queue;
		}
		const pieces = [...held, piece];
		held = [];
		for (const p of pieces) {
			if (!p.tape.length) continue;
			const entry: Entry = { head, piece: p, seq: seq++, cancelled: false };
			pending.push(entry);
			queue = queue
				.then(() => {
					const k = pending.indexOf(entry);
					if (k >= 0) pending.splice(k, 1);
					if (failed || entry.cancelled) return;
					return deliver(entry);
				})
				.catch(() => {
					failed = true;
					o.onFail?.();
				});
		}
		return queue;
	}

	function leave(piece?: Piece) {
		if (failed) return;
		const head = current();
		if (!head) return;
		// What is queued and not started goes with the beacon, under the first number it held.
		const queued = pending.filter((e) => e.head.pv === head.pv && !e.cancelled);
		const pieces = [
			...queued.map((e) => e.piece),
			...held,
			...(piece && piece.tape.length ? [piece] : []),
		];
		held = [];
		// No time to hash: the tape goes as it is, then what the server still lacks, while it fits.
		const tape: Tape = [];
		for (const p of pieces) for (const t of p.tape) tape.push(t);
		const first = pieces[0];
		const lastPiece = pieces[pieces.length - 1];
		const empty = JSON.stringify(envelope(head, { last: true }));
		let body = empty;
		if (first && lastPiece) {
			const number = queued[0] ? queued[0].seq : seq;
			const withTape = JSON.stringify(
				envelope(head, {
					seq: number,
					base: first.base,
					startedAt: first.startedAt,
					endedAt: lastPiece.endedAt,
					tape,
					last: true,
				}),
			);
			if (bytesOf(withTape) <= BEACON_BYTES) {
				body = withTape;
				for (const e of queued) e.cancelled = true;
				seq = number + 1;
			}
		}
		const blobs: Record<string, string> = {};
		let size = bytesOf(body);
		const order = [...wanted, ...[...kept.keys()].filter((h) => !wanted.has(h))];
		for (const h of order) {
			const v = kept.get(h);
			if (v === undefined) continue;
			const extra = bytesOf(JSON.stringify(h)) + bytesOf(JSON.stringify(v)) + 2;
			if (size + extra + 12 > BEACON_BYTES) continue;
			blobs[h] = v;
			size += extra;
		}
		if (Object.keys(blobs).length) body = JSON.stringify({ ...(JSON.parse(body) as Envelope), blobs });
		if (body === empty) return;
		beacon(o.endpoint, body);
	}

	return {
		send,
		leave,
		idle: () => queue,
		get failed() {
			return failed;
		},
	};
}
