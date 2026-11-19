// Random mutations of a live page, for the fuzzer: after each round, the copy rebuilt from the
// tape must be the page. Ported from the three proofs of concept's generators (calque's for
// structure, écho's and sillage's for what they added), plus zones, fields and templates.

/** A small seeded generator (mulberry32), so a failure replays from its seed. */
export function seeded(seed: number) {
	let s = (seed * 2654435761) | 0;
	const rnd = () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return rnd;
}

/** A fictional page with what sites hold: sections, lists, a form, SVG, a template. */
export const FUZZ_PAGE = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Jardins de Belleroche</title>
<style>.carte{border:1px solid #ccc}.x{color:#333}</style></head><body>
<header><nav><a href="/">Accueil</a> <a href="/services">Services</a> <a href="/contact">Contact</a></nav><h1>Jardins de Belleroche</h1></header>
<main><section id="services"><h2>Nos services</h2><ul><li class="carte">Taille de haies</li><li class="carte">Tonte</li><li class="carte">Création de massifs</li></ul></section>
<section id="avis"><h2>Avis</h2><blockquote>Travail soigné <b>et rapide</b>.</blockquote><blockquote data-va-mask>Client : Paul Léger</blockquote></section>
<section id="devis"><h2>Demander un devis</h2><form><label>Nom <input name="nom" value=""></label><label>Message <textarea name="message">Bonjour</textarea></label>
<select name="service"><option>Taille</option><option selected>Tonte</option></select><label><input type="checkbox" name="rappel"> Me rappeler</label><button>Envoyer</button></form></section>
<section id="carte"><svg width="40" height="40"><circle cx="20" cy="20" r="10"/></svg><div data-va-block><p>Carte interactive</p></div></section>
<template id="modele"><li class="carte">Nouveau service</li></template>
<div id="editeur" contenteditable="true"><p>Votre message</p></div>
</main><footer><p>© Jardins de Belleroche</p></footer></body></html>`;

const SKIP: Record<string, 1> = { script: 1, noscript: 1, iframe: 1 };

export function mutator(d: Document, rnd: () => number) {
	const int = (n: number) => Math.floor(rnd() * n);
	const pick = <T>(list: ReadonlyArray<T>): T | undefined => list[int(list.length)];
	const blocked = (n: Node) => n.nodeType === 1 && (n as Element).hasAttribute("data-va-block");
	function elements(): Array<Element> {
		const out: Array<Element> = [];
		const walk = (n: ParentNode) => {
			for (const c of Array.from(n.children)) {
				if (SKIP[c.localName]) continue;
				out.push(c);
				if (!blocked(c)) {
					walk(c);
					if (c.shadowRoot) walk(c.shadowRoot);
					if (c.localName === "template") walk((c as HTMLTemplateElement).content);
				}
			}
		};
		walk(d.body);
		walk(d.head);
		return out;
	}
	const textNodes = (el: Element) => Array.from(el.childNodes).filter((c) => c.nodeType === 3) as Array<Text>;
	const word = () =>
		pick(["haie", "tonte", "massif", "potager", "allée", "bassin", "serre", "  ", "\n\t", "été & hiver", "<b>", ""]) as string;
	const TAGS = ["div", "p", "span", "ul", "li", "b", "section", "em", "a", "button", "table", "tr", "td", "input", "textarea", "select"];
	function make(depth = 0): Node {
		const kind = rnd();
		if (kind < 0.25) return d.createTextNode(word());
		if (kind < 0.3) return d.createComment(word());
		if (kind < 0.33) {
			const sc = d.createElement("script");
			sc.type = "text/plain";
			sc.textContent = "x";
			return sc;
		}
		if (kind < 0.38) {
			const svg = d.createElementNS("http://www.w3.org/2000/svg", "svg");
			const c = d.createElementNS("http://www.w3.org/2000/svg", "circle");
			c.setAttribute("r", String(int(9)));
			svg.append(c);
			if (rnd() < 0.5) {
				const fo = d.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
				fo.append(d.createElement("div"));
				svg.append(fo);
			}
			return svg;
		}
		if (kind < 0.4) {
			const t = d.createElement("template");
			t.content.append(make(depth + 1));
			return t;
		}
		const el = d.createElement(pick(TAGS) as string);
		if (el.localName === "select") {
			for (let i = 1 + int(3); i > 0; i--) {
				const o = d.createElement("option");
				o.textContent = word();
				if (rnd() < 0.3) o.setAttribute("selected", "");
				el.append(o);
			}
			return el;
		}
		if (el.localName === "input" || el.localName === "textarea") {
			if (rnd() < 0.5) el.setAttribute("value", word());
			if (rnd() < 0.3) el.setAttribute("type", pick(["text", "checkbox", "password", "email"]) as string);
			return el;
		}
		if (rnd() < 0.6)
			el.setAttribute(pick(["class", "id", "title", "data-k", "style", "hidden", "alt"]) as string, pick(["a", "b c", "color:red", ""]) as string);
		if (rnd() < 0.06) el.setAttribute("data-va-block", "");
		if (rnd() < 0.06) el.setAttribute("data-va-mask", "");
		if (rnd() < 0.04) el.setAttribute("contenteditable", "true");
		if (rnd() < 0.08 && /^(div|p|span|section)$/.test(el.localName)) {
			const root = el.attachShadow({ mode: "open" });
			root.append(make(depth + 1));
		}
		if (depth < 3) for (let i = int(4); i > 0; i--) el.append(make(depth + 1));
		return el;
	}
	const w = d.defaultView as Window & typeof globalThis;
	const pause = async () => {
		const r = rnd();
		if (r < 0.25) await Promise.resolve();
		else if (r < 0.35) await new Promise((f) => w.setTimeout(f, 0));
		else if (r < 0.37) await new Promise((f) => w.setTimeout(f, 70));
	};
	const shadowHost = (n: Node) => (n.getRootNode({ composed: false }) as ShadowRoot).host;
	async function mutate() {
		const all = elements();
		if (!all.length) return;
		const el = pick(all) as Element;
		const other = pick(all) as Element;
		const safe = (target: Node, node: Element) =>
			!node.contains(target) &&
			!node.shadowRoot?.contains(target) &&
			node !== d.body &&
			node !== d.head &&
			!shadowHost(target) &&
			node.isConnected;
		const op = int(26);
		log.push(`${op}:${el.localName}${el.id ? `#${el.id}` : ""}→${other.localName}`);
		// A select or an option holds options only: the parser never builds anything else there.
		const fieldsOnly = /^(select|option|optgroup)$/.test(el.localName);
		if (fieldsOnly && op !== 2 && op !== 4 && op !== 5 && op !== 20 && op !== 21 && op !== 22) return;
		// Raw text elements hold text only, for the same reason.
		if (/^(style|title|textarea)$/.test(el.localName) && op !== 2 && op !== 4 && op !== 5 && op !== 6 && op !== 14 && op !== 20 && op !== 21) return;
		switch (op) {
			case 0:
				el.append(make());
				break;
			case 1:
				el.insertBefore(make(), pick(Array.from(el.childNodes)) || null);
				break;
			case 2:
				if (el !== d.body && el !== d.head) el.remove();
				break;
			case 3:
				if (safe(el, other)) el.insertBefore(other, pick(Array.from(el.childNodes)) || null);
				break;
			case 4:
				el.setAttribute(pick(["class", "title", "data-k", "style", "aria-label", "alt"]) as string, word());
				break;
			case 5: {
				const names = el.getAttributeNames();
				if (names.length) el.removeAttribute(pick(names) as string);
				break;
			}
			case 6: {
				const t = pick(textNodes(el));
				if (t) t.data = word() + int(100);
				else el.append(word());
				break;
			}
			case 7:
				el.innerHTML = `<p class="x">${word().replace(/[<&]/g, "")}<!-- c --><span>${int(9)}</span></p><script type="text/plain">1</script><svg><path d="M0 0"/></svg>tail`;
				break;
			case 8: {
				const list = Array.from(el.childNodes);
				for (let i = list.length - 1; i > 0; i--) {
					const j = int(i + 1);
					[list[i], list[j]] = [list[j] as ChildNode, list[i] as ChildNode];
				}
				el.replaceChildren(...list);
				break;
			}
			case 9: {
				const n = make();
				el.append(n);
				await pause();
				if (n.nodeType === 1) {
					(n as Element).setAttribute("data-late", "1");
					(n as Element).append(make());
				}
				break;
			}
			case 10: {
				if (el === d.body || el === d.head) break;
				const parent = el.parentNode;
				const next = el.nextSibling;
				el.remove();
				el.setAttribute("data-away", "1");
				await Promise.resolve();
				el.append("changed away");
				el.firstElementChild?.remove();
				await pause();
				if (parent?.isConnected) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
				break;
			}
			case 11:
				el.insertBefore(d.createComment("c"), el.firstChild);
				el.insertBefore(make(), el.firstChild);
				el.append(d.createComment("d"), make());
				break;
			case 12: {
				const t = pick(textNodes(el));
				if (t && t.data.length > 2) t.splitText(1);
				else el.normalize();
				break;
			}
			case 13: {
				if (!safe(el, other)) break;
				const box = d.createElement("div");
				box.append(make(), other, make());
				await pause();
				el.append(box);
				if (rnd() < 0.3) {
					await pause();
					box.remove();
				}
				break;
			}
			case 14:
				el.textContent = rnd() < 0.5 ? "" : word();
				break;
			case 15:
				el.insertAdjacentHTML(pick(["afterbegin", "beforeend"]) as InsertPosition, `<i>${int(9)}</i>text<u></u>`);
				break;
			case 16: {
				const a = el.firstChild;
				const b = el.lastChild;
				if (a && b && a !== b) {
					el.insertBefore(b, a);
					el.append(a);
				}
				break;
			}
			case 17:
				if (!el.shadowRoot && /^(div|p|span|section)$/.test(el.localName) && !shadowHost(el)) {
					try {
						el.attachShadow({ mode: "open" }).append(make(1));
					} catch {}
				}
				break;
			case 18: {
				const box = all.find(blocked);
				if (!box || !safe(box, other) || other === box) break;
				box.append(other);
				if (rnd() < 0.5) {
					await pause();
					if (safe(el, other)) el.append(other);
				}
				break;
			}
			case 19: {
				const kids = Array.from(el.children);
				const a = pick(kids);
				const b = pick(kids);
				if (a && b && a !== b) {
					const ghost = d.createComment("");
					a.replaceWith(ghost);
					b.replaceWith(a);
					ghost.replaceWith(b);
				}
				break;
			}
			// What the three generators lacked: zones toggled, fields changed by script, templates.
			case 20:
				if (el !== d.body && el !== d.documentElement)
					el.toggleAttribute(pick(["data-va-block", "data-va-mask", "data-va-unmask"]) as string);
				break;
			case 21:
				if (el !== d.body) el.toggleAttribute("contenteditable");
				break;
			case 22: {
				const field = pick(all.filter((e) => /^(input|textarea|select)$/.test(e.localName))) as
					| (HTMLInputElement & HTMLSelectElement)
					| undefined;
				if (!field) break;
				if (field.localName === "select") field.selectedIndex = int(field.options.length + 1) - 1;
				else if ((field as HTMLInputElement).type === "checkbox") field.checked = !field.checked;
				else field.value = word() + int(9);
				break;
			}
			case 23: {
				const t = pick(all.filter((e) => e.localName === "template")) as HTMLTemplateElement | undefined;
				if (!t) break;
				if (rnd() < 0.5) t.content.append(make(1));
				else t.content.firstChild?.remove();
				break;
			}
			case 24: {
				const t = pick(all.filter((e) => e.localName === "template")) as HTMLTemplateElement | undefined;
				if (t && el !== t && !t.contains(el) && el.isConnected && !blocked(el)) el.append(t.content.cloneNode(true));
				break;
			}
			case 25:
				if (el !== d.body && el !== d.head && el.localName !== "html") el.replaceWith(make());
				break;
		}
	}
	const log: Array<string> = [];
	return {
		log,
		async round() {
			log.length = 0;
			for (let i = 1 + int(12); i > 0; i--) {
				try {
					await mutate();
				} catch (e) {
					if ((e as Error).name !== "HierarchyRequestError" && (e as Error).name !== "NotSupportedError") throw e;
				}
				await pause();
			}
		},
	};
}
