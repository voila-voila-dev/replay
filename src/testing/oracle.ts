// The oracle: a normalized walk of the live page and of the copy, side by side. It knows the
// masking rule from the outside (what the copy must show), not how the recorder applies it.
//
// Ignored on purpose (the player does it by design, or it changes nothing shown): comments,
// script and noscript, <base>, event handler attributes, `target` on links, iframe src and
// srcdoc, meta http-equiv, a linked sheet the player serves from a blob, closed shadow roots.
// Compared: namespace, tag, attributes (URLs resolved), merged text, form state, :modal, the
// rules of each <style> and of adoptedStyleSheets, template content, open shadow roots,
// compatMode and the doctype.
import type { Mask } from "../record/index";

export interface OracleOptions {
	readonly mask?: Mask;
	readonly maskAttr?: string;
	readonly blockAttr?: string;
	readonly unmaskAttr?: string;
	readonly max?: number;
	readonly ignoreMode?: boolean;
}

export interface Diff {
	readonly path: string;
	readonly what: string;
	readonly live?: string;
	readonly copy?: string;
	/** The two elements around the difference, as HTML, to read a failure. */
	readonly around?: readonly [string, string];
}

const HTML = "http://www.w3.org/1999/xhtml";
const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
const URL_ATTR = /^(src|href|poster|action|formaction|data|xlink:href|cite|background)$/;
const SAFE_URL = /^(https?:|data:image\/|blob:|#|mailto:|tel:)/i;
const CSS_URL = /url\(\s*(['"]?)(?!data:|#|blob:)([^'")]+)\1\s*\)/g;
/** The attributes a masked zone leaves in clear: everything else shows as stars. */
const PLAIN =
	/^(class|id|style|type|role|width|height|src|srcset|sizes|href|rel|media|dir|lang|hidden|disabled|checked|selected|open|colspan|rowspan|for|name|contenteditable|tabindex|viewbox|d|fill|stroke|x|y|cx|cy|r|rx|ry|points|transform|xmlns|slot|part|draggable|loading|decoding|crossorigin|referrerpolicy|async|defer|multiple|readonly|required|min|max|step|autocomplete|inputmode|popover)$/i;
const NOT_TYPED = /^(button|submit|reset|image)$/;
const TOGGLE = /^(checkbox|radio)$/;
const STARS = "******";

const stars = (s: string) => s.replace(/\S/g, "*");
// Through the prototype: a form holding a field named `hasAttribute` hides the method.
const P = Element.prototype;
const hasA = (el: Element, n: string) => P.hasAttribute.call(el, n);
const getA = (el: Element, n: string) => P.getAttribute.call(el, n);
const getter = (name: string) => Object.getOwnPropertyDescriptor(P, name)?.get as (this: Element) => unknown;
const LOCAL = getter("localName");
const NS = getter("namespaceURI");
const ATTRS = getter("attributes");
const tagOf = (el: Element) => LOCAL.call(el) as string;
const nsOf = (el: Element) => NS.call(el) as string | null;
const attrsOf = (el: Element) => ATTRS.call(el) as NamedNodeMap;
const short = (v: unknown) => {
	const s = typeof v === "string" ? v : JSON.stringify(v);
	return s && s.length > 160 ? `${s.slice(0, 160)}…` : s;
};

export function compare(live: Document, copy: Document, o: OracleOptions = {}): Array<Diff> {
	const mode = o.mask || "inputs";
	const maskAttr = o.maskAttr || "data-va-mask";
	const blockAttr = o.blockAttr || "data-va-block";
	const unmaskAttr = o.unmaskAttr || "data-va-unmask";
	const diffs: Array<Diff> = [];
	const max = o.max || 6;
	const base = live.URL;
	let around: readonly [string, string] | undefined;
	const html = (n: Node) => {
		const s = n.nodeType === 1 ? (n as Element).outerHTML : n.nodeType === 11 ? `#root ${(n as ShadowRoot).innerHTML ?? ""}` : String(n.textContent);
		return s.length > 400 ? `${s.slice(0, 400)}…` : s;
	};
	const add = (path: string, what: string, a?: unknown, b?: unknown) => {
		if (diffs.length < max) diffs.push({ path, what, live: short(a), copy: short(b), ...(around ? { around } : {}) });
	};
	const abs = (u: string) => {
		try {
			return new URL(u, base).href;
		} catch {
			return u;
		}
	};
	const cssAbs = (t: string) => t.replace(CSS_URL, (_m, _q, u: string) => `url("${abs(u)}")`);
	// The player leaves out a name the copy's DOM refuses (`@click`, `:class` where the DOM still
	// holds attribute names to the XML rules): that browser cannot hold it outside the parser.
	const refused = (name: string) => {
		try {
			copy.createAttribute(name);
			return false;
		} catch {
			return true;
		}
	};
	const rules = (sheet: CSSStyleSheet) => {
		try {
			return Array.from(sheet.cssRules, (r) => r.cssText).join("\n");
		} catch {
			return "<illisible>";
		}
	};
	const adopted = (root: Document | ShadowRoot, live: boolean) =>
		Array.from(root.adoptedStyleSheets || [], (s) => (live ? cssAbs(rules(s)) : rules(s))).join(
			"\n---\n",
		);

	// biome-ignore lint/suspicious/noExplicitAny: form controls.
	const sensitive = (el: any) =>
		/^(password|hidden)$/i.test(el.type || "") ||
		/cc-|one-time-code|password/i.test(getA(el, "autocomplete") || "");
	const fieldHidden = (el: Element, masked: boolean, clear: boolean) => {
		if (sensitive(el)) return true;
		if (mode === "none") return masked;
		return !clear;
	};
	const shown = (v: string, hidden: boolean) => (hidden ? (v ? STARS : "") : v);
	const masksSelf = (el: Element) => {
		if (hasA(el, maskAttr)) return true;
		if (mode === "none") return false;
		const e = getA(el, "contenteditable");
		return e !== null && e.toLowerCase() !== "false" && !hasA(el, unmaskAttr);
	};

	function path(n: Node): string {
		const p: Array<string> = [];
		for (let x: Node | null = n; x && x.nodeType === 1; x = x.parentNode || (x as ShadowRoot).host || null) {
			const el = x as Element;
			p.unshift(tagOf(el) + (el.id ? `#${el.id}` : ""));
		}
		return p.join(">");
	}

	type Kid = Element | { nodeType: 3; data: string };
	function kids(n: Node): Array<Kid> {
		const out: Array<Kid> = [];
		const el = n as Element;
		const list =
			n.nodeType === 1 && tagOf(el) === "template" && nsOf(el) === HTML
				? (el as HTMLTemplateElement).content.childNodes
				: n.childNodes;
		for (const c of Array.from(list)) {
			if (c.nodeType === 3) {
				const data = (c as Text).data;
				if (!data) continue;
				const last = out[out.length - 1];
				if (last && last.nodeType === 3) (last as { data: string }).data += data;
				else out.push({ nodeType: 3, data });
			} else if (c.nodeType === 1) {
				const e = c as Element;
				const tag = tagOf(e);
				if (tag === "script" || tag === "replay-script" || tag === "base" || tag === "replay-base") continue;
				if (tag === "noscript" && nsOf(e) === HTML) continue;
				out.push(e);
			}
		}
		return out;
	}

	function attrs(el: Element, side: "live" | "copy", masked: boolean) {
		const m = new Map<string, string>();
		const tag = tagOf(el);
		for (const a of Array.from(attrsOf(el))) {
			const name = a.name;
			let v = a.value;
			if (/^on/i.test(name) || name === "http-equiv") continue;
			if (tag === "iframe" && /^(src|srcdoc)$/.test(name)) continue;
			if (tag === "a" && name === "target") continue;
			if (tag === "input" && (name === "value" || name === "checked")) continue;
			if (tag === "textarea" && name === "value") continue;
			if (tag === "option" && name === "selected") continue;
			if (
				tag === "link" &&
				name === "href" &&
				/stylesheet/i.test(getA(el, "rel") || "") &&
				(side === "copy" ? v.startsWith("blob:") : true)
			)
				continue;
			if (side === "live" && masked && !PLAIN.test(name)) v = stars(v);
			// The copy shows the picture the visitor's browser picked, whatever its own would.
			if (side === "live" && name === "srcset") {
				const parent = el.parentNode as Element | null;
				const img = (
					tag === "img"
						? el
						: tag === "source" && parent && tagOf(parent) === "picture"
							? Array.from(parent.children).find((c) => tagOf(c) === "img")
							: undefined
				) as HTMLImageElement | undefined;
				if (img?.currentSrc && img.currentSrc !== img.src) v = img.currentSrc;
			}
			if (URL_ATTR.test(name)) {
				v = abs(v);
				if (side === "live" && !SAFE_URL.test(v)) v = "about:blank";
			} else if (name === "srcset")
				v = v
					.split(",")
					.map((p) => {
						const [u, ...s] = p.trim().split(/\s+/);
						return [abs(u || ""), ...s].join(" ");
					})
					.join(", ");
			else if (name === "style" && side === "live") v = cssAbs(v);
			if (side === "live" && refused(name)) continue;
			m.set(name, v);
		}
		return m;
	}

	// biome-ignore lint/suspicious/noExplicitAny: form controls.
	function state(L: any, R: any, p: string, masked: boolean, clear: boolean) {
		const tag = tagOf(L);
		if (tag === "input") {
			const t = String(L.type);
			if (t !== "file" && t !== "hidden" && !NOT_TYPED.test(t) && !TOGGLE.test(t)) {
				const want = shown(L.value, fieldHidden(L, masked, clear));
				if (want !== R.value) add(p, "input.value", want, R.value);
			}
			if (L.checked !== R.checked) add(p, "input.checked", L.checked, R.checked);
		} else if (tag === "textarea") {
			const want = shown(L.value, fieldHidden(L, masked, clear));
			if (want !== R.value) add(p, "textarea.value", want, R.value);
		} else if (tag === "select") {
			// A single select shows its `selectedIndex`: Safari 16 may also report as chosen the
			// option given `selected` by script, which it does not show.
			const picked = (s: HTMLSelectElement) =>
				s.multiple || s.size > 1
					? Array.from(s.options, (x, i) => (x.selected ? i : -1))
							.filter((i) => i >= 0)
							.join(",")
					: s.selectedIndex < 0
						? ""
						: String(s.selectedIndex);
			let want = picked(L);
			if (fieldHidden(L, masked, clear)) {
				// A hidden choice: the copy shows what the markup alone selects.
				const options = Array.from(L.options as ArrayLike<HTMLOptionElement>);
				if (L.multiple || L.size > 1) want = options.map((x, i) => (hasA(x, "selected") ? i : -1)).filter((i) => i >= 0).join(",");
				else {
					let k = -1;
					options.forEach((x, i) => {
						if (hasA(x, "selected")) k = i;
					});
					if (k < 0) k = options.findIndex((x) => !x.disabled);
					want = k < 0 ? "" : String(k);
				}
			}
			if (want !== picked(R)) add(p, "select: options choisies", want, picked(R));
		} else if (tag === "dialog") {
			const modal = (d: Element) => {
				try {
					return d.matches(":modal");
				} catch {
					return null;
				}
			};
			if (modal(L) !== modal(R)) add(p, "dialog :modal", modal(L), modal(R));
			if (L.open !== R.open) add(p, "dialog.open", L.open, R.open);
		}
	}

	function element(L: Element, R: Element, masked: boolean, clear: boolean) {
		around = [html(L), html(R)];
		const p = path(L);
		const name = (e: Element) => `${nsOf(e) === HTML ? "" : `${nsOf(e)} `}<${tagOf(e)}>`;
		if (nsOf(L) !== nsOf(R) || tagOf(L) !== tagOf(R)) {
			add(p, "élément", name(L), name(R));
			return;
		}
		if (hasA(L, blockAttr)) {
			if (!hasA(R, "data-replay-blocked")) add(p, "élément bloqué rejoué", "(boîte)", R.outerHTML);
			return;
		}
		masked = masked || masksSelf(L);
		clear = clear || hasA(L, unmaskAttr);
		const a = attrs(L, "live", masked);
		const b = attrs(R, "copy", masked);
		for (const [k, v] of a) if (b.get(k) !== v) add(p, `@${k}`, v, b.has(k) ? b.get(k) : "(absent)");
		for (const [k, v] of b) if (!a.has(k)) add(p, `@${k}`, "(absent)", v);
		if (nsOf(L) === HTML) state(L, R, p, masked, clear);
		if (tagOf(L) === "style") {
			const x = (L as HTMLStyleElement).sheet ? cssAbs(rules((L as HTMLStyleElement).sheet as CSSStyleSheet)) : L.textContent;
			const y = (R as HTMLStyleElement).sheet ? rules((R as HTMLStyleElement).sheet as CSSStyleSheet) : R.textContent;
			if (x !== y) add(p, "règles CSS", x, y);
			return;
		}
		if (tagOf(L) === "textarea") return;
		if (nsOf(L) === HTML && VOID.test(tagOf(L))) return;
		const ls = L.shadowRoot;
		const rs = R.shadowRoot;
		if (ls) {
			if (!rs) add(p, "shadow root", true, false);
			else {
				list(ls, rs, `${p}/#shadow`, masked, clear);
				if (adopted(ls, true) !== adopted(rs, false))
					add(`${p}/#shadow`, "adoptedStyleSheets", adopted(ls, true), adopted(rs, false));
			}
		}
		list(L, R, p, masked, clear);
	}

	function list(L: Node, R: Node, p: string, masked: boolean, clear: boolean) {
		around = [html(L), html(R)];
		const x = kids(L);
		const y = kids(R);
		const n = Math.max(x.length, y.length);
		const show = (k: Kid | undefined) =>
			!k ? "" : k.nodeType === 3 ? (k as { data: string }).data : `<${(k as Element).localName}>`;
		for (let i = 0; i < n && diffs.length < max; i++) {
			const a = x[i];
			const b = y[i];
			if (!a || !b) {
				add(`${p}[${i}]`, a ? "nœud absent de la copie" : "nœud en trop dans la copie", show(a), show(b));
				break;
			}
			if (a.nodeType !== b.nodeType) {
				add(`${p}[${i}]`, "type de nœud", show(a), show(b));
				break;
			}
			if (a.nodeType === 3) {
				const parent = L.nodeType === 1 ? (L as Element).localName : "";
				const data = (a as { data: string }).data;
				const want = parent === "style" ? cssAbs(data) : masked ? stars(data) : data;
				if (want !== (b as { data: string }).data) add(`${p}[${i}]`, "texte", want, (b as { data: string }).data);
			} else element(a as Element, b as Element, masked, clear);
		}
	}

	if (!o.ignoreMode && live.compatMode !== copy.compatMode)
		add("#document", "compatMode", live.compatMode, copy.compatMode);
	const dt = (d: Document) => (d.doctype ? d.doctype.name : null);
	if (dt(live) !== dt(copy)) add("#document", "doctype", dt(live), dt(copy));
	if (adopted(live, true) !== adopted(copy, false))
		add("#document", "adoptedStyleSheets", adopted(live, true), adopted(copy, false));
	if (!copy.documentElement) add("#document", "documentElement", "<html>", null);
	else if (live.documentElement) element(live.documentElement, copy.documentElement, mode === "text", false);
	return diffs;
}
