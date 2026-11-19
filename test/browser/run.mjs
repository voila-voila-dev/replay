// Runs the case suite in Chromium, WebKit and Firefox, all through Playwright.
//   node test/browser/run.mjs [--engine chromium] [--case "témoin"]
import { readFileSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const args = process.argv.slice(2);
const arg = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const ENGINES = { chromium, webkit, firefox };
const engines = arg("engine") ? [arg("engine")] : Object.keys(ENGINES);
const only = arg("case");

const LAB = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>lab</title></head><body>
<iframe id="site" style="width:800px;height:600px"></iframe><div id="replay"></div>
<script src="/build/lab.js"></script></body></html>`;
const BLANK = `<!DOCTYPE html><html><head></head><body></body></html>`;

async function serve(page) {
	await page.route("http://lab.test/**", (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === "/lab.html") return route.fulfill({ contentType: "text/html", body: LAB });
		if (url.pathname === "/site.html") return route.fulfill({ contentType: "text/html", body: pages[url.searchParams.get("n")] || "" });
		if (url.pathname === "/blank.html") return route.fulfill({ contentType: "text/html", body: BLANK });
		if (url.pathname.startsWith("/build/"))
			return route.fulfill({ contentType: "text/javascript", body: readFileSync(new URL(`.${url.pathname}`, import.meta.url)) });
		return route.fulfill({ status: 404, body: "" });
	});
}

let failed = 0;
let pages = {};
for (const name of engines) {
	const browser = await ENGINES[name].launch();
	const page = await browser.newPage();
	await serve(page);
	await page.goto("http://lab.test/lab.html");
	pages = await page.evaluate(() => window.lab.pages());
	const names = (await page.evaluate(() => window.lab.names())).filter((n) => !only || n === only);
	const version = browser.version();
	console.log(`\n${name} ${version}`);
	for (const c of names) {
		let result;
		try {
			const todo = await page.evaluate((n) => window.lab.start(n), c);
			const site = page.frameLocator("#site");
			for (const [sel, text] of todo.keys) await site.locator(sel).pressSequentially(text, { delay: 5 });
			for (const sel of todo.clicks) await site.locator(sel).click();
			for (const [sel, value] of todo.select) await site.locator(sel).selectOption(value);
			result = await page.evaluate(() => window.lab.end());
		} catch (e) {
			result = { diffs: [{ path: "-", what: String(e).split("\n")[0] }], errors: [], leaks: [], prints: { bad: 0 } };
		}
		const bad = result.diffs.length || result.errors.length || result.leaks.length || result.prints.bad;
		if (bad) failed++;
		console.log(`${bad ? "✗" : "✓"} ${c}${bad ? "" : `  (${result.bytes} o)`}`);
		for (const d of result.diffs) console.log(`    ${d.path}  ${d.what}: ${JSON.stringify(d.live)} ≠ ${JSON.stringify(d.copy)}`);
		if ((only || args.includes("--tapes")) && result.tapes) for (const t of result.tapes) console.log(`    bande: ${t}`);
		for (const e of result.errors) console.log(`    erreur: ${e}`);
		for (const l of result.leaks) console.log(`    FUITE: ${l}`);
		if (result.prints.bad) console.log(`    empreinte fausse ${result.prints.bad}/${result.prints.total}`);
	}
	await browser.close();
}
console.log(failed ? `\n${failed} échec(s)` : "\ntout passe");
process.exit(failed ? 1 : 0);
