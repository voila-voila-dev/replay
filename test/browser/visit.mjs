// A visit end to end in each target (see visit.ts): what the server got, then what the copy
// thinks of itself.
//   node test/browser/visit.mjs [--target chromium,android,ios]
import { open } from "./drivers.mjs";
import { serve } from "./serve.mjs";

const args = process.argv.slice(2);
const arg = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const targets = (arg("target") || "chromium,webkit,firefox").split(",");
const server = await serve(+(process.env.LAB_PORT || 0), process.env.LAB_HOST);
let failed = 0;

function run(b) {
	return new Promise((done, fail) => {
		const seen = { errors: [] };
		const timer = setTimeout(() => fail(new Error("pas de verdict après 90 s")), 90_000);
		server.on("visit:back", (s) => {
			seen.back = s;
		});
		server.on("visit:errors", (e) => seen.errors.push(...e));
		server.on("visit:bad", (e) => seen.errors.push(`collect: ${e}`));
		server.on("visit:pageerror", (e) => {
			seen.errors.push(e);
			console.log(`    erreur de la page : ${e}`);
		});
		server.on("visit:start", (s) => {
			seen.start = s;
			console.log(`    démarrée : ${s.ua}`);
		});
		server.on("visit:judged", (j) => {
			clearTimeout(timer);
			done({ ...seen, judged: j });
		});
		const url = `${server.origin}/visit.html?r=${Date.now()}`;
		if (b.auto) {
			b.launch(url);
			// Safari in the simulator sometimes leaves the URL unopened: asked once more.
			setTimeout(() => seen.start || b.launch(`${url}x`), 30_000);
		}
		else b.goto(url).catch(fail);
	});
}

for (const target of targets) {
	server.visit.reset();
	const b = await open(target, { port: new URL(server.origin).port });
	try {
		const r = await run(b);
		const s = server.visit.state;
		const bad = [];
		console.log(`\n${b.version || r.start?.ua}`);
		console.log(`  enregistreur ${r.start.recorder ? "démarré" : "absent"} · CompressionStream ${r.start.compression ? "oui" : "non"} · requestIdleCallback ${r.start.idle ? "oui" : "non"} · scheduler.yield ${r.start.yield ? "oui" : "non"}`);
		console.log(`  envois ${s.posts} (dont gzip ${s.gzip}, balises ${s.beacons}) · ${Math.round(s.bytes / 102.4) / 10} Ko reçus · morceaux demandés ${s.needs}`);
		console.log(`  retour : ${r.back ? (r.back.cache ? `par le cache, capture ${r.back.needsSnap ? "demandée" : "non demandée"}` : "page reconstruite (pas de cache)") : "aucun"}`);
		if (r.start.recorder) {
			if (!s.beacons) bad.push("aucune balise reçue au départ de la page");
			if (r.start.compression && !s.gzip) bad.push("CompressionStream présent mais rien en gzip");
			if (r.back?.cache && !r.back.needsSnap) bad.push("retour par le cache sans capture demandée");
		}
		for (const j of r.judged) {
			console.log(`  ${j.pv}: ${j.chunks} morceaux, ${j.duration} ms, trous ${j.gaps}, empreintes ${j.prints - j.wrong.length}/${j.prints}`);
			console.log(`    « ${j.text} »`);
			for (const p of j.problems) bad.push(`bande invalide : ${p}`);
			for (const w of j.wrong) bad.push(`empreinte fausse : ${w}`);
			if (j.gaps) bad.push(`${j.gaps} trou(s)`);
		}
		if (r.start.recorder && !r.judged.length) bad.push("rien de rejoué");
		for (const e of r.errors) bad.push(`erreur de la page : ${e}`);
		if (bad.length) failed++;
		console.log(bad.length ? bad.map((x) => `  ✗ ${x}`).join("\n") : "  ✓ visite complète");
	} catch (e) {
		failed++;
		console.log(`\n${target}\n  ✗ ${e.message}`);
	}
	await b.close();
}
server.close();
process.exit(failed ? 1 : 0);
