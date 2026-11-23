// The site is static, but for the playground: /playground/wiki/<lang>/... serves a Wikipedia
// page from replay.voila.dev, so that the demo can record it (a page of another origin cannot
// be read, so it cannot be recorded). Only Wikipedia, only GET, only articles and their
// stylesheets: not an open proxy. Scripts are removed; the copy would not run them anyway.
// Wikipedia's content is under CC BY-SA 4.0, credited on the playground page.

interface Env {
	ASSETS: { fetch(request: Request): Promise<Response> };
}

declare const HTMLRewriter: {
	new (): {
		on(selector: string, handler: { element(el: RewriterElement): void }): InstanceType<typeof HTMLRewriter>;
		transform(response: Response): Response;
	};
};
interface RewriterElement {
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
	remove(): void;
}

const ROUTE = /^\/playground\/wiki\/([a-z]{2,3}(?:-[a-z]{2,8})?)(\/(?:wiki\/[^?#]*|w\/load\.php))$/;
const AGENT = "replay.voila.dev playground (https://replay.voila.dev/playground)";
const TTL = 3600;

/** A path of Wikipedia, as served from here; `//host/…` made https, other addresses left. */
function local(prefix: string, value: string): string {
	const v = value.trim();
	if (v.startsWith("//")) return `https:${v}`;
	if (v.startsWith("/wiki/") || v.startsWith("/w/load.php")) return `${prefix}${v}`;
	if (v.startsWith("/")) return `https://${prefix.split("/")[3]}.wikipedia.org${v}`;
	return v;
}

function srcset(prefix: string, value: string): string {
	return value
		.split(",")
		.map((part) => {
			const [url, ...rest] = part.trim().split(/\s+/);
			return [local(prefix, url ?? ""), ...rest].join(" ");
		})
		.join(", ");
}

const attr = (prefix: string, name: string, fix = local) => ({
	element(el: RewriterElement) {
		const v = el.getAttribute(name);
		if (v !== null) el.setAttribute(name, fix(prefix, v));
	},
});

async function wiki(request: Request, lang: string, path: string, search: string): Promise<Response> {
	const upstream = await fetch(`https://${lang}.wikipedia.org${path}${search}`, {
		headers: { "user-agent": AGENT, accept: request.headers.get("accept") ?? "*/*" },
		cf: { cacheTtl: TTL, cacheEverything: true },
	} as RequestInit);
	const type = upstream.headers.get("content-type") ?? "application/octet-stream";
	const headers = new Headers({ "content-type": type, "cache-control": `public, max-age=${TTL}`, "x-robots-tag": "noindex" });
	const prefix = `/playground/wiki/${lang}`;

	if (type.includes("text/html")) {
		const page = new Response(upstream.body, { status: upstream.status, headers });
		return new HTMLRewriter()
			.on("script", { element: (el) => el.remove() })
			.on("a[href]", {
				element(el) {
					const v = el.getAttribute("href");
					if (v === null) return;
					const to = local(prefix, v);
					el.setAttribute("href", to);
					// Out of what is served here: a new tab, rather than a page the demo cannot record.
					if (/^https?:/.test(to)) {
						el.setAttribute("target", "_blank");
						el.setAttribute("rel", "noopener");
					}
				},
			})
			.on("link[href]", attr(prefix, "href"))
			.on("img[src]", attr(prefix, "src"))
			.on("img[srcset]", attr(prefix, "srcset", srcset))
			.on("source[srcset]", attr(prefix, "srcset", srcset))
			.on("form", { element: (el) => el.removeAttribute("action") })
			.transform(page);
	}
	if (type.includes("text/css")) {
		const css = (await upstream.text())
			.replace(/url\((['"]?)\/\/([^'")]+)\1\)/g, (_m, q, p) => `url(${q}https://${p}${q})`)
			.replace(/url\((['"]?)(\/w\/[^'")]+)\1\)/g, (_m, q, p) => `url(${q}https://${lang}.wikipedia.org${p}${q})`);
		return new Response(css, { status: upstream.status, headers });
	}
	return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const match = ROUTE.exec(url.pathname);
		if (!match) return env.ASSETS.fetch(request);
		if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
		return wiki(request, match[1] as string, match[2] as string, url.search);
	},
};
