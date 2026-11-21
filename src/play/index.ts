// The player: a mirror in a sandboxed iframe, a clock, and what a viewer needs around them
// (speed, idle skipping, seeking back, the visitor's pointer). A chunk whose first node number
// does not follow the last one is a hole: the player says so and resumes at the next snapshot,
// rather than replaying a page that is no longer the one recorded.
import { type Chunk, join, length, Op } from "../format/index";
import { type Checkpoint, fingerprint, type Mirror, mirror } from "./mirror";

export { join } from "../format/index";
export { fingerprint, mirror } from "./mirror";
export type { Checkpoint, Mirror, MirrorHooks } from "./mirror";

export interface PlayerOptions {
	readonly root: HTMLElement;
	readonly chunks: ReadonlyArray<Chunk>;
	readonly speed?: number;
	readonly skipIdle?: boolean;
	/** Ms of recording between two checkpoints; a seek starts from the nearest one. */
	readonly every?: number;
	/** Where to load a picture or a font from, given its address on the page (see `MirrorHooks`). */
	readonly asset?: (url: string) => string;
}

export interface Gap {
	/** Ms from the start of the recording. */
	readonly at: number;
	readonly ms: number;
}

export interface Print {
	readonly at: number;
	readonly ok: boolean;
	readonly detail?: string;
}

type Events = {
	time: number;
	size: { width: number; height: number };
	end: undefined;
	print: Print;
	play: undefined;
	pause: undefined;
};

export interface Player {
	readonly iframe: HTMLIFrameElement;
	readonly document: Document;
	/** Ms of recording. */
	readonly duration: number;
	/** Ms from the start of the recording. */
	readonly time: number;
	readonly size: { width: number; height: number };
	readonly playing: boolean;
	readonly gaps: ReadonlyArray<Gap>;
	readonly prints: ReadonlyArray<Print>;
	play(): void;
	pause(): void;
	seek(ms: number): void;
	setSpeed(speed: number): void;
	setSkipIdle(on: boolean): void;
	/** Adds chunks that came after the ones given at first. */
	append(chunks: ReadonlyArray<Chunk>): void;
	on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void;
	destroy(): void;
}

/** Idle stretches longer than this are skipped down to a second. */
const IDLE_MS = 5000;
/** Past this many checkpoints, one in two goes and they come twice as far apart. */
const MAX_CHECKPOINTS = 64;

