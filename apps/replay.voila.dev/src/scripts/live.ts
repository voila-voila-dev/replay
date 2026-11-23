// Live demos: the demo checkout, in an iframe, is recorded by the library of this repo and played
// back next to it, in a sandboxed copy, a fraction of a second behind. Every demo on the site is
// one `[data-live]` block (see Live.astro); its data attributes pick the app recorded, the mask,
// the modules and the controls shown.
import { type Chunk, length, Op, type Tape } from "@voila.dev/replay/format";
import { canvas, cssom, shadow } from "@voila.dev/replay/modules";
import { createPlayer, type Player } from "@voila.dev/replay/play";
import { type Mask, type Module, type Recorder, record } from "@voila.dev/replay/record";

/** The demo checkout is laid out at this width, unless a demo says otherwise (data-width); the demos scale the page, and its copy, to fit. */
const PAGE_WIDTH = 560;
const DRAIN_MS = 250;
const LAG_MAX_MS = 600;
const IDLE_RESUME_MS = 6000;
const SNAP_AFTER_HOLE_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MODULES: Record<string, () => Module> = { cssom, shadow, canvas: () => canvas(250, 0.6) };

type Step =
	| { kind: "click"; on: string }
	| { kind: "type"; into: string; text: string }
	| { kind: "clear"; into: string }
	| { kind: "move"; to: string }
	| { kind: "draw"; row: number }
	| { kind: "wipe" }
	| { kind: "wait"; ms: number };

/** What the autopilot does in each demo app (src/pages/demo), in a loop, until someone takes over. */
const SCRIPTS: Record<string, Step[]> = {
	shop: [
		{ kind: "wait", ms: 600 },
		{ kind: "click", on: '[data-q="1"]' },
		{ kind: "wait", ms: 250 },
		{ kind: "click", on: '[data-q="1"]' },
		{ kind: "type", into: 'input[name="email"]', text: "ada@example.com" },
		{ kind: "type", into: 'input[name="card"]', text: "4242 4242 4242 4242" },
		{ kind: "click", on: ".pay" },
		{ kind: "wait", ms: 1800 },
		{ kind: "click", on: '[data-q="-1"]' },
		{ kind: "click", on: '[data-q="-1"]' },
		{ kind: "clear", into: 'input[name="email"]' },
		{ kind: "clear", into: 'input[name="card"]' },
		{ kind: "wait", ms: 900 },
	],
	todo: [
		{ kind: "wait", ms: 500 },
		{ kind: "type", into: "#new", text: "Buy bread" },
		{ kind: "click", on: "#add button" },
		{ kind: "type", into: "#new", text: "Call the bank" },
		{ kind: "click", on: "#add button" },
		{ kind: "click", on: "#list li:nth-child(2) input" },
		{ kind: "wait", ms: 700 },
		{ kind: "click", on: "#list li:nth-child(1) button" },
		{ kind: "wait", ms: 900 },
	],
	signup: [
		{ kind: "wait", ms: 500 },
		{ kind: "type", into: 'input[name="name"]', text: "Ada Lovelace" },
		{ kind: "type", into: 'input[name="email"]', text: "ada@example.com" },
		{ kind: "type", into: 'input[name="password"]', text: "correct horse" },
		{ kind: "type", into: 'input[name="card"]', text: "4242 4242 4242 4242" },
		{ kind: "type", into: 'input[name="referral"]', text: "FRIEND10" },
		{ kind: "click", on: "#go" },
		{ kind: "wait", ms: 1600 },
		{ kind: "clear", into: 'input[name="name"]' },
		{ kind: "clear", into: 'input[name="email"]' },
		{ kind: "clear", into: 'input[name="password"]' },
		{ kind: "clear", into: 'input[name="card"]' },
		{ kind: "clear", into: 'input[name="referral"]' },
		{ kind: "wait", ms: 700 },
	],
	chat: [
		{ kind: "wait", ms: 600 },
		{ kind: "type", into: "#text", text: "Where is my order?" },
		{ kind: "click", on: "#send button" },
		{ kind: "wait", ms: 2000 },
		{ kind: "type", into: "#text", text: "Great, thanks!" },
		{ kind: "click", on: "#send button" },
		{ kind: "wait", ms: 2200 },
	],
	dashboard: [
		{ kind: "move", to: "#orders" },
		{ kind: "wait", ms: 1500 },
		{ kind: "move", to: "#revenue" },
		{ kind: "wait", ms: 1500 },
		{ kind: "move", to: ".bars i:nth-child(10)" },
		{ kind: "wait", ms: 1500 },
	],
	draw: [
		{ kind: "click", on: '[data-color="#2633ff"]' },
		{ kind: "draw", row: 0.3 },
		{ kind: "click", on: '[data-color="#e5484d"]' },
		{ kind: "draw", row: 0.55 },
		{ kind: "click", on: '[data-color="#1fbf75"]' },
		{ kind: "draw", row: 0.8 },
		{ kind: "wait", ms: 1500 },
		{ kind: "wipe" },
	],
};

