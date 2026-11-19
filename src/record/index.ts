// The recorder. It walks the page once into a tape, then keeps the tape in step: the
// MutationObserver only notes what changed, and the page is read at rest, at most every
// `rate` ms. What the visitor does (pointer, taps, scroll, focus, size) is written at once,
// with its own tick, never sampled with the DOM.
//
// Masking is decided here, for every node, before any module sees it: a module serializes
// through `kit.ser`, which applies the same rule.
import { End, FNV_START, fnv, Op, type Tape, VERSION } from "../format/index";
import { type Natives, natives } from "./natives";

export type Mask = "inputs" | "text" | "none";
/** 0 clear, 1 masked, 2 blocked */
export type Zone = 0 | 1 | 2;

export interface Options {
	/** What is hidden: `inputs` (what is typed, the default), `text` (every text too), `none`. */
	readonly mask?: Mask;
	/** Text and attributes under an element with this attribute are recorded as stars. */
	readonly maskAttr?: string;
	/** An element with this attribute is recorded as an empty box of its size. */
	readonly blockAttr?: string;
	/** A field under this attribute is recorded in clear (never a password or a card number). */
	readonly unmaskAttr?: string;
	/** The page is read at most once per this many milliseconds. */
	readonly rate?: number;
	/** Bytes of tape, roughly, a page view may take before recording stops. */
	readonly budget?: number;
	/** Milliseconds between two fingerprints of the page (PRINT); 0: none. */
	readonly printEvery?: number;
	readonly modules?: ReadonlyArray<Module>;
}

export interface Kit {
	readonly w: Window;
	readonly d: Document;
	readonly native: Natives;
	/** Serializes a node under a zone, through the masking rule. */
	readonly ser: (n: Node, zone: Zone) => void;
	readonly push: (...tokens: Tape) => void;
	/** Puts a tick on the tape when time went by. */
	readonly stamp: () => void;
	readonly id: (n: Node) => number | undefined;
	/** Numbers a root (a shadow root, a frame's document) and ties it to its host. */
	readonly take: (root: Node, host: Element) => number;
	readonly zone: (n: Node) => Zone;
	/** The number of a stylesheet, given once per sheet and page view. */
	readonly sheet: (s: CSSStyleSheet) => number;
	readonly sheetKnown: (s: CSSStyleSheet) => boolean;
	readonly observe: (root: Node) => void;
	readonly listen: (root: Document | ShadowRoot) => void;
	/** Records an element again from scratch, at the next read. */
	readonly redo: (el: Element) => void;
	/** Asks for a read at rest. */
	readonly dirty: () => void;
	readonly masked: (s: string) => string;
}

export interface Module {
	readonly name: string;
	/** Once, as the recorder starts. */
	setup?(kit: Kit): void;
	/** On each element, once its attributes are on the tape and before its children. */
	onElement?(el: Element, zone: Zone): void;
	/** The tree an element holds besides its children: a shadow root, a frame's document. */
	inner?(n: Node): Node | null | undefined;
	/** At the end of each read at rest. */
	onSync?(): void;
	/** At the end of each snapshot. */
	onSnap?(): void;
	onStop?(): void;
}

export interface Snapshot {
	readonly tape: Tape;
	/** Where the tape can be cut into pieces that stay the same from one visitor to the next. */
	readonly cuts: ReadonlyArray<number>;
	readonly base: number;
	readonly startedAt: number;
	readonly endedAt: number;
}

export interface Drained {
	readonly tape: Tape;
	/** The number the first node made in this tape takes. */
	readonly base: number;
	readonly startedAt: number;
	readonly endedAt: number;
}

export interface Recorder {
	/** Records the page as it is and starts numbering nodes again. */
	snap(): Snapshot;
	/** What happened since the last call. */
	drain(): Drained;
	/** Stops; `reason` is written on the tape, for the next drain. */
	stop(reason?: End): void;
	readonly stopped: boolean;
	/** True when the next thing to send must be a new snapshot (a module failed mid-way). */
	readonly needsSnap: boolean;
}

