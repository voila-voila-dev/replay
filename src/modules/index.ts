// What the core leaves out, as code a site only ships when it needs it. Each module sees nodes
// already put in a zone by the core, and serializes through `kit.ser`.
import { Op } from "../format/index";
import type { Kit, Module, Zone } from "../record/index";

/** Shadow roots, closed ones included: `attachShadow` is watched from the start. */
export function shadow(): Module {
	const closed = new WeakMap<Element, ShadowRoot>();
	let kit: Kit;
	let restore: (() => void) | undefined;
	const rootOf = (el: Element) => kit.native.shadow(el) || closed.get(el) || null;
	return {
		name: "shadow",
		setup(k) {
			kit = k;
			const proto = (k.w as Window & typeof globalThis).Element.prototype;
			const original = proto.attachShadow;
			if (!original) return;
			proto.attachShadow = function (this: Element, init: ShadowRootInit) {
				const root = original.call(this, init);
				if (init.mode === "closed") closed.set(this, root);
				// A root added after the host was recorded: the host is recorded again.
				if (kit.id(this)) kit.redo(this);
				return root;
			};
			restore = () => {
				proto.attachShadow = original;
			};
		},
		onElement(el: Element, zone: Zone) {
			const root = rootOf(el);
			if (!root) return;
			kit.take(root, el);
			kit.push(Op.SHADOW, root.mode);
			for (let c = kit.native.first(root); c; c = kit.native.next(c)) kit.ser(c, zone);
			kit.push(Op.X);
			kit.observe(root);
			kit.listen(root);
		},
		inner: (n) => (n.nodeType === 1 ? rootOf(n as Element) : null),
		onStop: () => restore?.(),
	};
}

/** Iframes of the same origin: their document is recorded inside the page. */
export function iframes(): Module {
	let kit: Kit;
	const loaded = new WeakSet<Element>();
	const docOf = (el: Element): Document | null => {
		if (kit.native.local(el) !== "iframe") return null;
		try {
			return (el as HTMLIFrameElement).contentDocument;
		} catch {
			return null;
		}
	};
	return {
		name: "iframes",
		setup(k) {
			kit = k;
		},
		onElement(el: Element, zone: Zone) {
			const doc = kit.native.local(el) === "iframe" ? docOf(el) : null;
			if (kit.native.local(el) === "iframe" && !loaded.has(el)) {
				loaded.add(el);
				// A frame that navigates holds another document: recorded again.
				el.addEventListener("load", () => kit.redo(el));
			}
			if (!doc) return;
			kit.take(doc, el);
			kit.push(Op.FRAME);
			for (let c = kit.native.first(doc); c; c = kit.native.next(c)) kit.ser(c, zone);
			kit.push(Op.X);
			kit.observe(doc);
			kit.listen(doc);
		},
		inner: (n) => (n.nodeType === 1 ? docOf(n as Element) : null),
	};
}

/** 2D canvases, as pictures, at most every `everyMs`. Never in a masked or blocked zone. */
export function canvas(everyMs = 500, quality = 0.5): Module {
	let kit: Kit;
	const seen = new Set<HTMLCanvasElement>();
	const shown = new WeakMap<HTMLCanvasElement, string>();
	let timer: ReturnType<typeof setInterval> | undefined;
	return {
		name: "canvas",
		setup(k) {
			kit = k;
			timer = setInterval(() => {
				if (seen.size) kit.dirty();
			}, everyMs);
		},
		onElement(el: Element, zone: Zone) {
			if (zone === 0 && kit.native.local(el) === "canvas") seen.add(el as HTMLCanvasElement);
		},
		onSync() {
			seen.forEach((c) => {
				const id = kit.id(c);
				if (!id || !c.isConnected) {
					seen.delete(c);
					return;
				}
				if (!c.width || !c.height || kit.zone(c) !== 0) return;
				let url: string;
				try {
					url = c.toDataURL("image/webp", quality);
				} catch {
					// A canvas that drew something from another origin cannot be read.
					seen.delete(c);
					return;
				}
				if (shown.get(c) === url) return;
				shown.set(c, url);
				kit.push(Op.SHOT, 2, id, url);
			});
		},
		onStop: () => clearInterval(timer),
	};
}