/** A fake pointer over the source page: it sends real pointer events, which the recorder writes. */
class Pilot {
	x = 60;
	y = 60;
	stopped = false;
	/** Off screen, the pilot waits: nobody watches, and nothing it does should reach the page. */
	visible = true;
	private takenAt = 0;
	constructor(
		private readonly frame: HTMLIFrameElement,
		private readonly dot: HTMLElement,
		private readonly steps: Step[],
	) {
		const doc = frame.contentDocument as Document;
		// A real hand on the page: the pilot steps aside, and comes back once the page is idle.
		for (const type of ["pointerdown", "keydown", "wheel"])
			doc.addEventListener(type, (e) => {
				if (e.isTrusted) this.takenAt = performance.now();
			});
		doc.addEventListener("pointermove", (e) => {
			if (e.isTrusted && e.pointerType === "mouse" && Math.abs(e.clientX - this.x) + Math.abs(e.clientY - this.y) > 4)
				this.takenAt = performance.now();
		});
	}

	get taken() {
		return performance.now() - this.takenAt < IDLE_RESUME_MS;
	}

	private get doc() {
		return this.frame.contentDocument as Document;
	}

	private send(type: string, target: Element) {
		const Ctor = (this.frame.contentWindow as Window & typeof globalThis).PointerEvent;
		target.dispatchEvent(new Ctor(type, { bubbles: true, clientX: this.x, clientY: this.y, pointerType: "mouse" }));
	}

	private show() {
		this.dot.style.opacity = this.taken ? "0" : "1";
		this.dot.style.transform = `translate(${this.x}px,${this.y}px)`;
	}

	private async glide(tx: number, ty: number, steps = 14, ms = 28, send = "pointermove") {
		const fx = this.x;
		const fy = this.y;
		for (let i = 1; i <= steps && !this.taken; i++) {
			const k = i / steps;
			const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
			this.x = fx + (tx - fx) * e;
			this.y = fy + (ty - fy) * e;
			this.show();
			this.send(send, this.doc.elementFromPoint(this.x, this.y) || this.doc.body);
			await sleep(ms);
		}
	}

	async move(sel: string) {
		const el = this.doc.querySelector(sel);
		if (!el || !(el as HTMLElement).offsetParent) return false;
		const r = el.getBoundingClientRect();
		await this.glide(r.left + r.width / 2, r.top + r.height / 2);
		return true;
	}

	async click(sel: string) {
		if (!(await this.move(sel)) || this.taken) return;
		const el = this.doc.querySelector(sel) as HTMLElement;
		this.send("pointerdown", el);
		await sleep(70);
		this.send("pointerup", el);
		el.click();
		await sleep(160);
	}

	async type(sel: string, text: string) {
		await this.click(sel);
		const el = this.doc.querySelector(sel) as HTMLInputElement | null;
		if (!el || !el.offsetParent || this.taken) return;
		// Focus inside a frame scrolls the page around it to show the field: never move the reader's page.
		el.focus({ preventScroll: true });
		for (const ch of text) {
			if (this.taken) return;
			el.value += ch;
			el.dispatchEvent(new Event("input", { bubbles: true }));
			await sleep(45 + Math.random() * 40);
		}
	}