export function createPlayer(options: PlayerOptions): Player {
	const { root } = options;
	let speed = options.speed ?? 1;
	let skipIdle = options.skipIdle ?? true;
	let every = Math.max(1, options.every ?? 10_000);

	const stage = root.ownerDocument.createElement("div");
	stage.style.cssText = "position:relative;overflow:hidden;transform-origin:0 0";
	const iframe = root.ownerDocument.createElement("iframe");
	// No scripts, no forms, no navigation: the copy only shows.
	iframe.setAttribute("sandbox", "allow-same-origin");
	iframe.setAttribute("referrerpolicy", "no-referrer");
	iframe.style.cssText = "border:0;display:block;background:#fff";
	const cursor = root.ownerDocument.createElement("div");
	cursor.style.cssText =
		"position:absolute;left:0;top:0;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#e5484d;box-shadow:0 0 0 3px #e5484d55;pointer-events:none;transition:transform 60ms linear;display:none";
	stage.append(iframe, cursor);
	root.append(stage);
	const doc = iframe.contentDocument as Document;

	const listeners: { [K in keyof Events]?: Set<(p: Events[K]) => void> } = {};
	function emit<K extends keyof Events>(event: K, payload: Events[K]) {
		const set = listeners[event] as Set<(p: Events[K]) => void> | undefined;
		set?.forEach((h) => {
			try {
				h(payload);
			} catch {}
		});
	}

	let size = { width: 1280, height: 720 };
	const prints: Array<Print> = [];
	let m: Mirror = make();
	function make() {
		return mirror(doc, {
			asset: options.asset,
			pointer(x, y) {
				cursor.style.display = "block";
				cursor.style.transform = `translate(${x}px,${y}px)`;
			},
			tap(kind) {
				if (kind === 1) cursor.style.background = "#30a46c";
				else cursor.style.background = "#e5484d";
			},
			size(width, height) {
				size = { width, height };
				iframe.style.width = stage.style.width = `${width}px`;
				iframe.style.height = stage.style.height = `${height}px`;
				emit("size", size);
			},
			print(ok, at, detail) {
				const p = { ok, at: at - start, detail };
				if (!prints.some((q) => q.at === p.at)) prints.push(p);
				emit("print", p);
			},
		});
	}

	const joined = join(options.chunks);
	const tape = joined.tape;
	let state = joined.state;
	const gapsAt: Array<{ index: number; ms: number }> = [...joined.gaps];

	// Where each snapshot starts, and the recorded time there: seeking back starts from one.
	let metas: Array<{ index: number; time: number }> = [];
	let start = 0;
	let end = 0;
	function index() {
		metas = [];
		let now = 0;
		for (let i = 0; i < tape.length; ) {
			const n = length(tape, i);
			if (n < 0) break;
			const op = tape[i];
			if (op === Op.META) {
				now = tape[i + 3] as number;
				if (!metas.length) start = now;
				metas.push({ index: i, time: now });
			} else if (op === Op.TICK) now += tape[i + 1] as number;
			i += n;
		}
		end = now;
	}
	index();

	let at = 0; // where the mirror stopped in the tape
	let clock = 0; // ms from the start, as shown
	let playing = false;
	let frame = 0;
	let lastFrame = 0;

	// Taken on the way, at the first rest past each step of `every` ms; never ahead of the tape run.
	const checkpoints: Array<{ index: number; time: number; cp: Checkpoint }> = [];
	const after = (t: number) => start + (Math.floor((t - start) / every) + 1) * every;

	function keep() {
		if (!m.rest || checkpoints.some((c) => c.index === at)) return;
		const c = { index: at, time: m.time, cp: m.save() };
		let k = checkpoints.length;
		while (k > 0 && (checkpoints[k - 1] as { index: number }).index > at) k--;
		checkpoints.splice(k, 0, c);
		if (checkpoints.length > MAX_CHECKPOINTS) {
			every *= 2;
			for (let i = checkpoints.length - 1; i >= 0; i -= 2) checkpoints.splice(i, 1);
		}
	}

	function runTo(ms: number) {
		const until = start + ms;
		for (let step = after(Math.max(m.time, start)); step < until; ) {
			at = m.run(tape, at, step);
			if (at >= tape.length || tape[at] !== Op.TICK) break;
			keep();
			step = after(m.time + (tape[at + 1] as number));
		}
		at = m.run(tape, at, until);
	}

	function seek(ms: number) {
		ms = Math.max(0, Math.min(ms, end - start));
		// The latest place to start from that is not past `ms`: a snapshot or a checkpoint.
		let from: { index: number; cp?: Checkpoint } | undefined;
		for (const x of metas) if (x.time - start <= ms && (!from || x.index > from.index)) from = x;
		for (const x of checkpoints) if (x.time - start <= ms && (!from || x.index > from.index)) from = x;
		if (from && (ms < clock || at === 0 || from.index > at)) {
			m = make();
			if (from.cp) m.restore(from.cp);
			at = from.index;
		} else if (!from && (ms < clock || at === 0)) return;
		clock = ms;
		runTo(ms);
		emit("time", clock);
	}

	function loop(t: number) {
		if (!playing) return;
		const dt = lastFrame ? Math.min(t - lastFrame, 250) : 0;
		lastFrame = t;
		let next = clock + dt * speed;
		if (skipIdle && at < tape.length && tape[at] === Op.TICK) {
			const gap = tape[at + 1] as number;
			if (gap > IDLE_MS) next = Math.max(next, m.time - start + gap - 1000);
		}
		clock = Math.min(next, end - start);
		runTo(clock);
		emit("time", clock);
		if (clock >= end - start) {
			playing = false;
			emit("end", undefined);
			return;
		}
		frame = requestAnimationFrame(loop);
	}

	seek(0);

	return {
		iframe,
		document: doc,
		get duration() {
			return end - start;
		},
		get time() {
			return clock;
		},
		get size() {
			return size;
		},
		get playing() {
			return playing;
		},
		get gaps() {
			const out: Array<Gap> = [];
			let now = 0;
			let g = 0;
			for (let i = 0; i < tape.length && g < gapsAt.length; ) {
				while (g < gapsAt.length && (gapsAt[g] as { index: number }).index <= i) {
					out.push({ at: Math.max(0, now - start), ms: (gapsAt[g] as { ms: number }).ms });
					g++;
				}
				const n = length(tape, i);
				if (n < 0) break;
				if (tape[i] === Op.META) now = tape[i + 3] as number;
				else if (tape[i] === Op.TICK) now += tape[i + 1] as number;
				i += n;
			}
			for (; g < gapsAt.length; g++)
				out.push({ at: Math.max(0, now - start), ms: (gapsAt[g] as { ms: number }).ms });
			return out;
		},
		prints,
		play() {
			if (playing) return;
			if (clock >= end - start) seek(0);
			playing = true;
			lastFrame = 0;
			emit("play", undefined);
			frame = requestAnimationFrame(loop);
		},
		pause() {
			playing = false;
			cancelAnimationFrame(frame);
			emit("pause", undefined);
		},
		seek,
		setSpeed(s) {
			speed = s;
		},
		setSkipIdle(on) {
			skipIdle = on;
		},
		append(chunks) {
			const more = join(chunks, tape, state);
			state = more.state;
			gapsAt.push(...more.gaps);
			index();
			runTo(clock);
		},
		on(event, handler) {
			let set = listeners[event] as Set<typeof handler> | undefined;
			if (!set) listeners[event] = set = new Set() as never;
			set.add(handler);
			return () => set?.delete(handler);
		},
		destroy() {
			playing = false;
			cancelAnimationFrame(frame);
			stage.remove();
		},
	};
}

