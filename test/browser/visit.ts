// A visit, end to end, as a site runs the recorder: snapshot, a chunk each second through
// `connect` (gzip where CompressionStream exists, the hashes the server asks for), what is left
// in a beacon on `pagehide`, and the return from the back/forward cache. The page acts on its
// own, so it runs in any browser, driven or not; `judge()` then plays what the server kept.
import { type Chunk, resolve, validate, type WireTape } from "../../src/format/index";
import { cssom, shadow } from "../../src/modules/index";
import { createPlayer } from "../../src/play/index";
import { record } from "../../src/record/index";
import { connect } from "../../src/send/index";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const note = (what: string, data: unknown = {}) =>
	fetch(`/visit/${what}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

/** Types as a keyboard does: `beforeinput` and `input` for each character. */
async function type(sel: string, text: string) {
	const el = document.querySelector(sel) as HTMLInputElement;
	el.focus();
	for (const ch of text) {
		document.execCommand("insertText", false, ch);
		await sleep(20);
	}
	el.blur();
}

async function visit() {
	const pv = sessionStorage.getItem("visit-pv");
	// Back here without the cache: the page was rebuilt, the visit ends with what it has.
	if (pv) {
		await note("back", { cache: false });
		location.href = "/visit-final.html";
		return;
	}
	const id = `pv-${Math.random().toString(36).slice(2, 10)}`;
	sessionStorage.setItem("visit-pv", id);
	const errors: Array<string> = [];
	addEventListener("error", (e) => errors.push(String(e.message)));

	const rec = record(window, { mask: "inputs", modules: [shadow(), cssom()], printEvery: 1000 });
	await note("start", {
		ua: navigator.userAgent,
		recorder: !!rec,
		compression: typeof (globalThis as { CompressionStream?: unknown }).CompressionStream === "function",
		idle: typeof (window as { requestIdleCallback?: unknown }).requestIdleCallback === "function",
		yield: typeof (window as { scheduler?: { yield?: unknown } }).scheduler?.yield === "function",
		width: innerWidth,
	});
	if (!rec) {
		location.href = "/visit-final.html";
		return;
	}
	const link = connect({ endpoint: "/collect", head: () => ({ url: location.href, pv: id }), onSnap: () => link.send(rec.snap()) });
	link.send(rec.snap());
	const tick = setInterval(() => link.send(rec.drain()), 1000);
	addEventListener("pagehide", () => link.leave(rec.drain()));
	addEventListener("pageshow", async (e) => {
		if (!e.persisted) return;
		await note("back", { cache: true, needsSnap: rec.needsSnap });
		if (rec.needsSnap) {
			link.send(rec.drain());
			link.send(rec.snap());
		}
		(document.querySelector("#retour") as HTMLElement).textContent = "Vous êtes revenu.";
		await sleep(1500);
		link.send(rec.drain());
		await link.idle();
		clearInterval(tick);
		rec.stop();
		await note("errors", errors);
		location.href = "/visit-final.html";
	});

	// What a visitor does: opens the menu, scrolls, fills in the form.
	await sleep(600);
	(document.querySelector("#menu") as HTMLElement).click();
	await sleep(300);
	scrollTo(0, 700);
	await sleep(300);
	await type("#nom", "Camille Exemple");
	await type("#tel", "0600000000");
	const s = document.querySelector("#service") as HTMLSelectElement;
	s.value = "haie";
	s.dispatchEvent(new Event("change", { bubbles: true }));
	await type("#message", "Une haie de 20 m à tailler.");
	(document.querySelector("#rgpd") as HTMLInputElement).click();
	scrollTo(0, 0);
	await sleep(1500);
	await link.idle();
	await note("errors", errors);
	// Leaves right after a change: it can only go in the beacon. The next page comes back here.
	(document.querySelector("#retour") as HTMLElement).textContent = "Au revoir.";
	location.href = "/visit-end.html";
}

/** Plays what the server kept for each page view and says what the copy thinks of itself. */
async function judge() {
	const kept = (await (await fetch("/visit/kept")).json()) as {
		views: Record<string, Array<{ seq: number; base: number; tape: WireTape }>>;
		blobs: Record<string, string>;
	};
	const out: Array<unknown> = [];
	for (const [pv, list] of Object.entries(kept.views)) {
		const chunks: Array<Chunk> = [];
		const problems: Array<string> = [];
		const missing = new Set<string>();
		for (const c of list.sort((a, b) => a.seq - b.seq)) {
			// A string never received plays as empty, as on the platform; a piece never received cannot.
			let tape: Chunk["tape"];
			try {
				tape = resolve(c.tape, (h) => {
					if (h in kept.blobs) return kept.blobs[h];
					missing.add(h);
					return "";
				});
			} catch (e) {
				problems.push(`seq ${c.seq}: ${e}`);
				continue;
			}
			const bad = validate(tape, tape[0] === 96 ? undefined : c.base);
			if (bad) problems.push(`seq ${c.seq}: ${bad.reason} at ${bad.at}`);
			chunks.push({ seq: c.seq, base: c.base, tape });
		}
		if (missing.size) problems.push(`${missing.size} chaîne(s) jamais reçue(s)`);
		const host = document.getElementById("replay") as HTMLElement;
		host.replaceChildren();
		const player = createPlayer({ root: host, chunks });
		player.seek(player.duration);
		await sleep(100);
		out.push({
			pv,
			chunks: list.length,
			problems,
			gaps: player.gaps.length,
			prints: player.prints.length,
			wrong: player.prints.filter((p) => !p.ok).map((p) => p.detail),
			duration: Math.round(player.duration),
			text: (player.document.body?.textContent || "").replace(/\s+/g, " ").slice(0, 80),
		});
	}
	await note("judged", out);
}

(window as unknown as { visit: unknown }).visit = {
	visit,
	judge: () => judge().catch((e) => note("judged", [{ pv: "-", chunks: 0, problems: [String(e)], gaps: 0, prints: 0, wrong: [], duration: 0, text: "" }])),
};