	clear(sel: string) {
		const el = this.doc.querySelector(sel) as HTMLInputElement | null;
		if (!el) return;
		el.value = "";
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.blur();
	}

	/** A wave across the canvas at `row` (0 top, 1 bottom), drawn with real pointer events. */
	async draw(row: number) {
		const pad = this.doc.querySelector("canvas");
		if (!pad || !pad.offsetParent) return;
		const r = pad.getBoundingClientRect();
		const y0 = r.top + r.height * row;
		await this.glide(r.left + 30, y0);
		this.send("pointerdown", pad);
		const points = 50;
		for (let i = 1; i <= points && !this.taken; i++) {
			const t = i / points;
			await this.glide(r.left + 30 + t * (r.width - 60), y0 - r.height * 0.09 * Math.sin(t * Math.PI * 4), 1, 16);
		}
		this.send("pointerup", pad);
		await sleep(200);
	}

	wipe() {
		(this.frame.contentWindow as Window & { clearSignature?: () => void }).clearSignature?.();
	}

	async run() {
		while (!this.stopped) {
			for (const s of this.steps) {
				while ((this.taken || !this.visible) && !this.stopped) {
					this.show();
					await sleep(400);
				}
				if (this.stopped) return;
				if (s.kind === "click") await this.click(s.on);
				else if (s.kind === "type") await this.type(s.into, s.text);
				else if (s.kind === "clear") this.clear(s.into);
				else if (s.kind === "move") await this.move(s.to);
				else if (s.kind === "draw") await this.draw(s.row);
				else if (s.kind === "wipe") this.wipe();
				else await sleep(s.ms);
			}
		}
	}
}

const NAMES: Record<number, string> = Object.fromEntries(
	Object.entries(Op)
		.filter(([, v]) => typeof v === "number")
		.map(([k, v]) => [v, k]),
);

/** One line per op, for the tape panel. Long strings are cut. */
function lines(tape: Tape): string[] {
	const out: string[] = [];
	for (let i = 0; i < tape.length; ) {
		const n = length(tape, i);
		if (n < 0) break;
		const op = tape[i] as number;
		const args = tape
			.slice(i + 1, i + n)
			.map((t) => (typeof t === "string" ? JSON.stringify(t.length > 28 ? `${t.slice(0, 26)}…` : t) : String(t)));
		out.push(`${NAMES[op] ?? op} ${args.slice(0, 6).join(" ")}${args.length > 6 ? " …" : ""}`);
		i += n;
	}
	return out;
}

async function gzipped(text: string): Promise<number | null> {
	const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
	if (!CS) return null;
	const stream = new Blob([text]).stream().pipeThrough(new CS("gzip"));
	return (await new Response(stream).arrayBuffer()).byteLength;
}

