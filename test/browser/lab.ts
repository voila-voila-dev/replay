// The lab page's side of the browser tests: loads a case in the site frame, records it,
// replays it in the replay frame, and judges the copy with the oracle.
import { type Chunk, resolve, validate } from "../../src/format/index";
import { createPlayer, mirror } from "../../src/play/index";
import type { Recorder } from "../../src/record/index";
import { pack } from "../../src/send/index";
import { CASES, type Case } from "../../src/testing/cases";
import { compare } from "../../src/testing/oracle";
import { FUZZ_PAGE, leaks, mutator, seeded } from "../../src/testing/index";

type Win = Window & typeof globalThis;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Current {
	c: Case;
	win: Win;
	rec: Recorder;
	pieces: Array<Chunk & { cuts?: ReadonlyArray<number> }>;
	errors: Array<string>;
}
let current: Current | undefined;

/** Loads a page into the site frame as a served page, the way a visitor gets it. */
async function loadSite(name: string): Promise<Win> {
	const f = document.getElementById("site") as HTMLIFrameElement;
	await new Promise((ok) => {
		f.onload = ok;
		f.src = `/site.html?n=${encodeURIComponent(name)}&r=${Math.random()}`;
	});
	return f.contentWindow as Win;
}

type Site = Win & {
	ReplayRecorder?: { start(w: Window, o: object): Recorder | null };
};
let recorderCode: string | undefined;
/** The recorder runs in the site's own realm, as on a visitor's page. */
async function recorderIn(win: Site, o: object): Promise<Recorder> {
	recorderCode ||= await (await fetch("/build/recorder.js")).text();
	if (!win.ReplayRecorder) win.eval(recorderCode);
	const rec = win.ReplayRecorder?.start(win, o);
	if (!rec) throw new Error("recorder not supported");
	return rec;
}
/** Tapes cross realms as JSON, like on the wire. */
const own = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const inSite = (win: Win, fn: unknown) => win.eval(`(${String(fn)})`) as (...a: Array<unknown>) => unknown;

async function start(name: string) {
	const c = CASES.find((x) => x.name === name);
	if (!c) throw new Error(`no case ${name}`);
	const win = await loadSite(name);
	const doc = win.document;
	await sleep(30);
	const errors: Array<string> = [];
	win.addEventListener("error", (e) => errors.push(String(e.message)));
	const wait = (ms: number) => new win.Promise<void>((r) => win.setTimeout(r, ms));
	if (c.before) await inSite(win, c.before)(doc, win, wait);
	await sleep(20);
	const rec = await recorderIn(win, { mask: c.o?.mask || "inputs", all: true, printEvery: 1 });
	const snap = own(rec.snap());
	const pieces: Current["pieces"] = [{ base: snap.base, tape: snap.tape, cuts: snap.cuts }];
	try {
		if (c.run) await inSite(win, c.run)(doc, win, wait);
	} catch (e) {
		errors.push(`run: ${e}`);
	}
	current = { c, win, rec, pieces, errors };
	return { keys: c.keys || [], clicks: c.clicks || [], select: c.select || [] };
}

async function end() {
	if (!current) throw new Error("no case started");
	const { c, win, rec, pieces, errors } = current;
	const wait = (ms: number) => new win.Promise<void>((r) => win.setTimeout(r, ms));
	try {
		if (c.after) await inSite(win, c.after)(win.document, win, wait);
	} catch (e) {
		errors.push(`after: ${e}`);
	}
	await sleep(250);
	const d1 = own(rec.drain());
	pieces.push({ base: d1.base, tape: d1.tape });
	rec.stop();

	// What the server gets: each tape packed with its hashes, and the hashed contents.
	const sent: Array<string> = [];
	const chunks: Array<Chunk> = [];
	for (const p of pieces) {
		const kept = new Map<string, string>();
		const wire = await pack(p.tape, p.cuts, kept);
		sent.push(JSON.stringify(wire), ...kept.values());
		const back = resolve(wire, (h) => kept.get(h));
		if (JSON.stringify(back) !== JSON.stringify(p.tape)) errors.push("pack/resolve: tape changed");
		const bad = validate(back, back[0] === 96 ? undefined : p.base);
		if (bad) errors.push(`validate: ${bad.reason} at ${bad.at}`);
		chunks.push({ base: p.base, tape: back });
	}

	const host = document.getElementById("replay") as HTMLElement;
	host.replaceChildren();
	// A checkpoint at each tick, so a short case still seeks back through one.
	const player = createPlayer({ root: host, chunks, every: 1 });
	player.seek(player.duration);
	await sleep(50);
	const judge = (when: string) => {
		try {
			return compare(win.document, player.document, { mask: c.o?.mask || "inputs" }).map((d) => ({ ...d, what: `${when}${d.what}` }));
		} catch (e) {
			return [{ path: "-", what: `${when}oracle: ${e}` }];
		}
	};
	let diffs: Array<unknown> = judge("");
	if (!diffs.length) {
		// Back to the middle, then to the end: both seeks start from a checkpoint.
		player.seek(player.duration / 2);
		player.seek(player.duration);
		await sleep(50);
		diffs = judge("après reprise : ");
	}
	const prints = player.prints;
	return {
		diffs,
		errors,
		leaks: leaks(sent, c.secrets || []),
		prints: { total: prints.length, bad: prints.filter((p) => !p.ok).length },
		gaps: player.gaps.length,
		tapes: diffs.length ? chunks.map((c) => JSON.stringify(c.tape).slice(0, 1500)) : undefined,
		bytes: sent.reduce((n, s) => n + s.length, 0),
	};
}

