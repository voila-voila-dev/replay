// The fuzzer, on the three engines: random mutations of a page, the copy judged after each round.
//   node test/browser/fuzz.mjs [--engine webkit] [--seeds 20] [--rounds 150]
import { readFileSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const args = process.argv.slice(2);
const arg = (name, d) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : d;
};
const ENGINES = { chromium, webkit, firefox };
const engines = arg("engine") ? [arg("engine")] : Object.keys(ENGINES);
const seeds = +arg("seeds", 12);
const rounds = +arg("rounds", 120);
const LAB = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><iframe id="site" style="width:800px;height:600px"></iframe><div id="replay"></div><script src="/build/lab.js"></script></body></html>`;

let failed = 0;
let pages = {};
for (const name of engines) {
	const browser = await ENGINES[name].launch();
	const page = await browser.newPage();
	await page.route("http://lab.test/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/lab.html") return route.fulfill({ contentType: "text/html", body: LAB });
		if (path === "/site.html") return route.fulfill({ contentType: "text/html", body: pages[new URL(route.request().url()).searchParams.get("n")] || "" });
		if (path === "/blank.html") return route.fulfill({ contentType: "text/html", body: "<!DOCTYPE html><html><head></head><body></body></html>" });
		if (path.startsWith("/build/")) return route.fulfill({ contentType: "text/javascript", body: readFileSync(new URL(`.${path}`, import.meta.url)) });
		return route.fulfill({ status: 404, body: "" });
	});
	await page.goto("http://lab.test/lab.html");
	pages = await page.evaluate(() => window.lab.pages());
	console.log(`\n${name} ${browser.version()}`);
	for (const mode of (arg("modes") || "plain,drop,slice,text,none").split(",")) {
		let ok = 0;
		for (let seed = 1; seed <= seeds; seed++) {
			// slice: each read of the mutations cut after one parent, the rest left to the next slice.
			const o =
				mode === "drop" ? { drop: true } : mode === "slice" ? { slice: 0, rate: 0 } : mode === "plain" ? {} : { mask: mode };
			let r;
			try {
				r = await page.evaluate(([s, n, opt]) => window.lab.fuzz(s, n, opt), [seed, rounds, o]);
			} catch (e) {
				r = { round: -1, diff: { what: String(e).split("\n")[0] } };
			}
			if (r.diff) {
				failed++;
				console.log(`  ✗ ${mode} graine ${seed}, tour ${r.round}: ${r.diff.path || ""} ${r.diff.what} ${r.diff.live === undefined ? "" : `${JSON.stringify(r.diff.live)} ≠ ${JSON.stringify(r.diff.copy)}`}`);
				if (args.includes("--verbose") && r.log) console.log(`      tour : ${r.log.join("  ")}`);
				if (args.includes("--verbose") && r.last) console.log(`      bande : ${r.last}`);
				if (r.errs?.length) console.log(`      modules coupés : ${r.errs.join(", ")}`);
				if (args.includes("--verbose") && r.diff.around) console.log(`      page:  ${r.diff.around[0]}\n      copie: ${r.diff.around[1]}`);
			} else ok++;
		}
		console.log(`  ${mode}: ${ok}/${seeds} graines, ${rounds} tours chacune`);
	}
	await browser.close();
}
process.exit(failed ? 1 : 0);
