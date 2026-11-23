// Runs the case suite in each target: Playwright's Chromium, WebKit and Firefox by default, or
// Safari iOS, Chrome Android, a stock Firefox, any device (see drivers.mjs).
//   node test/browser/run.mjs [--target chromium,ios] [--case "témoin"] [--tapes]
import { open } from "./drivers.mjs";
import { serve } from "./serve.mjs";

const args = process.argv.slice(2);
const arg = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const targets = (arg("target") || arg("engine") || "chromium,webkit,firefox").split(",");
const only = arg("case");

const server = await serve(+(process.env.LAB_PORT || 0), process.env.LAB_HOST);
let failed = 0;

let skips = 0;
function report(c, result) {
	if (result.skipped) {
		skips++;
		console.log(`– ${c}  (sauté : ${result.skipped} absent)`);
		return false;
	}
	const bad = result.diffs.length || result.errors.length || result.leaks.length || result.prints.bad;
	if (bad) failed++;
	console.log(`${bad ? "✗" : "✓"} ${c}${bad ? "" : `  (${result.bytes} o)`}`);
	for (const d of result.diffs) console.log(`    ${d.path}  ${d.what}: ${JSON.stringify(d.live)} ≠ ${JSON.stringify(d.copy)}`);
	if ((only || args.includes("--tapes")) && result.tapes) for (const t of result.tapes) console.log(`    bande: ${t}`);
	for (const e of result.errors) console.log(`    erreur: ${e}`);
	for (const l of result.leaks) console.log(`    FUITE: ${l}`);
	if (result.prints.bad) console.log(`    empreinte fausse ${result.prints.bad}/${result.prints.total}`);
	return !bad;
}
function reportList(label, list) {
	if (list.length) failed++;
	console.log(`${list.length ? "✗" : "✓"} ${label}`);
	for (const l of list) console.log(`    ${l}`);
}

/** A page that runs the suite on its own: what it posts is reported as it comes. */
function selfRun(b) {
	return new Promise((done, fail) => {
		let ok = 0;
		let total = 0;
		let timer;
		// A browser that stops posting for this long is stuck, or gone.
		const alive = () => {
			clearTimeout(timer);
			timer = setTimeout(() => fail(new Error("plus de nouvelles du navigateur depuis 120 s")), 120_000);
		};
		server.on("hello", (h) => {
			alive();
			total = h.cases;
			console.log(`\n${h.ua}`);
		});
		server.on("result", ({ name, result }) => {
			alive();
			if (report(name, result)) ok++;
		});
		server.on("checkpoint", (list) => {
			alive();
			reportList("point de reprise : canvas, défilement, popover", list);
		});
		server.on("lifecycle", (list) => {
			alive();
			reportList("budget, module coupé, retour par le cache", list);
		});
		server.on("shown", (list) => {
			alive();
			reportList("ce que la copie montre : bloc caché, canvas", list);
		});
		server.on("error", (e) => {
			alive();
			console.log(`    erreur de la page: ${e}`);
		});
		alive();
		const open = () => b.launch(`${server.origin}/lab.html?auto&r=${Date.now()}`);
		open();
		// Safari in the simulator sometimes leaves the URL unopened: asked once more.
		const again = setTimeout(() => total || open(), 30_000);
		server.on("done", () => {
			clearTimeout(again);
			clearTimeout(timer);
			done({ ok, total });
		});
	});
}

for (const target of targets) {
	const t0 = Date.now();
	const b = await open(target, { port: new URL(server.origin).port });
	let ok = 0;
	let total = 0;
	if (b.auto) {
		try {
			({ ok, total } = await selfRun(b));
		} catch (e) {
			failed++;
			console.log(`✗ ${e.message}`);
		}
	} else {
		await b.goto(`${server.origin}/lab.html`);
		server.pages = await b.evaluate(() => window.lab.pages());
		const names = (await b.evaluate(() => window.lab.names())).filter((n) => !only || n === only);
		total = names.length;
		console.log(`\n${b.version}`);
		for (const c of names) {
			let result;
			try {
				const todo = await b.evaluate((n) => window.lab.start(n), c);
				for (const [sel, text] of todo.keys) await b.type(sel, text);
				for (const sel of todo.clicks) await b.click(sel);
				for (const [sel, value] of todo.select) await b.select(sel, value);
				result = await b.evaluate(() => window.lab.end());
			} catch (e) {
				result = { diffs: [{ path: "-", what: String(e).split("\n")[0] }], errors: [], leaks: [], prints: { bad: 0 } };
			}
			if (report(c, result)) ok++;
		}
		if (!only) {
			reportList("point de reprise : canvas, défilement, popover", await b.evaluate(() => window.lab.checkpoint()));
			reportList("budget, module coupé, retour par le cache", await b.evaluate(() => window.lab.lifecycle()));
			reportList("ce que la copie montre : bloc caché, canvas", await b.evaluate(() => window.lab.shown()));
		}
	}
	console.log(`${ok}/${total} cas${skips ? `, ${skips} sauté(s)` : ""}, ${Math.round((Date.now() - t0) / 1000)} s`);
	skips = 0;
	await b.close();
}
server.close();
console.log(failed ? `\n${failed} échec(s)` : "\ntout passe");
process.exit(failed ? 1 : 0);