/**
 * What scripts do to stylesheets: `insertRule`, `deleteRule`, `replace`, `replaceSync`, and
 * `adoptedStyleSheets`. A changed sheet is sent again whole, once per read at rest.
 */
export function cssom(): Module {
	let kit: Kit;
	const changed = new Set<CSSStyleSheet>();
	const adopting = new Set<Document | ShadowRoot>();
	const restores: Array<() => void> = [];

	const text = (sheet: CSSStyleSheet) => {
		let css = "";
		for (const rule of Array.from(sheet.cssRules)) css += rule.cssText;
		return css;
	};
	const send = (sheet: CSSStyleSheet) => {
		const node = sheet.ownerNode as Element | null;
		const id = node ? kit.id(node) : 0;
		if (node && !id) return;
		if (node && kit.zone(node) === 2) return;
		try {
			kit.push(Op.SHEET, id || 0, kit.sheet(sheet), text(sheet));
		} catch {
			// Another origin's sheet: the player loads it from its address.
		}
	};
	const adopt = (root: Document | ShadowRoot) => {
		const id = kit.id(root);
		const sheets = root.adoptedStyleSheets;
		if (!id || !sheets) return;
		const numbers: Array<number> = [];
		for (const s of sheets) {
			if (!kit.sheetKnown(s)) send(s);
			numbers.push(kit.sheet(s));
		}
		kit.push(Op.ADOPT, id, numbers.length, ...numbers);
	};

	return {
		name: "cssom",
		setup(k) {
			kit = k;
			const W = k.w as Window & typeof globalThis;
			const proto = W.CSSStyleSheet?.prototype as unknown as Record<string, unknown>;
			if (!proto) return;
			for (const method of ["insertRule", "deleteRule", "replace", "replaceSync"]) {
				const original = proto[method] as ((...a: Array<unknown>) => unknown) | undefined;
				if (typeof original !== "function") continue;
				proto[method] = function (this: CSSStyleSheet, ...args: Array<unknown>) {
					const out = original.apply(this, args);
					const mark = () => {
						changed.add(this);
						kit.dirty();
					};
					if (out && typeof (out as Promise<unknown>).then === "function")
						(out as Promise<unknown>).then(mark, () => {});
					else mark();
					return out;
				};
				restores.push(() => {
					proto[method] = original;
				});
			}
			for (const target of [W.Document?.prototype, W.ShadowRoot?.prototype]) {
				if (!target) continue;
				const d = Object.getOwnPropertyDescriptor(target, "adoptedStyleSheets");
				if (!d?.set || !d.get) continue;
				Object.defineProperty(target, "adoptedStyleSheets", {
					configurable: true,
					enumerable: d.enumerable,
					get: d.get,
					set(this: Document | ShadowRoot, v: Array<CSSStyleSheet>) {
						d.set?.call(this, v);
						adopting.add(this);
						kit.dirty();
					},
				});
				restores.push(() => Object.defineProperty(target, "adoptedStyleSheets", d));
			}
		},
		onElement(el: Element) {
			const root = kit.native.shadow(el);
			if (root?.adoptedStyleSheets?.length) adopting.add(root);
		},
		onSnap() {
			if (kit.d.adoptedStyleSheets?.length) adopting.add(kit.d);
		},
		onSync() {
			if (changed.size) {
				for (const s of changed) if (kit.sheetKnown(s) || s.ownerNode) send(s);
				changed.clear();
			}
			if (adopting.size) {
				for (const root of adopting) adopt(root);
				adopting.clear();
			}
		},
		onStop() {
			for (const f of restores) f();
		},
	};
}
