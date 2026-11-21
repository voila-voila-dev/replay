// The lab served over HTTP on localhost, so any browser can load it: Playwright's engines, Safari
// in the iOS Simulator, Chrome in the Android emulator (through `adb reverse`), Firefox ESR.
// localhost counts as a secure context, which `crypto.subtle` needs to hash the tapes.
// With `/lab.html?auto`, the page runs the suite itself and posts what it finds back here.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { visitServer } from "./visit-pages.mjs";

const LAB = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>lab</title></head><body>
<iframe id="site" style="width:800px;height:600px"></iframe><div id="replay"></div>
<script src="/build/lab.js"></script></body></html>`;
const BLANK = `<!DOCTYPE html><html><head></head><body></body></html>`;

/**
 * Starts the server. The case pages are set once the lab has given them (`server.pages = …`, or
 * posted by a page running on its own); `server.on(kind, fn)` hears what such a page posts.
 */
export function serve(port = 0, host = "127.0.0.1") {
	const listeners = {};
	const server = {
		pages: {},
		visit: visitServer(),
		origin: "",
		close: () => {},
		on: (kind, fn) => {
			listeners[kind] = fn;
		},
	};
	const http = createServer((req, res) => {
		const url = new URL(req.url, "http://localhost");
		const send = (type, body, status = 200) => {
			res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
			res.end(body);
		};
		if (req.method === "POST") {
			const parts = [];
			req.on("data", (d) => parts.push(d));
			req.on("end", () => {
				const raw = Buffer.concat(parts);
				if (url.pathname === "/collect") {
					let answer = "";
					try {
						answer = server.visit.collect(raw);
					} catch (e) {
						listeners["visit:bad"]?.(String(e));
						return send("text/plain", "", 400);
					}
					return answer ? send("application/json", answer) : send("text/plain", "", 204);
				}
				const body = raw.toString("utf8");
				const kind = url.pathname.slice(1).replace("/", ":");
				let value = body;
				try {
					value = JSON.parse(body);
				} catch {}
				if (kind === "pages") server.pages = value;
				listeners[kind]?.(value);
				send("text/plain", "");
			});
			return;
		}
		if (url.pathname === "/lab.html") return send("text/html; charset=utf-8", LAB);
		const visit = server.visit.page(url.pathname);
		// No `no-store` here: it would keep the page out of the back/forward cache.
		if (visit) {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			return res.end(visit);
		}
		if (url.pathname === "/visit/kept") return send("application/json", server.visit.kept());
		if (url.pathname === "/site.html") return send("text/html; charset=utf-8", server.pages[url.searchParams.get("n")] || "");
		if (url.pathname === "/blank.html") return send("text/html; charset=utf-8", BLANK);
		if (/^\/build\/[\w.-]+\.js$/.test(url.pathname)) {
			try {
				return send("text/javascript; charset=utf-8", readFileSync(new URL(`.${url.pathname}`, import.meta.url)));
			} catch {}
		}
		send("text/plain", "", 404);
	});
	return new Promise((ok) => {
		http.listen(port, host, () => {
			server.origin = `http://localhost:${http.address().port}`;
			server.close = () => http.close();
			ok(server);
		});
	});
}