const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const MATHML = "http://www.w3.org/1998/Math/MathML";
const STARS = "******";
const NOT_TYPED = /^(button|submit|reset|image)$/;
const TOGGLE = /^(checkbox|radio)$/;
const SENSITIVE_AUTOCOMPLETE = /cc-|one-time-code|password/i;
/** Attributes that stay in clear in a masked zone: they say nothing about the visitor. */
const PLAIN =
	/^(class|id|style|type|role|width|height|src|srcset|sizes|href|rel|media|dir|lang|hidden|disabled|checked|selected|open|colspan|rowspan|for|name|contenteditable|tabindex|viewbox|d|fill|stroke|x|y|cx|cy|r|rx|ry|points|transform|xmlns|slot|part|draggable|loading|decoding|crossorigin|referrerpolicy|async|defer|multiple|readonly|required|min|max|step|autocomplete|inputmode|popover)$/i;

/** The recorder starts on Safari 15.4, Chrome 92, Firefox 90 and later: `Array.prototype.at`. */
export function supported(w: Window): boolean {
	const W = w as Window & typeof globalThis;
	return (
		typeof W.Array?.prototype.at === "function" &&
		typeof W.MutationObserver === "function" &&
		typeof W.WeakMap === "function"
	);
}

export function record(w: Window, o: Options = {}): Recorder | null {
	if (!supported(w)) return null;
	const d = w.document;
	const N = natives(w);
	const mode: Mask = o.mask || "inputs";
	const maskAttr = o.maskAttr || "data-va-mask";
	const blockAttr = o.blockAttr || "data-va-block";
	const unmaskAttr = o.unmaskAttr || "data-va-unmask";
	const rate = o.rate ?? 50;
	const budget = o.budget ?? 8_000_000;
	const printEvery = o.printEvery ?? 30_000;
	const modules = [...(o.modules || [])];
	const now = () => Math.round(w.performance.now());

	let ids = new WeakMap<Node, number>();
	let seq = 0;
	let tape: Tape = [];
	/** The number the first node made since the last drain takes. */
	let base = 1;
	let last = now();
	let t0 = Date.now() - last;
	let firstAt = 0;
	let cuts: Array<number> | undefined;
	let scanned = 0;
	let bytes = 0;
	let cutAt = 0;
	let spent = 0;
	let timer: ReturnType<typeof setTimeout> | 0 = 0;
	let lastPrint = 0;
	let stopped = false;
	let ended: End | 0 = 0;

	let dels: Array<number> = [];
	let sheetQueue: Array<Element> = [];
	let sheetIds = new WeakMap<CSSStyleSheet, number>();
	let sheetSeq = 0;
	const dAttr = new Map<Element, Set<string>>();
	const dText = new Set<Node>();
	const dKids = new Map<Node, Set<Node>>();
	/** Nodes taken out of their parent and still in the page, with the number they had. */
	const left = new Map<Node, number>();
	/**
	 * Nodes forgotten with an ancestor during this read, with the number they had. Forgetting
	 * walks the page as it is now, so it takes along nodes moved into that ancestor since the last
	 * read, which the copy still holds where they were: their own removal says where.
	 */
	const gone = new Map<Node, number>();
	/** Roots (template content, shadow roots, frame documents) and what holds them. */
	const owner = new WeakMap<Node, Element>();
	/** Form controls, dialogs and popovers, and the value last written for each. */
	const fields = new Set<Element>();
	const written = new WeakMap<Element, string | number>();
	/** The zone each node was recorded under: a node moved to another zone is recorded again. */
	const recordedIn = new WeakMap<Node, Zone>();

	const stars = (s: string) => s.replace(/\S/g, "*");
	const isEl = (n: Node): n is Element => n.nodeType === 1;
	const has = (el: Element, name: string) => N.has(el, name);

	// --- Zones and masking -------------------------------------------------------------

	function up(n: Node): Node | null {
		const p = N.parent(n);
		if (p) return p;
		if (n.nodeType === 11) return owner.get(n) || (n as ShadowRoot).host || null;
		if (n.nodeType === 9) return owner.get(n) || null;
		return null;
	}

	/** Whether an element makes its subtree masked, by itself. */
	function masksSelf(el: Element): boolean {
		if (has(el, maskAttr)) return true;
		if (mode === "none") return false;
		const editable = N.get(el, "contenteditable");
		return (
			editable !== null && editable.toLowerCase() !== "false" && !has(el, unmaskAttr)
		);
	}

	function zoneOf(n: Node): Zone {
		let z: Zone = mode === "text" ? 1 : 0;
		for (let p: Node | null = n; p; p = up(p))
			if (isEl(p)) {
				if (has(p, blockAttr)) return 2;
				if (z === 0 && masksSelf(p)) z = 1;
			}
		return z;
	}

	function unmasked(el: Element): boolean {
		for (let p: Node | null = el; p; p = up(p))
			if (isEl(p) && has(p, unmaskAttr)) return true;
		return false;
	}

	// biome-ignore lint/suspicious/noExplicitAny: form controls, read by duck typing.
	function sensitive(el: any): boolean {
		const type = String(el.type || "").toLowerCase();
		return (
			type === "password" ||
			type === "hidden" ||
			SENSITIVE_AUTOCOMPLETE.test(N.get(el, "autocomplete") || "")
		);
	}

	/** Whether what a field holds is hidden. */
	function fieldMasked(el: Element, zone: Zone): boolean {
		if (sensitive(el)) return true;
		if (mode === "none") return zone !== 0;
		return !unmasked(el);
	}

	const value = (v: string, hidden: boolean) => (hidden ? (v ? STARS : "") : v);

	/** An attribute as it goes on the tape; undefined: left out. */
	function attr(el: Element, tag: string, name: string, v: string, zone: Zone) {
		if (/^on/i.test(name)) return undefined;
		if (name === "value" && (tag === "input" || tag === "textarea")) {
			const type = String((el as HTMLInputElement).type || "").toLowerCase();
			if (type === "hidden") return undefined;
			if (!NOT_TYPED.test(type) && !TOGGLE.test(type))
				return value(v, fieldMasked(el, zone));
		}
		if (zone === 1 && !PLAIN.test(name)) return stars(v);
		return v;
	}

	/** What a text node shows, as it goes on the tape. */
	function text(n: Node, data: string, zone: Zone): string {
		const p = N.parent(n);
		const tag = p && isEl(p) ? N.local(p) : "";
		if (tag === "style") return data;
		if (tag === "textarea") return value(data, fieldMasked(p as Element, zone));
		return zone === 1 ? stars(data) : data;
	}

	/** The select an option belongs to, through an optgroup. */
	function selectOf(option: Element): HTMLSelectElement | null {
		for (let p = N.parent(option), k = 0; p && k < 2; p = N.parent(p), k++)
			if (isEl(p) && N.local(p) === "select") return p as HTMLSelectElement;
		return null;
	}
	/**
	 * The options the markup alone selects: what a masked select shows, so that nothing the
	 * visitor chose leaves the page, and the copy does not keep a choice of its own.
	 */
	let picks = new Map<HTMLSelectElement, Set<Element>>();
	function defaults(select: HTMLSelectElement): Set<Element> {
		let set = picks.get(select);
		if (set) return set;
		set = new Set();
		const options = Array.from(select.options);
		if (select.multiple || select.size > 1) {
			for (const o of options) if (has(o, "selected")) set.add(o);
		} else {
			let pick: Element | undefined;
			for (const o of options) if (has(o, "selected")) pick = o;
			pick ||= options.find((o) => !o.disabled);
			if (pick) set.add(pick);
		}
		picks.set(select, set);
		return set;
	}

	/** A field's current state, as VAL writes it. */
	// biome-ignore lint/suspicious/noExplicitAny: form controls, read by duck typing.
	function state(el: any, zone: Zone): string | number | undefined {
		const tag = N.local(el);
		if (tag === "option") {
			const select = selectOf(el);
			if (select && (zone === 2 || fieldMasked(select, zoneOf(select)))) return defaults(select).has(el) ? 1 : 0;
			return el.selected ? 1 : 0;
		}
		if (tag === "dialog") return undefined;
		const type = String(el.type || "").toLowerCase();
		if (type === "hidden" || type === "file") return undefined;
		if (TOGGLE.test(type)) return el.checked ? 1 : 0;
		if (NOT_TYPED.test(type)) return undefined;
		return value(String(el.value ?? ""), fieldMasked(el, zone));
	}

	/** The state a field has from its markup alone, before anyone touches it. */
	// biome-ignore lint/suspicious/noExplicitAny: form controls, read by duck typing.
	function initial(el: any, zone: Zone): string | number | undefined {
		const tag = N.local(el);
		if (tag === "option") return has(el, "selected") ? 1 : 0;
		const type = String(el.type || "").toLowerCase();
		if (TOGGLE.test(type)) return has(el, "checked") ? 1 : 0;
		if (tag === "textarea")
			return value(String(el.defaultValue ?? ""), fieldMasked(el, zone));
		return value(N.get(el, "value") || "", fieldMasked(el, zone));
	}

	function openState(el: Element): number {
		let s = 0;
		try {
			if (el.matches(":modal")) return 2;
		} catch {}
		if (N.local(el) === "dialog") s = has(el, "open") ? 1 : 0;
		try {
			if (el.matches(":popover-open")) s = 1;
		} catch {}
		return s;
	}

	// --- Serialization -----------------------------------------------------------------

	function cut(mark: number, name: string) {
		if (!cuts) return;
		for (; scanned < tape.length; scanned++) {
			const t = tape[scanned];
			bytes += typeof t === "string" ? Math.min(t.length, 64) + 3 : 3;
		}
		const size = bytes - cutAt;
		if (size < 512) return;
		let h = fnv(FNV_START, tape.length - mark);
		for (let i = 0; i < name.length; i++) h = fnv(h, name.charCodeAt(i));
		if ((h & 63) === 0 || size >= 16_384) {
			cuts.push(tape.length);
			cutAt = bytes;
		}
	}

	function ser(n: Node, zone: Zone) {
		const known = ids.get(n);
		if (known) {
			if (recordedIn.get(n) === zone) {
				tape.push(Op.R, known);
				if (isEl(n) && N.local(n) === "option") {
					const select = selectOf(n);
					if (select) for (const o of Array.from(select.options)) written.delete(o);
				}
				return;
			}
			tape.push(Op.DEL, known);
			forget(n);
		}
		recordedIn.set(n, zone);
		const type = n.nodeType;
		if (type === 3) {
			ids.set(n, ++seq);
			tape.push(Op.T, text(n, (n as Text).data, zone));
			return;
		}
		if (type === 10) {
			const t = n as DocumentType;
			ids.set(n, ++seq);
			tape.push(Op.D, t.name, t.publicId, t.systemId);
			return;
		}
		if (type !== 1) return;
		const el = n as Element;
		const tag = N.local(el);
		const ns = N.ns(el);
		if (tag === "script" || (tag === "noscript" && ns === HTML)) return;
		const name =
			ns === HTML || ns === null
				? tag
				: `${ns === SVG ? "s" : ns === MATHML ? "m" : ns} ${tag}`;
		if (zone !== 2 && has(el, blockAttr)) zone = 2;
		ids.set(n, ++seq);
		if (tag === "option" && ns === HTML) {
			// An option inserted makes the browser pick again, in the copy too: every option of its
			// select is sent again.
			const select = selectOf(el);
			if (select) for (const o of Array.from(select.options)) written.delete(o);
			fields.add(el);
		}
		if (zone === 2) {
			const box = N.rect(el);
			tape.push(Op.B, name, Math.round(box.width), Math.round(box.height));
			return;
		}
		if (zone === 0 && masksSelf(el)) zone = 1;
		const mark = tape.length;
		tape.push(Op.E, name, 0);
		const list = N.attributes(el);
		let count = 0;
		for (let i = 0; i < list.length; i++) {
			const a = list[i] as Attr;
			const v = attr(el, tag, a.name, a.value, zone);
			if (v === undefined) continue;
			tape.push(a.name, v);
			count++;
		}
		tape[mark + 2] = count;
		if (ns === HTML) {
			if (tag === "input" || tag === "textarea" || tag === "option") {
				fields.add(el);
				// A textarea's text may lie in several nodes, each masked alone: its value is always sent.
				const v = tag === "input" ? initial(el, zone) : undefined;
				if (v === undefined) written.delete(el);
				else written.set(el, v);
			} else if (tag === "dialog" || has(el, "popover")) {
				fields.add(el);
				written.set(el, tag === "dialog" && has(el, "open") ? 1 : 0);
			} else if (
				tag === "style" ||
				(tag === "link" && /stylesheet/i.test(N.get(el, "rel") || ""))
			)
				sheetQueue.push(el);
		}
		for (const m of modules) if (m.onElement) guard(m, () => m.onElement?.(el, zone));
		if (tag === "template" && ns === HTML) {
			const content = N.content(el as HTMLTemplateElement);
			ids.set(content, ++seq);
			owner.set(content, el);
			observe(content);
			tape.push(Op.TPL);
			for (let c = N.first(content); c; c = N.next(c)) ser(c, zone);
			tape.push(Op.X);
		}
		for (let c = N.first(el); c; c = N.next(c)) ser(c, zone);
		tape.push(Op.X);
		cut(mark, name);
	}

	function forget(n: Node, inner?: 1) {
		const id = ids.get(n);
		if (!id) return;
		ids.delete(n);
		if (inner) gone.set(n, id);
		if (isEl(n)) {
			fields.delete(n);
			if (N.local(n) === "template") forget(N.content(n as HTMLTemplateElement), 1);
		}
		for (let c = N.first(n); c; c = N.next(c)) forget(c, 1);
		for (const m of modules) {
			const tree = m.inner ? safe(m, () => m.inner?.(n)) : null;
			if (tree) forget(tree, 1);
		}
	}

	// --- Modules -----------------------------------------------------------------------

	const off = new Set<Module>();
	/** Set when a module failed halfway through numbering nodes: only a new snapshot is safe. */
	let resnap = false;
	function guard(m: Module, f: () => void) {
		if (off.has(m)) return;
		const mark = tape.length;
		const numbered = seq;
		try {
			f();
		} catch {
			off.add(m);
			tape.length = mark;
			if (seq !== numbered) {
				seq = numbered;
				resnap = true;
			}
			tape.push(Op.ERR, 1, m.name);
		}
	}
	function safe<T>(m: Module, f: () => T): T | undefined {
		let out: T | undefined;
		guard(m, () => {
			out = f();
		});
		return out;
	}

	// --- Time and gestures ---------------------------------------------------------------

	function stamp() {
		const t = now();
		if (!firstAt) firstAt = t;
		if (t > last) {
			tape.push(Op.TICK, t - last);
			last = t;
		}
	}

	/** The nearest recorded node at or above `n`. */
	function nearest(n: Node | null): number {
		for (let p = n; p; p = up(p)) {
			const id = ids.get(p);
			if (id) return id;
		}
		return 0;
	}

	let moveAt = 0;
	let moveTimer: ReturnType<typeof setTimeout> | 0 = 0;
	let px = 0;
	let py = 0;
	let movePending = false;
	function move() {
		moveTimer = 0;
		if (!movePending || stopped) return;
		movePending = false;
		moveAt = now();
		stamp();
		tape.push(Op.MOVE, px, py);
	}

	const scrolled = new Set<Node>();
	let scrollTimer: ReturnType<typeof setTimeout> | 0 = 0;
	function scrolls() {
		scrollTimer = 0;
		if (stopped) return;
		stamp();
		scrolled.forEach((n) => {
			const id = ids.get(n);
			const el = (n.nodeType === 9 ? (n as Document).scrollingElement : n) as Element | null;
			if (id && el) tape.push(Op.SCROLL, n === d ? 1 : id, Math.round(el.scrollLeft), Math.round(el.scrollTop));
		});
		scrolled.clear();
	}

	let sizeTimer: ReturnType<typeof setTimeout> | 0 = 0;
	function size() {
		sizeTimer = 0;
		if (stopped) return;
		stamp();
		tape.push(Op.SIZE, w.innerWidth, w.innerHeight);
	}

	/** An event's position, in the top page's coordinates. */
	function point(e: MouseEvent): [number, number] {
		let x = e.clientX;
		let y = e.clientY;
		let view = (e.view || (e.target as Node)?.ownerDocument?.defaultView) as Window | null;
		while (view && view !== w) {
			const frame = view.frameElement;
			if (!frame) break;
			const r = frame.getBoundingClientRect();
			x += r.left + frame.clientLeft;
			y += r.top + frame.clientTop;
			view = frame.ownerDocument.defaultView;
		}
		return [Math.round(x), Math.round(y)];
	}

	const stops: Array<() => void> = [];
	function listen(root: Document | ShadowRoot) {
		const on = (type: string, f: (e: never) => void) => {
			const listener = f as EventListener;
			root.addEventListener(type, listener, { capture: true, passive: true });
			stops.push(() => root.removeEventListener(type, listener, true));
		};
		const target = (e: Event) =>
			((e.composedPath ? e.composedPath()[0] : e.target) || null) as Node | null;
		on("pointermove", (e: PointerEvent) => {
			[px, py] = point(e);
			movePending = true;
			const wait = 20 - (now() - moveAt);
			if (wait <= 0) move();
			else if (!moveTimer) moveTimer = setTimeout(move, wait);
		});
		const tap = (kind: number) => (e: MouseEvent) => {
			if (movePending) move();
			const [x, y] = point(e);
			stamp();
			tape.push(Op.TAP, kind, nearest(target(e)), x, y);
		};
		on("pointerdown", tap(1));
		on("pointerup", tap(2));
		on("click", tap(3));
		on("scroll", (e: Event) => {
			const t = target(e);
			if (!t) return;
			scrolled.add(t.nodeType === 9 || t === d.documentElement ? d : t);
			if (!scrollTimer) scrollTimer = setTimeout(scrolls, 16);
		});
		on("focusin", (e: FocusEvent) => {
			stamp();
			tape.push(Op.FOCUS, nearest(target(e)));
		});
		on("focusout", (e: FocusEvent) => {
			if (e.relatedTarget) return;
			stamp();
			tape.push(Op.FOCUS, 0);
		});
		const typed = () => kick();
		on("input", typed);
		on("change", typed);
	}

	// --- Mutations -------------------------------------------------------------------------

	function kick() {
		if (timer || stopped) return;
		// biome-ignore lint/suspicious/noExplicitAny: requestIdleCallback is missing on Safari.
		const idle = (w as any).requestIdleCallback as
			| ((f: () => void, o: { timeout: number }) => void)
			| undefined;
		timer = setTimeout(() => (idle ? idle(sync, { timeout: 100 }) : sync()), rate);
	}

	/** Out of the page, a node is no longer observed: it leaves now, and comes back as a new one. */
	function drop(n: Node) {
		const id = ids.get(n) || gone.get(n);
		if (id) {
			dels.push(id);
			forget(n);
			return;
		}
		for (let c = N.first(n); c; c = N.next(c)) drop(c);
		for (const m of modules) {
			const tree = m.inner ? safe(m, () => m.inner?.(n)) : null;
			if (tree) drop(tree);
		}
	}

	/** True when the children of `n` are recorded. */
	const open = (n: Node | null) => !!n && ids.has(n) && !(isEl(n) && has(n, blockAttr));

	function touch(parent: Node, n: Node) {
		let set = dKids.get(parent);
		if (!set) dKids.set(parent, (set = new Set()));
		set.add(n);
	}

	function redo(el: Element) {
		if (!ids.has(el)) return;
		const p = N.parent(el) || owner.get(el) || null;
		drop(el);
		if (p && open(p)) touch(p, el);
		kick();
	}

	const ZONE_ATTRS = new Set([blockAttr, maskAttr, unmaskAttr, "contenteditable"]);

	function seen(records: Array<MutationRecord>) {
		if (!records.length) return;
		for (const r of records) {
			const target = r.target;
			if (r.type === "childList") {
				const removed = r.removedNodes;
				for (let i = 0; i < removed.length; i++) {
					const n = removed[i] as Node;
					if (!n.isConnected) drop(n);
					else {
						const id = ids.get(n) || gone.get(n);
						if (id) left.set(n, id);
					}
				}
				if (open(target)) {
					r.addedNodes.forEach((n) => touch(target, n));
					removed.forEach((n) => touch(target, n));
				}
			} else if (ids.has(target)) {
				if (r.type === "attributes") {
					const name = r.attributeName as string;
					if (ZONE_ATTRS.has(name)) {
						redo(target as Element);
						continue;
					}
					let names = dAttr.get(target as Element);
					if (!names) dAttr.set(target as Element, (names = new Set()));
					names.add(name);
				} else dText.add(target);
			}
		}
		kick();
	}

	const observer = new N.Observer(seen);
	const observe = (root: Node) =>
		observer.observe(root, {
			childList: true,
			attributes: true,
			characterData: true,
			subtree: true,
		});

	function sync() {
		timer = 0;
		if (stopped) return;
		seen(observer.takeRecords());
		timer = 0;
		const before = tape.length;
		const lastBefore = last;
		stamp();
		const start = tape.length;

		for (const id of dels) tape.push(Op.DEL, id);
		dels = [];

		// Nodes numbered from here on are recorded as they are now: nothing more to say about
		// them in this read.
		const fresh = seq + 1;
		const zones = new Map<Node, Zone>();
		const zone = (n: Node) => {
			let z = zones.get(n);
			if (z === undefined) zones.set(n, (z = zoneOf(n)));
			return z;
		};
		dKids.forEach((touched, parent) => {
			const pid = ids.get(parent);
			if (!pid || pid >= fresh) return;
			const z = zone(parent);
			touched.forEach((t) => {
				if (N.parent(t) !== parent) return;
				// A run of touched siblings starts after an untouched recorded one (or at the start)
				// and goes before the next one. Nodes never recorded (comments, scripts) are seen through.
				let s = t.previousSibling;
				while (s && !touched.has(s) && !ids.has(s)) s = s.previousSibling;
				if (s && touched.has(s)) return;
				const run: Array<Node> = [];
				let n: Node | null = t;
				for (; n; n = N.next(n))
					if (touched.has(n)) run.push(n);
					else if (ids.has(n)) break;
				const mark = tape.length;
				tape.push(Op.INS, pid, n ? (ids.get(n) as number) : 0);
				for (const node of run) ser(node, z);
				if (tape.length === mark + 3) tape.length = mark;
				else tape.push(Op.X);
			});
		});
		dKids.clear();
		// A moved node the copy still holds where it was: forgotten since with what held it, or
		// now where nothing is recorded (a blocked element).
		left.forEach((id, n) => {
			if (ids.get(n) !== id) tape.push(Op.DEL, id);
			else if (!(n.isConnected && open(N.parent(n) || owner.get(n) || null))) {
				tape.push(Op.DEL, id);
				forget(n);
			}
		});
		left.clear();
		gone.clear();

		dAttr.forEach((names, el) => {
			const id = ids.get(el);
			if (!id || id >= fresh) return;
			const z = zone(el);
			if (z === 2) return;
			const tag = N.local(el);
			names.forEach((name) => {
				const v = N.get(el, name);
				const out = v === null ? null : attr(el, tag, name, v, z);
				if (out !== undefined) tape.push(Op.ATTR, id, name, out);
			});
		});
		dAttr.clear();
		dText.forEach((n) => {
			const id = ids.get(n);
			if (id && id < fresh) tape.push(Op.TEXT, id, text(n, (n as Text).data, zone(n)));
		});
		dText.clear();

		picks = new Map();
		fields.forEach((el) => {
			const id = ids.get(el);
			if (!id) return;
			const tag = N.local(el);
			let v: string | number | undefined;
			let op: Op = Op.VAL;
			if (tag === "dialog" || has(el, "popover")) {
				v = openState(el);
				op = Op.OPEN;
			} else v = state(el, zone(el));
			if (v === undefined || written.get(el) === v) return;
			written.set(el, v);
			tape.push(op, id, v);
		});

		readSheets();
		for (const m of modules) if (m.onSync) guard(m, () => m.onSync?.());

		if (printEvery && last - lastPrint >= printEvery) {
			lastPrint = last;
			const [count, hash] = fingerprintOf(d);
			tape.push(Op.PRINT, count, hash);
		}

		if (tape.length === start) {
			tape.length = before;
			last = lastBefore;
		}
	}

	function readSheets() {
		for (const el of sheetQueue.splice(0)) {
			const id = ids.get(el);
			if (!id) continue;
			try {
				const sheet = (el as HTMLLinkElement).sheet;
				if (!sheet) {
					el.addEventListener(
						"load",
						() => {
							sheetQueue.push(el);
							kick();
						},
						{ once: true },
					);
					continue;
				}
				// The rules of a <style> are in its text, unless a script put them there (CSS-in-JS).
				if (N.local(el) === "style" && (!sheet.cssRules.length || (el.textContent || "").trim()))
					continue;
				let css = "";
				for (const rule of Array.from(sheet.cssRules)) css += rule.cssText;
				tape.push(Op.SHEET, id, kit.sheet(sheet), css);
			} catch {
				// A stylesheet from another origin: the player loads it from its address.
			}
		}
	}

	/** Nodes and a hash of the page's shape, as the player computes it of its copy. */
	function fingerprintOf(root: Node): [number, number] {
		let count = 0;
		let h = FNV_START;
		const walk = (n: Node) => {
			for (let c = N.first(n); c; c = N.next(c)) {
				if (!ids.has(c)) continue;
				count++;
				h = fnv(h, c.nodeType);
				if (isEl(c)) {
					const tag = N.local(c);
					h = fnv(h, tag.length);
					h = fnv(h, tag.charCodeAt(0));
					if (has(c, blockAttr)) continue;
					if (tag === "template") walk(N.content(c as HTMLTemplateElement));
					walk(c);
				}
			}
		};
		walk(root);
		return [count, h];
	}

	// --- The kit and the recorder ------------------------------------------------------------

	const kit: Kit = {
		w,
		d,
		native: N,
		ser,
		push: (...tokens) => {
			tape.push(...tokens);
		},
		stamp,
		id: (n) => ids.get(n),
		take: (root, host) => {
			ids.set(root, ++seq);
			owner.set(root, host);
			return seq;
		},
		zone: zoneOf,
		sheet: (s) => {
			let k = sheetIds.get(s);
			if (k === undefined) sheetIds.set(s, (k = ++sheetSeq));
			return k;
		},
		sheetKnown: (s) => sheetIds.has(s),
		observe,
		listen,
		redo,
		dirty: kick,
		masked: stars,
	};

	const onResize = () => {
		if (!sizeTimer) sizeTimer = setTimeout(size, 100);
	};
	const onHide = () => {
		stamp();
		tape.push(Op.HIDE, d.hidden ? 1 : 0);
	};
	w.addEventListener("resize", onResize);
	d.addEventListener("visibilitychange", onHide);
	listen(d);
	observe(d);
	const poll = setInterval(() => {
		if (fields.size) kick();
	}, 500);
	for (const m of modules) if (m.setup) guard(m, () => m.setup?.(kit));

	function weigh(t: Tape) {
		for (const token of t) spent += typeof token === "string" ? token.length + 3 : 3;
		if (spent > budget && !stopped) stop(End.Budget);
	}

	function stop(reason?: End) {
		if (stopped) return;
		stopped = true;
		if (reason) ended = reason;
		observer.disconnect();
		clearTimeout(timer as number);
		clearTimeout(moveTimer as number);
		clearTimeout(scrollTimer as number);
		clearTimeout(sizeTimer as number);
		clearInterval(poll);
		w.removeEventListener("resize", onResize);
		d.removeEventListener("visibilitychange", onHide);
		for (const f of stops) f();
		for (const m of modules) if (m.onStop) guard(m, () => m.onStop?.());
	}

	return {
		snap() {
			ids = new WeakMap();
			sheetIds = new WeakMap();
			sheetSeq = 0;
			seq = 1;
			ids.set(d, 1);
			dels = [];
			sheetQueue = [];
			dAttr.clear();
			dText.clear();
			dKids.clear();
			left.clear();
			gone.clear();
			fields.clear();
			observer.takeRecords();
			last = now();
			t0 = Date.now() - last;
			lastPrint = last;
			// What was on the tape before belongs to the page as it was: dropped.
			tape = [
				Op.META,
				VERSION,
				d.URL,
				t0 + last,
				w.innerWidth,
				w.innerHeight,
				d.compatMode === "BackCompat" ? 1 : 0,
			];
			cuts = [tape.length];
			scanned = bytes = cutAt = 0;
			for (let c = N.first(d); c; c = N.next(c)) ser(c, mode === "text" ? 1 : 0);
			for (const m of modules) if (m.onSnap) guard(m, () => m.onSnap?.());
			resnap = false;
			const out: Snapshot = {
				tape,
				cuts: cuts.filter((c) => c < tape.length),
				base: 1,
				startedAt: t0 + last,
				endedAt: t0 + last,
			};
			cuts = undefined;
			tape = [];
			base = seq + 1;
			firstAt = 0;
			// The page's scroll forces a layout: read at the first read at rest, not here.
			scrolled.add(d);
			if (!scrollTimer) scrollTimer = setTimeout(scrolls, 16);
			kick();
			weigh(out.tape);
			return out;
		},
		drain() {
			if (!stopped) sync();
			if (ended) {
				tape.push(Op.END, ended);
				ended = 0;
			}
			const out: Drained = {
				tape,
				base,
				startedAt: t0 + (firstAt || last),
				endedAt: t0 + last,
			};
			tape = [];
			base = seq + 1;
			firstAt = 0;
			weigh(out.tape);
			return out;
		},
		stop,
		get stopped() {
			return stopped;
		},
		get needsSnap() {
			return resnap;
		},
	};
}