const kb = (b: number) => (b < 1000 ? `${b} B` : `${(b / 1000).toFixed(1)} KB`);
const clock = (ms: number) => {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Scales a box of the page's natural size into its pane, centred: nothing ever spills. */
function place(box: HTMLElement, pane: HTMLElement, width: number, height: number) {
	const k = Math.min(pane.clientWidth / width, pane.clientHeight / height);
	const x = (pane.clientWidth - width * k) / 2;
	const y = (pane.clientHeight - height * k) / 2;
	box.style.transformOrigin = "0 0";
	box.style.transform = `translate(${x}px,${y}px) scale(${k})`;
}

function mount(box: HTMLElement) {
	const pane = box.querySelector<HTMLElement>(".src .frame");
	const scaler = box.querySelector<HTMLElement>(".src .scaler");
	const frame = box.querySelector<HTMLIFrameElement>(".src iframe");
	const stage = box.querySelector<HTMLElement>(".dst .stage");
	const dot = box.querySelector<HTMLElement>(".src .ghost");
	if (!pane || !scaler || !frame || !stage || !dot) return;
	const width = Number(box.dataset.width || PAGE_WIDTH);
	const height = Number(box.dataset.height || 400);
	const app = box.dataset.app || "shop";
	const modules = (box.dataset.modules || "cssom").split(",").filter((m) => m in MODULES);
	const maskSelect = box.querySelector<HTMLSelectElement>("[data-mask-select]");
	const dropButton = box.querySelector<HTMLButtonElement>("[data-drop]");
	const seek = box.querySelector<HTMLInputElement>("[data-seek]");
	const gapsView = box.querySelector<HTMLElement>("[data-gaps]");
	const timeView = box.querySelector<HTMLElement>("[data-time]");
	const playButton = box.querySelector<HTMLButtonElement>("[data-play]");
	const speedSelect = box.querySelector<HTMLSelectElement>("[data-speed]");
	const idleBox = box.querySelector<HTMLInputElement>("[data-skip-idle]");
	const tapeView = box.querySelector<HTMLElement>("[data-tape]");
	const stat = (name: string) => box.querySelector<HTMLElement>(`[data-stat="${name}"]`);
	const autopilot = box.dataset.autopilot !== "off";

	frame.style.width = `${width}px`;
	frame.style.height = `${height}px`;
	const layout = () => {
		place(scaler, pane, width, height);
		const inner = stage.firstElementChild as HTMLElement | null;
		if (inner) place(inner, stage, width, height);
	};
	new ResizeObserver(layout).observe(pane);
	new ResizeObserver(layout).observe(stage);
	layout();

	let rec: Recorder | null = null;
	let player: Player | null = null;
	let pilot: Pilot | null = null;
	let timer = 0;
	let seq = 0;
	let raw = 0;
	let ops = 0;
	let dropNext = false;
	let holes = 0;
	let following = true;
	const all: Chunk[] = [];
	const log: string[] = [];

	const push = (chunk: Chunk, kept: boolean) => {
		raw += JSON.stringify(chunk.tape).length;
		const these = lines(chunk.tape as Tape);
		ops += these.length;
		if (tapeView) {
			log.push(...these.map((l) => (kept ? l : `✕ ${l}`)));
			log.splice(0, Math.max(0, log.length - 60));
			tapeView.textContent = log.join("\n");
			tapeView.scrollTop = tapeView.scrollHeight;
		}
		if (kept) all.push(chunk);
	};

	const stats = async () => {
		stat("raw")?.replaceChildren(kb(raw));
		stat("ops")?.replaceChildren(ops.toLocaleString("en-US"));
		stat("holes")?.replaceChildren(String(holes));
		const g = await gzipped(JSON.stringify(all.map((c) => c.tape)));
		if (g != null) stat("gzip")?.replaceChildren(kb(g));
	};

	/** Marks the holes on the seek bar, where the player says they are. */
	const drawGaps = () => {
		if (!gapsView || !player || !player.duration) return;
		gapsView.replaceChildren(
			...player.gaps.map((g) => {
				const mark = document.createElement("i");
				mark.style.left = `${(g.at / player!.duration) * 100}%`;
				mark.style.width = `${Math.max(0.6, (g.ms / player!.duration) * 100)}%`;
				return mark;
			}),
		);
	};

	// The player pauses at the end of what it has; waiting for the next chunk would add up.
	// Past LAG_MAX behind, it jumps to DRAIN_MS behind the live page.
	const follow = () => {
		if (!player || !following) return;
		if (player.duration - player.time > LAG_MAX_MS) player.seek(player.duration - DRAIN_MS);
		if (!player.playing) player.play();
	};

	const setFollowing = (on: boolean) => {
		following = on;
		box.classList.toggle("scrubbing", !on);
		if (playButton) playButton.textContent = player?.playing || on ? "Pause" : "Play";
	};

	const start = () => {
		const win = frame.contentWindow as Window;
		clearInterval(timer);
		rec?.stop();
		player?.destroy();
		all.length = 0;
		log.length = 0;
		raw = ops = holes = seq = 0;
		const mask = (maskSelect?.value || box.dataset.mask || "inputs") as Mask;
		rec = record(win, { mask, modules: modules.map((m) => MODULES[m]()) });
		if (!rec) {
			box.classList.add("unsupported");
			return;
		}
		const snap = rec.snap();
		const first: Chunk = { base: snap.base, seq: seq++, tape: snap.tape };
		push(first, true);
		player = createPlayer({
			root: stage,
			chunks: [first],
			skipIdle: idleBox?.checked ?? false,
			speed: Number(speedSelect?.value || 1),
			// The copy loads pictures from here only, and from what the demo allows (the playground: Wikimedia).
			sources: [location.origin, ...(box.dataset.sources || "").split(" ").filter(Boolean)],
		});
		player.on("size", layout);
		player.on("time", (t) => {
			if (!player) return;
			if (seek) {
				seek.max = String(Math.round(player.duration));
				seek.value = String(Math.round(t));
			}
			timeView?.replaceChildren(`${clock(t)} / ${clock(player.duration)}`);
		});
		layout();
		timer = window.setInterval(() => {
			if (!rec || !player) return;
			const d = rec.drain();
			if (!d.tape.length) return;
			const chunk: Chunk = { base: d.base, seq: seq++, tape: d.tape };
			// The demo of holes: this chunk never reaches the player. It marks the hole, and waits
			// for the next snapshot rather than play a page that is no longer the one recorded.
			if (dropNext) {
				dropNext = false;
				holes++;
				push(chunk, false);
				box.classList.add("holed");
				setTimeout(() => {
					if (!rec || !player) return;
					const s = rec.snap();
					const again: Chunk = { base: s.base, seq: seq++, tape: s.tape };
					push(again, true);
					player.append([again]);
					box.classList.remove("holed");
					drawGaps();
					follow();
				}, SNAP_AFTER_HOLE_MS);
				stats();
				return;
			}
			push(chunk, true);
			player.append([chunk]);
			drawGaps();
			follow();
			stats();
		}, DRAIN_MS);
		stats();
	};

	const boot = () => {
		// A page of another origin (a link that left the site) cannot be read, so not recorded.
		try {
			if (!frame.contentDocument) return;
		} catch {
			return;
		}
		start();
		if (autopilot && !pilot) {
			pilot = new Pilot(frame, dot, SCRIPTS[app] ?? []);
			pilot.visible = onScreen;
			pilot.run();
		}
	};

	let onScreen = true;
	new IntersectionObserver(([entry]) => {
		onScreen = !!entry?.isIntersecting;
		if (pilot) pilot.visible = onScreen;
	}).observe(box);

	maskSelect?.addEventListener("change", () => frame.contentWindow?.location.reload());
	dropButton?.addEventListener("click", () => {
		dropNext = true;
	});
	seek?.addEventListener("input", () => {
		setFollowing(false);
		player?.pause();
		player?.seek(Number(seek.value));
		if (playButton) playButton.textContent = "Play";
	});
	playButton?.addEventListener("click", () => {
		if (!player) return;
		if (player.playing) {
			player.pause();
			setFollowing(false);
			playButton.textContent = "Play";
		} else {
			player.play();
			playButton.textContent = "Pause";
		}
	});
	speedSelect?.addEventListener("change", () => player?.setSpeed(Number(speedSelect.value)));
	idleBox?.addEventListener("change", () => player?.setSkipIdle(idleBox.checked));
	box.querySelector("[data-live-follow]")?.addEventListener("click", () => {
		if (!player) return;
		setFollowing(true);
		player.setSpeed(1);
		if (speedSelect) speedSelect.value = "1";
		player.seek(player.duration);
		player.play();
	});

	// A new mask reloads the page: a new page view, a new recorder, a new copy.
	frame.addEventListener("load", () => {
		if (pilot) pilot.stopped = true;
		pilot = null;
		boot();
	});
	boot();
}

// Started once visible: an iframe offscreen costs nothing until it is seen.
const io = new IntersectionObserver(
	(entries) => {
		for (const e of entries)
			if (e.isIntersecting) {
				io.unobserve(e.target);
				const box = e.target as HTMLElement;
				const frame = box.querySelector<HTMLIFrameElement>(".src iframe");
				if (!frame) continue;
				frame.addEventListener("load", () => mount(box), { once: true });
				frame.src = frame.dataset.src || "/demo/shop";
			}
	},
	{ rootMargin: "200px" },
);
for (const box of document.querySelectorAll<HTMLElement>("[data-live]")) io.observe(box);