/**
 * Random rounds of mutations; after each, the copy must be the page. With `drop`, one chunk is
 * lost on the way: the player must report the hole and stop there, and be right again once a new
 * snapshot comes.
 */
async function fuzz(
	seed: number,
	rounds: number,
	o: { drop?: boolean; mask?: "inputs" | "text" | "none"; slice?: number; rate?: number; resume?: boolean } = {},
) {
	const win = await loadSite("__fuzz__");
	const doc = win.document;
	await sleep(30);
	const mask = o.mask || "inputs";
	const rec = await recorderIn(win, { mask, printEvery: 1, slice: o.slice, rate: o.rate });
	const drain = () => own(rec.drain());
	const host = document.getElementById("replay") as HTMLElement;
	host.replaceChildren();
	const wire = async (p: { base: number; tape: Chunk["tape"]; cuts?: ReadonlyArray<number> }) => {
		const kept = new Map<string, string>();
		const back = resolve(await pack(p.tape, p.cuts, kept), (h) => kept.get(h));
		return { base: p.base, seq: seq++, tape: back };
	};
	let seq = 0;
	const snap = own(rec.snap());
	const player = createPlayer({ root: host, chunks: [await wire(snap)], every: o.resume ? 1 : undefined });
	const gen = mutator(doc, seeded(seed));
	const dropAt = o.drop ? 1 + (seed % Math.max(1, rounds - 2)) : -1;
	let holes = 0;
	const errs: Array<string> = [];
	for (let r = 0; r < rounds; r++) {
		await gen.round();
		// Reads cut in slices run on their own before the drain, which reads whatever is left.
		if (o.slice !== undefined) await sleep(40);
		const chunk = await wire(drain());
		for (let i = 0; i < chunk.tape.length; i++) if (chunk.tape[i] === 129 && chunk.tape[i + 1] === 1 && typeof chunk.tape[i + 2] === "string") errs.push(String(chunk.tape[i + 2]));
		const bad = validate(chunk.tape, chunk.base);
		if (bad) return { round: r, diff: { what: `validate: ${bad.reason} at ${bad.at}` } };
		if (r === dropAt) {
			// Lost on the way; the next one is a hole the player must see.
			const before = player.gaps.length;
			player.append([await wire(drain())]);
			await gen.round();
			player.append([await wire(drain())]);
			player.seek(player.duration);
			if (chunk.tape.length && player.gaps.length === before) return { round: r, diff: { what: "hole not reported" } };
			holes++;
			// The server asks for a snapshot; the copy must be right again.
			player.append([await wire(own(rec.snap())), await wire(drain())]);
			player.seek(player.duration);
		} else {
			player.append([chunk]);
			player.seek(player.duration);
		}
		// resume: the copy goes back to its last checkpoint and plays on from there.
		if (o.resume) {
			player.seek(Math.max(0, player.duration - 1));
			player.seek(player.duration);
		}
		const diffs = compare(doc, player.document, { mask, max: 2, ignoreMode: true });
		if (diffs.length) return { round: r, diff: diffs[0], holes, errs: errs.slice(0, 3), log: gen.log.slice(), last: JSON.stringify(chunk.tape).slice(0, 1200) };
		const wrong = player.prints.filter((p) => !p.ok).length;
		if (wrong) return { round: r, diff: { what: `fingerprint wrong ${wrong}/${player.prints.length}: ${player.prints.find((p) => !p.ok)?.detail} ; ${census(doc, player.document)}` }, log: gen.log.slice() };
	}
	rec.stop();
	return { round: rounds, diff: null, holes };
}

