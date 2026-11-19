// Rebuilds the recorded page in a document and keeps it in step with the tape, through the DOM
// API only: nothing goes through the HTML parser, so its repairs (a table without tbody, an <a>
// in an <a>, HTML inside SVG) cannot change what is built.
//
// The tape comes from a browser nobody controls and is shown in a back office: nothing in the
// copy may run, submit or leave the page.
import { FNV_START, fnv, length, Op, type Tape } from "../format/index";

export interface MirrorHooks {
	readonly pointer?: (x: number, y: number) => void;
	readonly tap?: (kind: number, x: number, y: number) => void;
	readonly size?: (width: number, height: number) => void;
	readonly focus?: (el: Element | null) => void;
	readonly print?: (ok: boolean, at: number, detail: string) => void;
}

export interface Mirror {
	/** Runs the tape from `from`, up to the tick that would pass `until`. Returns where it stopped. */
	run(tape: Tape, from?: number, until?: number): number;
	/** Recorded time of the last tick run, ms since epoch. */
	readonly time: number;
	/** The number the next node made takes. */
	readonly next: number;
	readonly url: string;
	readonly nodes: ReadonlyArray<Node | undefined>;
	/** True between batches, where a checkpoint may be taken. */
	readonly rest: boolean;
	/** A copy of the rebuilt page and of what numbers it, to come back to without the tape. */
	save(): Checkpoint;
	/** Puts the page back as it was saved; the tape then runs on from where the save was. */
	restore(cp: Checkpoint): void;
}

/**
 * What a copy of the document does not carry is kept beside it: the rules of constructed sheets,
 * which roots adopt them, the frames' documents, canvas pixels, modal dialogs and open popovers,
 * scroll positions, and the last size and pointer.
 */
export interface Checkpoint {
	readonly holder: Document;
	readonly nodes: ReadonlyArray<Node | undefined>;
	readonly frames: ReadonlyMap<Element, Node>;
	readonly sheets: ReadonlyArray<string | undefined>;
	readonly adopted: ReadonlyArray<readonly [Node, ReadonlyArray<number>]>;
	readonly pixels: ReadonlyArray<readonly [Node, HTMLCanvasElement]>;
	readonly shown: ReadonlyArray<readonly [Node, number]>;
	readonly scrolls: ReadonlyArray<readonly [Node, number, number]>;
	readonly seq: number;
	readonly base: string;
	readonly now: number;
	readonly mode: number;
	readonly size: readonly [number, number] | null;
	readonly pointer: readonly [number, number] | null;
}

