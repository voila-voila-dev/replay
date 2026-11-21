// The pages of a visit (see visit.ts) and the server's side of it: `/collect` answers as the
// platform does, with the hashes it still needs, and keeps what it gets for the judge.
import { gunzipSync } from "node:zlib";

const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`;

const SITE = `<!DOCTYPE html><html lang="fr"><head>${HEAD}<title>Jardins Exemple</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#1d2a1f}
header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#2f5d3a;color:#fff;position:sticky;top:0}
nav{display:none;background:#e8f0e9;padding:8px 16px}nav.open{display:block}
nav a{display:block;padding:6px 0;color:#2f5d3a}
section{padding:24px 16px;min-height:320px}section:nth-child(even){background:#f6f8f4}
.hero{background:linear-gradient(#2f5d3a,#4b7d55);color:#fff}
label{display:block;margin-top:12px}input,select,textarea{width:100%;font:inherit;padding:8px;box-sizing:border-box}
button{font:inherit;padding:8px 14px}
</style></head><body>
<header><strong>Jardins Exemple</strong><button id="menu" aria-expanded="false">Menu</button></header>
<nav id="nav"><a href="#services">Services</a><a href="#devis">Devis</a></nav>
<main>
<section class="hero"><h1>Votre jardin, entretenu toute l'année</h1><p>Tonte, taille de haies, création de massifs.</p>
<img alt="" width="120" height="60" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Crect width='120' height='60' fill='%23cfe3c9'/%3E%3C/svg%3E"></section>
<section id="services"><h2>Services</h2><ul><li>Tonte et ramassage</li><li>Taille de haies</li><li>Débroussaillage</li></ul><p id="retour"></p></section>
<section id="devis"><h2>Demander un devis</h2><form onsubmit="return false">
<label>Nom <input id="nom" autocomplete="name"></label>
<label>Téléphone <input id="tel" type="tel" autocomplete="tel"></label>
<label>Service <select id="service"><option value="">Choisir</option><option value="tonte">Tonte</option><option value="haie">Taille de haie</option></select></label>
<label>Votre projet <textarea id="message"></textarea></label>
<label><input id="rgpd" type="checkbox" style="width:auto"> J'accepte d'être recontacté</label>
<button>Envoyer</button></form></section>
</main>
<script>document.getElementById("menu").onclick=function(){var n=document.getElementById("nav");n.classList.toggle("open");this.setAttribute("aria-expanded",n.classList.contains("open"))};</script>
<script>function tell(m){fetch("/visit/pageerror",{method:"POST",body:JSON.stringify(String(m))})}addEventListener("error",function(e){tell(e.message)});addEventListener("unhandledrejection",function(e){tell(e.reason&&(e.reason.stack||e.reason))})</script>
<script src="/build/visit.js"></script><script>visit.visit()</script>
</body></html>`;

const END = `<!DOCTYPE html><html><head>${HEAD}</head><body><p>Autre page.</p>
<script>setTimeout(function(){history.back()},1200)</script></body></html>`;
const FINAL = `<!DOCTYPE html><html><head>${HEAD}</head><body><div id="replay"></div>
<script src="/build/visit.js"></script><script>visit.judge()</script></body></html>`;

/** What `/collect` received, per page view. */
export function visitServer() {
	const s = { views: {}, blobs: {}, posts: 0, gzip: 0, beacons: 0, bytes: 0, needs: 0 };
	const hashes = (tape) => (tape || []).filter((t) => Array.isArray(t)).map((t) => t[0]);
	return {
		state: s,
		reset() {
			Object.assign(s, { views: {}, blobs: {}, posts: 0, gzip: 0, beacons: 0, bytes: 0, needs: 0 });
		},
		page(path) {
			if (path === "/visit.html") return SITE;
			if (path === "/visit-end.html") return END;
			if (path === "/visit-final.html") return FINAL;
		},
		kept: () => JSON.stringify({ views: s.views, blobs: s.blobs }),
		/** One POST to /collect: a body, gzipped or not. Returns the answer, or "" for none. */
		collect(raw) {
			s.posts++;
			s.bytes += raw.length;
			let body = raw;
			if (raw[0] === 0x1f && raw[1] === 0x8b) {
				s.gzip++;
				body = gunzipSync(raw);
			}
			const env = JSON.parse(body.toString("utf8"));
			if (env.v !== 2) throw new Error(`format ${env.v}`);
			Object.assign(s.blobs, env.blobs || {});
			if (env.last) s.beacons++;
			// A piece refers to strings of its own, asked for once the piece is read, as the platform does.
			if (env.blobs && !env.tape) {
				const inner = [];
				for (const text of Object.values(env.blobs)) {
					try {
						const piece = JSON.parse(text);
						if (Array.isArray(piece)) inner.push(...hashes(piece).filter((h) => !(h in s.blobs)));
					} catch {}
				}
				if (inner.length && !env.last) {
					s.needs += inner.length;
					return JSON.stringify({ need: inner });
				}
			}
			if (env.tape) {
				const list = s.views[env.pv] || (s.views[env.pv] = []);
				// A beacon can carry again chunks that left before it (same seq): the later one wins.
				const i = list.findIndex((c) => c.seq === env.seq);
				const chunk = { seq: env.seq, base: env.base, tape: env.tape, last: !!env.last };
				if (i >= 0) list[i] = chunk;
				else list.push(chunk);
				const need = hashes(env.tape).filter((h) => !(h in s.blobs));
				if (need.length && !env.last) {
					s.needs += need.length;
					return JSON.stringify({ need });
				}
			}
			return "";
		},
	};
}
