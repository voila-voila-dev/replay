// The fuzzer, in each target (see drivers.mjs): random mutations of a page, the copy judged after each round.
//   node test/browser/fuzz.mjs [--target webkit,ios] [--seeds 20] [--rounds 150]
import { open } from "./drivers.mjs";
import { serve } from "./serve.mjs";

const args = process.argv.slice(2);
const arg = (name, d) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : d;
};
const targets = (arg("target") || arg("engine") || "chromium,webkit,firefox").split(",");
const seeds = +arg("seeds", 12);
const rounds = +arg("rounds", 120);

const server = await serve(+(process.env.LAB_PORT || 0), process.env.LAB_HOST);
let failed = 0;
for (const name of targets) {
	const b = await open(name, { port: new URL(server.origin).port });
	await b.goto(`${server.origin}/lab.html`);
	server.pages = await b.evaluate(() => window.lab.pages());
	console.log(`\n${b.version}`);
	for (const mode of (arg("modes") || "plain,drop,slice,resume,slice+resume,text,none").split(",")) {
		let ok = 0;
		for (let seed = 1; seed <= seeds; seed++) {
			// slice: each read of the mutations cut after one parent, the rest left to the next slice.
			// resume: after each round, the copy comes back from its last checkpoint.
			// Modes join with +, as in slice+resume.
			const o = {};
			for (const flag of mode.split("+")) {
				if (flag === "drop") o.drop = true;
				else if (flag === "slice") Object.assign(o, { slice: 0, rate: 0 });
				else if (flag === "resume") o.resume = true;
				else if (flag === "text" || flag === "none") o.mask = flag;
			}
			let r;
			try {
				r = await b.evaluate(([s, n, opt]) => window.lab.fuzz(s, n, opt), [seed, rounds, o]);
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
	await b.close();
}
server.close();
process.exit(failed ? 1 : 0);
