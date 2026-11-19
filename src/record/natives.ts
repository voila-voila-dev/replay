// The DOM accessors the recorder reads through. The recorder loads after the page's own code,
// which may have wrapped them (zone.js and the like): when any of them is not native, they are
// all taken from a fresh realm, a blank iframe of the same origin, and called with `.call`.

export interface Natives {
	readonly first: (n: Node) => Node | null;
	readonly next: (n: Node) => Node | null;
	readonly parent: (n: Node) => Node | null;
	readonly attributes: (el: Element) => NamedNodeMap;
	readonly get: (el: Element, name: string) => string | null;
	readonly has: (el: Element, name: string) => boolean;
	readonly local: (el: Element) => string;
	readonly ns: (el: Element) => string | null;
	readonly rect: (el: Element) => DOMRect;
	readonly shadow: (el: Element) => ShadowRoot | null;
	readonly host: (root: ShadowRoot) => Element;
	readonly content: (template: HTMLTemplateElement) => DocumentFragment;
	readonly Observer: typeof MutationObserver;
}

type Realm = Window & typeof globalThis;

const NATIVE = /\{\s*\[native code\]\s*\}\s*$/;

function described(proto: object, name: string): PropertyDescriptor | undefined {
	for (let p: object | null = proto; p; p = Object.getPrototypeOf(p)) {
		const d = Object.getOwnPropertyDescriptor(p, name);
		if (d) return d;
	}
	return undefined;
}

function pieces(w: Realm) {
	const N = w.Node.prototype;
	const E = w.Element.prototype;
	const g = (proto: object, name: string) =>
		described(proto, name)?.get as (this: unknown) => unknown;
	const m = (proto: object, name: string) =>
		described(proto, name)?.value as (this: unknown, ...a: Array<unknown>) => unknown;
	return {
		first: g(N, "firstChild"),
		next: g(N, "nextSibling"),
		parent: g(N, "parentNode"),
		attributes: g(E, "attributes"),
		get: m(E, "getAttribute"),
		has: m(E, "hasAttribute"),
		local: g(E, "localName"),
		ns: g(E, "namespaceURI"),
		rect: m(E, "getBoundingClientRect"),
		shadow: g(E, "shadowRoot"),
		host: w.ShadowRoot ? g(w.ShadowRoot.prototype, "host") : undefined,
		content: w.HTMLTemplateElement
			? g(w.HTMLTemplateElement.prototype, "content")
			: undefined,
		Observer: w.MutationObserver,
	};
}

function untouched(p: ReturnType<typeof pieces>): boolean {
	const toString = Function.prototype.toString;
	for (const f of Object.values(p))
		if (typeof f === "function" && !NATIVE.test(toString.call(f))) return false;
	return true;
}

export function natives(w: Window): Natives {
	let p = pieces(w as Realm);
	if (!untouched(p)) {
		const d = w.document;
		const frame = d.createElement("iframe");
		frame.setAttribute("aria-hidden", "true");
		frame.style.display = "none";
		try {
			(d.body || d.documentElement).appendChild(frame);
			const fresh = frame.contentWindow as Realm | null;
			if (fresh) p = pieces(fresh);
		} catch {
			// No fresh realm: the page's own accessors, as they are.
		}
		frame.remove();
	}
	const { first, next, parent, attributes, get, has, local, ns, rect, shadow } = p;
	const host = p.host;
	const content = p.content;
	return {
		first: (n) => first.call(n) as Node | null,
		next: (n) => next.call(n) as Node | null,
		parent: (n) => parent.call(n) as Node | null,
		attributes: (el) => attributes.call(el) as NamedNodeMap,
		get: (el, name) => get.call(el, name) as string | null,
		has: (el, name) => has.call(el, name) as boolean,
		local: (el) => local.call(el) as string,
		ns: (el) => ns.call(el) as string | null,
		rect: (el) => rect.call(el) as DOMRect,
		shadow: (el) => (shadow ? (shadow.call(el) as ShadowRoot | null) : null),
		host: (root) => (host ? (host.call(root) as Element) : root.host),
		content: (t) => (content ? (content.call(t) as DocumentFragment) : t.content),
		Observer: p.Observer,
	};
}
