// Turns a run of the replay lab bench (rrweb against @voila.dev/replay) into src/data/bench.json.
// Usage: bun run scripts/bench.ts [results dir]   (default ~/Documents/replay-lab/bench-replay/results)
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

const dir = process.argv[2] ?? `${process.env.HOME}/Documents/replay-lab/bench-replay/results`;
const load = (f: string) => (existsSync(`${dir}/${f}`) ? JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) : null);

type Result = {
	page: string;
	recorder: string;
	error?: string;
	evalMs: number;
	startMs: number;
	nodes: number;
	initial: { longest: number; tbt: number; task: number; bytes: { raw: number; gzip: number } };
	mutations: { longest: number; tbt: number; task: number; bytes: { raw: number; gzip: number } };
};

const PAGES: Record<string, string> = {
	"sillage-fixture": "Test fixture",
	"calque-demo": "Demo shop",
	jardins: "jardins-du-bassin.fr",
	wikipedia: "fr.wikipedia.org",
	lemonde: "lemonde.fr",
};
const RECORDERS = ["none", "rrweb", "replay"] as const;

const median = (a: number[]) => {
	const v = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y);
	if (!v.length) return null;
	const m = v.length >> 1;
	return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const round = (n: number | null, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

const sizes = load("sizes.json");
const cap = load("capture-chromium.json");
if (!sizes || !cap) throw new Error(`no sizes.json or capture-chromium.json in ${dir}`);
const ok: Result[] = cap.results.filter((x: Result) => !x.error);
const pick = (page: string, rec: string, f: (x: Result) => number) => round(median(ok.filter((x) => x.page === page && x.recorder === rec).map(f)));

const pages = Object.keys(PAGES)
	.filter((id) => ok.some((x) => x.page === id))
	.map((id) => {
		const by = (rec: string) => ({
			eval: pick(id, rec, (x) => x.evalMs),
			start: pick(id, rec, (x) => x.startMs),
			longest: pick(id, rec, (x) => x.initial.longest),
			tbt: pick(id, rec, (x) => x.initial.tbt),
			task: round((pick(id, rec, (x) => x.initial.task) ?? 0) - (pick(id, "none", (x) => x.initial.task) ?? 0)),
			initialRaw: pick(id, rec, (x) => x.initial.bytes.raw),
			initialGzip: pick(id, rec, (x) => x.initial.bytes.gzip),
			mutationsGzip: pick(id, rec, (x) => x.mutations.bytes.gzip),
			mutationsLongest: pick(id, rec, (x) => x.mutations.longest),
			mutationsTask: round((pick(id, rec, (x) => x.mutations.task) ?? 0) - (pick(id, "none", (x) => x.mutations.task) ?? 0)),
		});
		return { id, name: PAGES[id], elements: pick(id, "none", (x) => x.nodes), ...Object.fromEntries(RECORDERS.map((r) => [r, by(r)])) };
	});

const engines = ["webkit", "firefox"].map((b) => {
	const c = load(`capture-${b}.json`);
	if (!c) return null;
	const rows = c.results.filter((x: Result) => x.recorder !== "none");
	const passed = (rec: string) => rows.filter((x: Result) => x.recorder === rec && !x.error).length;
	return {
		engine: b === "webkit" ? "WebKit" : "Firefox",
		version: c.version,
		pages: new Set(rows.map((x: Result) => x.page)).size,
		rrweb: passed("rrweb"),
		replay: passed("replay"),
		start: Object.fromEntries(
			["rrweb", "replay"].map((r) => [r, Object.fromEntries(rows.filter((x: Result) => x.recorder === r && !x.error).map((x: Result) => [x.page, round(x.startMs, 0)]))]),
		),
	};
});

const mem = load("memory.json");
const memory = mem
	? {
			ticks: mem.ticks,
			tickMs: mem.tickMs,
			pages: Object.keys(PAGES)
				.filter((id) => mem.results.some((x: { page: string }) => x.page === id))
				.map((id) => {
					const get = (r: string) => mem.results.find((x: { page: string; recorder: string }) => x.page === id && x.recorder === r);
					const none = get("none");
					const mb = (r: string) => {
						const x = get(r);
						return !x || x.error ? null : round((x.retainedHeap - (none?.retainedHeap ?? 0)) / 1e6, 2);
					};
					return { id, name: PAGES[id], rrweb: mb("rrweb"), replay: mb("replay") };
				}),
		}
	: null;

const kb = (s: { gzip: number } | null) => (s ? round(s.gzip / 1000) : null);
const out = {
	date: statSync(`${dir}/capture-chromium.json`).mtime.toISOString().slice(0, 10),
	chromium: cap.version,
	throttle: cap.throttle,
	runs: cap.runs,
	replay: { version: sizes.replayVersion, commit: sizes.replayCommit },
	rrweb: { version: "2.2.2" },
	sizes: {
		rrweb: { record: kb(sizes.sizes.rrweb.core) },
		replay: {
			record: kb(sizes.sizes.replay.core),
			send: kb(sizes.sizes.replay.transport),
			all: kb(sizes.sizes.replay.all),
			player: kb(sizes.sizes.replay.player),
		},
	},
	pages,
	engines: engines.filter(Boolean),
	memory,
};
writeFileSync(new URL("../src/data/bench.json", import.meta.url), `${JSON.stringify(out, null, "\t")}\n`);
console.log(JSON.stringify(out, null, 1).slice(0, 1500));