/**
 * What a copy of the document does not carry, through a checkpoint: canvas pixels, a scrolled
 * box, an open popover. Saved, then the tape plays on and changes all three; the checkpoint,
 * restored into a new document and into the first one, must show them as they were saved.
 */
async function checkpoint(): Promise<Array<string>> {
	const paint = (color: string) => {
		const c = document.createElement("canvas");
		c.width = c.height = 4;
		const g = c.getContext("2d") as CanvasRenderingContext2D;
		g.fillStyle = color;
		g.fillRect(0, 0, 4, 4);
		return c.toDataURL();
	};
	const frame = () => {
		const f = document.createElement("iframe");
		f.setAttribute("sandbox", "allow-same-origin");
		(document.getElementById("replay") as HTMLElement).append(f);
		return f.contentDocument as Document;
	};
	(document.getElementById("replay") as HTMLElement).replaceChildren();
	// Numbers: doctype 2, html 3, body 4, canvas 5, box 6, its content 7, popover 8, its text 9.
	const tape = [
		96, 2, "http://lab.test/x", 1000, 400, 300, 0,
		3, "html", "", "",
		1, "html", 0, 1, "body", 0,
		1, "canvas", 2, "width", "4", "height", "4", 0,
		1, "div", 1, "style", "width:100px;height:50px;overflow:auto", 1, "div", 1, "style", "height:500px", 0, 0,
		1, "div", 2, "id", "pop", "popover", "", 2, "menu", 0,
		0, 0,
		128, 2, 5, paint("#ff0000"),
		48, 10, 51, 6, 0, 120, 21, 8, 1, 48, 10,
	];
	const later = [128, 2, 5, paint("#0000ff"), 51, 6, 0, 0, 21, 8, 0, 48, 10];
	const a = mirror(frame());
	a.run(tape as never);
	await sleep(80);
	const cp = a.save();
	const next = a.next;
	a.run(later as never);
	await sleep(80);
	const out: Array<string> = [];
	const look = (m: ReturnType<typeof mirror>, where: string) => {
		const canvas = m.nodes[5] as HTMLCanvasElement;
		const px = canvas?.getContext("2d")?.getImageData(1, 1, 1, 1).data;
		if (!px || px[0] !== 255 || px[2] !== 0) out.push(`${where}: canvas ${px ? Array.from(px).join(",") : "absent"}, rouge attendu`);
		const box = m.nodes[6] as Element;
		if (box?.scrollTop !== 120) out.push(`${where}: défilement ${box?.scrollTop}, 120 attendu`);
		const pop = m.nodes[8] as Element;
		let open = false;
		try {
			open = pop.matches(":popover-open");
		} catch {}
		if (!open) out.push(`${where}: popover fermé`);
		if (m.next !== next) out.push(`${where}: prochain numéro ${m.next}, ${next} attendu`);
		if ((m.nodes[9] as Text)?.data !== "menu") out.push(`${where}: texte du nœud 9`);
	};
	const b = mirror(frame());
	b.restore(cp);
	look(b, "document neuf");
	a.restore(cp);
	look(a, "même document");
	return out;
}

/** Where the copy holds more or fewer nodes than the page, the way PRINT counts them. */
function census(live: Node, copy: Node, path = ""): string | null {
	const kids = (n: Node) =>
		Array.from(n.nodeType === 1 && (n as Element).localName === "template" ? (n as HTMLTemplateElement).content.childNodes : n.childNodes).filter(
			(c) => (c.nodeType === 3 || c.nodeType === 10 || c.nodeType === 1) && !/^(script|noscript)$/.test((c as Element).localName || ""),
		);
	const a = kids(live);
	const b = kids(copy);
	if (live.nodeType === 1 && (live as Element).hasAttribute("data-va-block")) return null;
	if (a.length !== b.length)
		return `${path}: ${a.length} ≠ ${b.length}  page ${a.map((c) => c.nodeName).join(",")} | copie ${b.map((c) => c.nodeName).join(",")}`;
	for (let i = 0; i < a.length; i++) {
		const r = census(a[i] as Node, b[i] as Node, `${path}>${(a[i] as Node).nodeName}`);
		if (r) return r;
	}
	return null;
}

(window as unknown as { lab: unknown }).lab = {
	names: () => CASES.map((c) => c.name),
	pages: () => Object.fromEntries([...CASES.map((c) => [c.name, c.html]), ["__fuzz__", FUZZ_PAGE]]),
	start,
	end,
	fuzz,
	checkpoint,
};