const SVG = "http://www.w3.org/2000/svg";
const MATHML = "http://www.w3.org/1998/Math/MathML";
const XLINK = "http://www.w3.org/1999/xlink";
const XML = "http://www.w3.org/XML/1998/namespace";
const ADDRESS = /^(src|href|poster|action|formaction|data|xlink:href|cite|background)$/i;
const CSS_URL = /url\(\s*(['"]?)(?!data:|#|blob:)([^'")]+)\1\s*\)/g;
const SAFE_URL = /^(https?:|data:image\/|blob:|#|mailto:|tel:)/i;
/** Elements that would act inside the copy: built inert, under another name, so numbering holds. */
const INERT = /^(script|base|object|embed|portal)$/i;

const NODE = Node.prototype;
const firstChild = Object.getOwnPropertyDescriptor(NODE, "firstChild")?.get as (this: Node) => Node | null;
const nextSibling = Object.getOwnPropertyDescriptor(NODE, "nextSibling")?.get as (this: Node) => Node | null;
const localName = Object.getOwnPropertyDescriptor(Element.prototype, "localName")?.get as (this: Element) => string;
// Called through the prototype: a form holding a field named `setAttribute` hides the method.
const EL = Element.prototype;
const setAttr = (el: Element, name: string, value: string) => EL.setAttribute.call(el, name, value);
const setAttrNS = (el: Element, ns: string | null, name: string, value: string) =>
	EL.setAttributeNS.call(el, ns, name, value);
const getAttr = (el: Element, name: string) => EL.getAttribute.call(el, name);
const hasAttr = (el: Element, name: string) => EL.hasAttribute.call(el, name);
const removeAttr = (el: Element, name: string) => EL.removeAttribute.call(el, name);
/** Text nodes the player adds on its own (the rules of a <style> filled by script). */
const added = new WeakSet<Node>();

export function mirror(doc: Document, hooks: MirrorHooks = {}): Mirror {
	let nodes: Array<Node | undefined> = [];
	let sheets: Array<CSSStyleSheet | undefined> = [];
	let stack: Array<{ p: Node; a: Node | null }> = [];
	let seq = 0;
	let base = "";
	let now = 0;
	let size: [number, number] | null = null;
	let pointer: [number, number] | null = null;
	// What a copy of the tree would lose, noted as the tape does it, for a checkpoint to keep.
	let drawn = new Set<Node>();
	let scrolled = new Set<Node>();
	let opened = new Set<Node>();
	let adopting = new Set<Node>();
	const win = () => doc.defaultView as (Window & typeof globalThis) | null;

	const absolute = (url: string, from = base) => {
		try {
			return new URL(url, from).href;
		} catch {
			return url;
		}
	};
	const css = (text: string, from = base) =>
		text.replace(CSS_URL, (_m, _q, url: string) => `url("${absolute(url, from)}")`);
	const local = (el: Element) => localName.call(el);

	function add(n: Node) {
		const top = stack[stack.length - 1];
		if (!top) return;
		try {
			top.p.insertBefore(n, top.a && top.a.parentNode === top.p ? top.a : null);
		} catch {
			try {
				top.p.appendChild(n);
			} catch {
				// A node the browser refuses there (a second doctype): kept out of the tree.
			}
		}
	}

	function set(el: Element, name: string, value: string) {
		if (/^on/i.test(name) || name.toLowerCase() === "http-equiv") return;
		const tag = local(el);
		if (tag === "iframe" && (name === "src" || name === "srcdoc")) return;
		if (ADDRESS.test(name)) {
			value = absolute(value);
			if (!SAFE_URL.test(value)) value = "about:blank";
		} else if (name === "srcset")
			value = value
				.split(",")
				.map((part) => {
					const [url, ...rest] = part.trim().split(/\s+/);
					return [absolute(url || ""), ...rest].join(" ");
				})
				.join(", ");
		else if (name === "style") value = css(value);
		else if (tag === "a" && name === "target") return;
		try {
			if (name.startsWith("xlink:")) setAttrNS(el, XLINK, name, value);
			else if (name.startsWith("xml:")) setAttrNS(el, XML, name, value);
			else setAttr(el, name, value);
		} catch {
			// A name the DOM refuses (`@click`, `:class`): kept aside, never shown.
			try {
				setAttrNS(el, null, name, value);
			} catch {}
		}
	}

	function element(name: string): Element {
		const space = name.indexOf(" ");
		try {
			if (space < 0) {
				if (INERT.test(name)) return doc.createElement(`replay-${name}`);
				return doc.createElement(name);
			}
			const ns = name.slice(0, space);
			const tag = name.slice(space + 1);
			return doc.createElementNS(ns === "s" ? SVG : ns === "m" ? MATHML : ns, tag);
		} catch {
			return doc.createElement("replay-unknown");
		}
	}

	function open(p: Node) {
		stack.push({ p, a: null });
	}

	function sheetText(node: Node | undefined, text: string): void {
		if (!node || node.nodeType !== 1) return;
		const el = node as Element;
		if (local(el) === "link") {
			const from = absolute(getAttr(el, "href") || "");
			const blob = URL.createObjectURL(new Blob([css(text, from)], { type: "text/css" }));
			setAttr(el, "href", blob);
			return;
		}
		// A <style> filled by script: its text is put in a text node of its own.
		let t: Node | null = null;
		for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) t = c;
		if (t) (t as Text).data = css(text);
		else {
			const node = doc.createTextNode(css(text));
			added.add(node);
			el.appendChild(node);
		}
	}

	function constructed(k: number, text: string) {
		const W = win();
		if (!W?.CSSStyleSheet) return;
		let s = sheets[k];
		if (!s) {
			try {
				s = new W.CSSStyleSheet();
			} catch {
				return;
			}
			sheets[k] = s;
		}
		try {
			s.replaceSync(css(text));
		} catch {}
	}

	function reset(mode: number) {
		// The mode of a document is set when it is parsed: written first, then emptied.
		doc.open();
		doc.write(mode === 1 ? "" : "<!DOCTYPE html>");
		doc.close();
		while (doc.firstChild) doc.removeChild(doc.firstChild);
		nodes = [undefined, doc];
		sheets = [];
		drawn = new Set();
		scrolled = new Set();
		opened = new Set();
		adopting = new Set();
		seq = 1;
		stack = [{ p: doc, a: null }];
	}

	function run(tape: Tape, from = 0, until = Number.POSITIVE_INFINITY) {
		let i = from;
		while (i < tape.length) {
			const at = i;
			const n = length(tape, i);
			if (n < 0) throw new Error(`replay: bad op at ${i}`);
			const op = tape[i] as number;
			const a = (k: number) => tape[at + k] as never;
			if (op === Op.TICK && now + (a(1) as number) > until) return at;
			i += n;
			switch (op) {
				case Op.X:
					stack.pop();
					break;
				case Op.E: {
					const el = element(a(1));
					for (let k = 3; k < n; k += 2) set(el, a(k), a(k + 1));
					nodes[++seq] = el;
					add(el);
					open(el);
					break;
				}
				case Op.T: {
					const top = stack[stack.length - 1]?.p as Element | undefined;
					const data: string = a(1);
					const inStyle = top?.nodeType === 1 && local(top) === "style";
					const t = doc.createTextNode(inStyle ? css(data) : data);
					nodes[++seq] = t;
					add(t);
					break;
				}
				case Op.D: {
					let t: Node;
					try {
						t = doc.implementation.createDocumentType(a(1), a(2), a(3));
					} catch {
						t = doc.createComment("doctype");
					}
					nodes[++seq] = t;
					add(t);
					break;
				}
				case Op.B: {
					const el = element(a(1)) as HTMLElement;
					setAttr(
						el,
						"style",
						`display:inline-block;width:${+a(2) || 0}px;height:${+a(3) || 0}px;background:repeating-linear-gradient(45deg,#0001 0 8px,#0002 8px 16px)`,
					);
					setAttr(el, "data-replay-blocked", "");
					nodes[++seq] = el;
					add(el);
					break;
				}
				case Op.TPL: {
					const top = stack[stack.length - 1]?.p as HTMLTemplateElement | undefined;
					const content = top && "content" in top ? top.content : doc.createDocumentFragment();
					nodes[++seq] = content;
					open(content);
					break;
				}
				case Op.SHADOW: {
					const host = stack[stack.length - 1]?.p as Element | undefined;
					let root: Node;
					try {
						root = (host as Element).shadowRoot || (host as Element).attachShadow({ mode: "open" });
						while (root.firstChild) root.removeChild(root.firstChild);
					} catch {
						root = doc.createDocumentFragment();
					}
					nodes[++seq] = root;
					open(root);
					break;
				}
				case Op.FRAME: {
					const frame = stack[stack.length - 1]?.p as HTMLIFrameElement | undefined;
					let inner: Node | null = null;
					try {
						inner = frame?.contentDocument || null;
						if (inner) while (inner.firstChild) inner.removeChild(inner.firstChild);
					} catch {}
					const node = inner || doc.createDocumentFragment();
					nodes[++seq] = node;
					open(node);
					break;
				}
				case Op.R: {
					const node = nodes[a(1)];
					if (node) add(node);
					break;
				}
				case Op.INS: {
					const p = nodes[a(1)];
					const anchor = a(2) ? nodes[a(2)] : null;
					// A missing parent still takes its children, out of the page.
					stack.push({ p: p || doc.createDocumentFragment(), a: anchor || null });
					break;
				}
				case Op.DEL: {
					const node = nodes[a(1)];
					node?.parentNode?.removeChild(node);
					break;
				}
				case Op.ATTR: {
					const el = nodes[a(1)] as Element | undefined;
					const name: string = a(2);
					const value: string | null = a(3);
					if (!el || el.nodeType !== 1) break;
					if (value === null) {
						try {
							removeAttr(el, name);
						} catch {}
					} else set(el, name, value);
					break;
				}
				case Op.TEXT: {
					const t = nodes[a(1)] as Text | undefined;
					if (!t || t.nodeType !== 3) break;
					const data: string = a(2);
					t.data = t.parentElement && local(t.parentElement) === "style" ? css(data) : data;
					break;
				}
				case Op.VAL: {
					const el = nodes[a(1)] as HTMLInputElement & HTMLOptionElement;
					const v: string | number = a(2);
					if (!el || el.nodeType !== 1) break;
					try {
						if (local(el) === "option") {
							const select = el.parentElement?.closest("select") as HTMLSelectElement | null;
							// Unselecting the one option of a single select would select the first one again.
							if (!v && el.selected && select && !select.multiple) select.selectedIndex = -1;
							else el.selected = !!v;
						}
						else if (typeof v === "number") el.checked = !!v;
						else el.value = v;
					} catch {}
					break;
				}
				case Op.OPEN: {
					const el = nodes[a(1)] as HTMLDialogElement | undefined;
					const state: number = a(2);
					if (!el || el.nodeType !== 1) break;
					opened.add(el);
					try {
						if (local(el) === "dialog") {
							if (el.open) el.close();
							if (state === 2 && el.isConnected) el.showModal();
							else if (state === 1) el.show();
						} else if ("showPopover" in el) {
							const p = el as unknown as { showPopover(): void; hidePopover(): void };
							state ? p.showPopover() : p.hidePopover();
						}
					} catch {}
					break;
				}
				case Op.SHEET: {
					const id: number = a(1);
					if (id) sheetText(nodes[id], a(3));
					else constructed(a(2), a(3));
					break;
				}
				case Op.RULE: {
					const s = sheets[a(1) as number];
					const path = String(a(2)).split(".").map(Number);
					const text: string | null = a(3);
					try {
						// biome-ignore lint/suspicious/noExplicitAny: grouping rules hold rules too.
						let list: any = s;
						for (const k of path.slice(0, -1)) list = list?.cssRules[k];
						const last = path[path.length - 1] as number;
						if (text === null) list?.deleteRule(last);
						else list?.insertRule(css(text), last);
					} catch {}
					break;
				}
				case Op.ADOPT: {
					const root = nodes[a(1)] as Document | ShadowRoot | undefined;
					const list: Array<CSSStyleSheet> = [];
					for (let k = 3; k < n; k++) {
						const s = sheets[a(k) as number];
						if (s) list.push(s);
					}
					try {
						if (root && "adoptedStyleSheets" in root) {
							root.adoptedStyleSheets = list;
							adopting.add(root);
						}
					} catch {}
					break;
				}
				case Op.TICK:
					now += a(1) as number;
					break;
				case Op.MOVE:
					pointer = [a(1), a(2)];
					hooks.pointer?.(a(1), a(2));
					break;
				case Op.TAP:
					hooks.tap?.(a(1), a(3), a(4));
					break;
				case Op.SCROLL: {
					const id: number = a(1);
					const x: number = a(2);
					const y: number = a(3);
					try {
						if (nodes[id]) scrolled.add(nodes[id] as Node);
						if (id === 1) win()?.scrollTo(x, y);
						else {
							const el = nodes[id] as Element | undefined;
							if (el?.nodeType === 9) (el as unknown as Document).defaultView?.scrollTo(x, y);
							else if (el?.nodeType === 1) {
								el.scrollLeft = x;
								el.scrollTop = y;
							}
						}
					} catch {}
					break;
				}
				case Op.SIZE:
					size = [a(1), a(2)];
					hooks.size?.(a(1), a(2));
					break;
				case Op.FOCUS: {
					const el = a(1) ? (nodes[a(1)] as Element | undefined) : undefined;
					hooks.focus?.(el?.nodeType === 1 ? el : null);
					break;
				}
				case Op.META:
					base = a(2);
					now = a(3);
					reset(a(6));
					size = [a(4), a(5)];
					hooks.size?.(a(4), a(5));
					break;
				case Op.PRINT: {
					const [count, hash] = fingerprint(doc);
					hooks.print?.(count === a(1) && hash === a(2), now, `${a(1)} nœuds enregistrés, ${count} rejoués`);
					break;
				}
				case Op.SHOT: {
					const el = nodes[a(2)] as HTMLCanvasElement | undefined;
					const shot: string = a(3);
					if (!el || typeof el.getContext !== "function" || !/^data:image\//.test(shot)) break;
					drawn.add(el);
					const image = new Image();
					image.onload = () => {
						const c = el.getContext("2d");
						c?.clearRect(0, 0, el.width, el.height);
						c?.drawImage(image, 0, 0, el.width, el.height);
					};
					image.src = shot;
					break;
				}
				// HIDE, END, ERR and the framed ops this player does not know: nothing to build.
			}
		}
		return i;
	}

	function save(): Checkpoint {
		const holder = blank(doc);
		const { map, frames } = copy(nodes, doc, holder, (f) => (f as HTMLIFrameElement).contentDocument);
		const adopted: Array<readonly [Node, ReadonlyArray<number>]> = [];
		const pixels: Array<readonly [Node, HTMLCanvasElement]> = [];
		const shown: Array<readonly [Node, number]> = [];
		const scrolls: Array<readonly [Node, number, number]> = [];
		for (const n of adopting) {
			const at = map.get(n);
			const list = (n as Document | ShadowRoot).adoptedStyleSheets;
			if (at && list?.length) adopted.push([at, list.map((x) => sheets.indexOf(x))]);
		}
		for (const n of scrolled) {
			const c = map.get(n);
			if (!c) continue;
			if (n.nodeType === 9) {
				const w = (n as Document).defaultView;
				if (w) scrolls.push([c, w.scrollX, w.scrollY]);
			} else if (n.nodeType === 1) scrolls.push([c, (n as Element).scrollLeft, (n as Element).scrollTop]);
		}
		for (const n of opened) {
			const c = map.get(n);
			try {
				if (c && local(n as Element) === "dialog" && (n as Element).matches(":modal")) shown.push([c, 2]);
				else if (c && (n as Element).matches(":popover-open")) shown.push([c, 1]);
			} catch {}
		}
		for (const n of drawn) {
			const c = map.get(n);
			const from = n as HTMLCanvasElement;
			if (!c || !from.width || !from.height) continue;
			const pixel = doc.createElement("canvas");
			pixel.width = from.width;
			pixel.height = from.height;
			try {
				pixel.getContext("2d")?.drawImage(from, 0, 0);
				pixels.push([c, pixel]);
			} catch {}
		}
		return {
			holder,
			nodes: nodes.map((n) => n && map.get(n)),
			frames,
			sheets: sheets.map((s) => s && rulesOf(s)),
			adopted,
			pixels,
			shown,
			scrolls,
			seq,
			base,
			now,
			mode: doc.compatMode === "BackCompat" ? 1 : 0,
			size,
			pointer,
		};
	}

	function restore(cp: Checkpoint) {
		reset(cp.mode);
		const { map } = copy(cp.nodes, cp.holder, doc, (f) => cp.frames.get(f) || null);
		nodes = cp.nodes.map((n) => n && map.get(n));
		seq = cp.seq;
		base = cp.base;
		now = cp.now;
		cp.sheets.forEach((text, k) => {
			if (text !== undefined) constructed(k, text);
		});
		for (const [root, list] of cp.adopted) {
			const r = map.get(root) as Document | ShadowRoot | undefined;
			try {
				if (r && "adoptedStyleSheets" in r) {
					r.adoptedStyleSheets = list.map((k) => sheets[k]).filter(Boolean) as Array<CSSStyleSheet>;
					adopting.add(r);
				}
			} catch {}
		}
		for (const [node, pixel] of cp.pixels) {
			const el = map.get(node) as HTMLCanvasElement | undefined;
			try {
				if (!el) continue;
				el.getContext("2d")?.drawImage(pixel, 0, 0);
				drawn.add(el);
			} catch {}
		}
		for (const [node, state] of cp.shown) {
			const el = map.get(node) as (HTMLDialogElement & { showPopover(): void }) | undefined;
			try {
				if (!el?.isConnected) continue;
				opened.add(el);
				if (state === 2) {
					if (el.open) el.close();
					el.showModal();
				} else el.showPopover();
			} catch {}
		}
		for (const [node, x, y] of cp.scrolls) {
			const n = map.get(node);
			if (n) scrolled.add(n);
			try {
				if (n?.nodeType === 9) (n as Document).defaultView?.scrollTo(x, y);
				else if (n?.nodeType === 1) {
					(n as Element).scrollLeft = x;
					(n as Element).scrollTop = y;
				}
			} catch {}
		}
		size = cp.size && [cp.size[0], cp.size[1]];
		pointer = cp.pointer && [cp.pointer[0], cp.pointer[1]];
		if (size) hooks.size?.(size[0], size[1]);
		if (pointer) hooks.pointer?.(pointer[0], pointer[1]);
	}

	return {
		run,
		save,
		restore,
		get rest() {
			return stack.length === 1;
		},
		get time() {
			return now;
		},
		get next() {
			return seq + 1;
		},
		get url() {
			return base;
		},
		get nodes() {
			return nodes;
		},
	};
}

/** An empty document of no window: what it holds neither loads nor runs. */
function blank(from: Document): Document {
	const d = from.implementation.createHTMLDocument("");
	while (d.firstChild) d.removeChild(d.firstChild);
	return d;
}

function rulesOf(sheet: CSSStyleSheet): string {
	let text = "";
	try {
		for (const rule of Array.from(sheet.cssRules)) text += rule.cssText;
	} catch {}
	return text;
}

/**
 * Copies every numbered node of `from` into `into`, the trees whole and the detached ones too,
 * and returns which copy is which. Shadow roots, template contents and frames' documents are
 * walked by hand, since cloning skips them; field state is set where cloning loses it. Nodes are
 * put in place before their children, so a frame in a live document has its document to fill.
 */
function copy(
	from: ReadonlyArray<Node | undefined>,
	root: Document,
	into: Document,
	inner: (frame: Element) => Node | null,
): { map: Map<Node, Node>; frames: Map<Element, Node> } {
	const map = new Map<Node, Node>();
	const frames = new Map<Element, Node>();
	const owner = new Map<Node, Node>();
	for (const n of from)
		if (n?.nodeType === 1 && localName.call(n as Element) === "template")
			owner.set((n as HTMLTemplateElement).content, n);

	const children = (s: Node, d: Node) => {
		for (let c = firstChild.call(s); c; c = nextSibling.call(c)) node(c, d);
	};
	function node(s: Node, parent: Node | null): void {
		let c: Node;
		try {
			// WebKit refuses to import a doctype.
			const t = s as DocumentType;
			c =
				s.nodeType === 10
					? into.implementation.createDocumentType(t.name, t.publicId, t.systemId)
					: into.importNode(s, false);
		} catch {
			return;
		}
		map.set(s, c);
		if (added.has(s)) added.add(c);
		if (parent)
			try {
				parent.appendChild(c);
			} catch {}
		if (s.nodeType !== 1) return;
		const el = s as Element;
		const to = c as Element;
		const tag = localName.call(el);
		if (tag === "template" && "content" in el) {
			const content = (to as HTMLTemplateElement).content;
			map.set((el as HTMLTemplateElement).content, content);
			children((el as HTMLTemplateElement).content, content);
		}
		const shadow = el.shadowRoot;
		if (shadow)
			try {
				const r = to.shadowRoot || to.attachShadow({ mode: "open" });
				map.set(shadow, r);
				children(shadow, r);
			} catch {}
		if (tag === "iframe") {
			const i = inner(el);
			if (i) {
				let d: Node | null = null;
				try {
					d = (to as HTMLIFrameElement).contentDocument;
				} catch {}
				if (d) while (d.firstChild) d.removeChild(d.firstChild);
				else d = blank(into);
				map.set(i, d);
				frames.set(to, d);
				children(i, d);
			}
		}
		children(el, to);
		// biome-ignore lint/suspicious/noExplicitAny: form controls.
		const a = el as any;
		// biome-ignore lint/suspicious/noExplicitAny: form controls.
		const b = to as any;
		try {
			if (tag === "input" || tag === "textarea") {
				if (b.value !== a.value && a.type !== "file") b.value = a.value;
				if (b.checked !== a.checked) b.checked = a.checked;
			} else if (tag === "select") {
				if (a.multiple || a.size > 1) {
					for (let k = 0; k < a.options.length; k++)
						if (b.options[k] && b.options[k].selected !== a.options[k].selected) b.options[k].selected = a.options[k].selected;
				} else if (b.selectedIndex !== a.selectedIndex) b.selectedIndex = a.selectedIndex;
			} else if (tag === "option" && !el.parentElement?.closest("select") && b.selected !== a.selected)
				b.selected = a.selected;
		} catch {}
	}

	map.set(root, into);
	children(root, into);
	// The nodes out of the page: each tree from its top, through shadow hosts and templates.
	for (const n of from) {
		if (!n || map.has(n)) continue;
		let top = n;
		for (;;) {
			// `host` only on a shadow root: on a link it is the address's host.
			const up: Node | null | undefined =
				top.parentNode || (top.nodeType === 11 ? (top as ShadowRoot).host : null) || owner.get(top);
			if (!up) break;
			top = up;
		}
		if (map.has(top)) continue;
		if (top.nodeType === 9 || top.nodeType === 11) {
			const d = top.nodeType === 9 ? blank(into) : into.createDocumentFragment();
			map.set(top, d);
			children(top, d);
		} else node(top, null);
	}
	return { map, frames };
}

/** The PRINT of a rebuilt document, as the recorder computes it of the page. */
export function fingerprint(root: Node): [number, number] {
	let count = 0;
	let h = FNV_START;
	const walk = (n: Node) => {
		for (let c = firstChild.call(n); c; c = nextSibling.call(c)) {
			const type = c.nodeType;
			if ((type !== 1 && type !== 3 && type !== 10) || added.has(c)) continue;
			count++;
			h = fnv(h, type);
			if (type === 1) {
				const el = c as Element;
				let tag = localName.call(el);
				if (tag.startsWith("replay-") && tag !== "replay-unknown") tag = tag.slice(7);
				h = fnv(h, tag.length);
				h = fnv(h, tag.charCodeAt(0));
				if (hasAttr(el, "data-replay-blocked")) continue;
				if (tag === "template" && "content" in el) walk((el as HTMLTemplateElement).content);
				walk(el);
			}
		}
	};
	walk(root);
	return [count, h];
}
