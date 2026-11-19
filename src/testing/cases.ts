// The case suite. `html` is written into the site frame by the parser; `before` runs before the
// recorder starts, `run` after; `keys`, `clicks` and `select` are done by the test driver with
// real input events, then `after` runs. The functions are evaluated in the site's window with
// (document, window, wait): they must not reference anything outside themselves.
import type { Options } from "../record/index";

type Fn = (d: Document, w: Window & typeof globalThis, wait: (ms: number) => Promise<void>) => unknown;

export interface Case {
	readonly name: string;
	readonly group: string;
	readonly html: string;
	readonly o?: Pick<Options, "mask">;
	readonly before?: Fn;
	readonly run?: Fn;
	readonly after?: Fn;
	readonly keys?: ReadonlyArray<readonly [string, string]>;
	readonly clicks?: ReadonlyArray<string>;
	readonly select?: ReadonlyArray<readonly [string, string]>;
	/** Strings that must never leave the page, in clear. */
	readonly secrets?: ReadonlyArray<string>;
}

const D = (body: string, head = "") =>
	`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Cas</title>${head}</head><body>${body}</body></html>`;
const AB = D('<div id="a"></div><div id="b">avant</div>');

const hazards: Fn = (d) => {
	const a = d.getElementById("a") as Element;
	const t = d.createElement("table");
	const tr = d.createElement("tr");
	const td = d.createElement("td");
	td.textContent = "cellule";
	tr.append(td);
	t.append(tr);
	a.append(t);
	const p = d.createElement("p");
	const div = d.createElement("div");
	div.textContent = "bloc";
	p.append(div);
	a.append(p);
	const l1 = d.createElement("a");
	const l2 = d.createElement("a");
	l1.href = "/x";
	l2.href = "/y";
	l2.textContent = "lien";
	l1.append(l2);
	a.append(l1);
	const ul = d.createElement("ul");
	const li = d.createElement("li");
	const li2 = d.createElement("li");
	li2.textContent = "sous";
	li.append(li2);
	ul.append(li);
	a.append(ul);
	const svg = d.createElementNS("http://www.w3.org/2000/svg", "svg");
	const h = d.createElement("div");
	h.textContent = "html dans svg";
	svg.append(h);
	a.append(svg);
};

export const CASES: ReadonlyArray<Case> = [
	{
		name: "témoin",
		group: "base",
		html: D('<header><h1>Titre</h1></header><main><p id="p">Texte <b>gras</b></p><ul id="u"><li>un</li></ul></main>'),
		run: (d) => {
			d.getElementById("p")?.append(" ajouté");
			const li = d.createElement("li");
			li.textContent = "deux";
			d.getElementById("u")?.append(li);
			(d.querySelector("h1") as Element).className = "x";
		},
	},
	{
		name: "table sans tbody",
		group: "parseur",
		html: AB,
		run: (d) => {
			const t = d.createElement("table");
			const tr = d.createElement("tr");
			const td = d.createElement("td");
			td.textContent = "c";
			tr.append(td);
			t.append(tr);
			d.getElementById("a")?.append(t);
			(d.getElementById("b") as Element).textContent = "après";
		},
	},
	{
		name: "div dans p",
		group: "parseur",
		html: AB,
		run: (d) => {
			const p = d.createElement("p");
			const x = d.createElement("div");
			x.textContent = "bloc";
			p.append(x, "suite");
			d.getElementById("a")?.append(p);
			(d.getElementById("b") as Element).textContent = "après";
		},
	},
	{
		name: "a dans a",
		group: "parseur",
		html: AB,
		run: (d) => {
			const a = d.createElement("a");
			const b = d.createElement("a");
			a.href = "/x";
			b.href = "/y";
			b.textContent = "lien";
			a.append(b, "fin");
			d.getElementById("a")?.append(a);
			(d.getElementById("b") as Element).textContent = "après";
		},
	},
	{
		name: "li dans li",
		group: "parseur",
		html: AB,
		run: (d) => {
			const ul = d.createElement("ul");
			const li = d.createElement("li");
			const x = d.createElement("li");
			x.textContent = "sous";
			li.append(x);
			ul.append(li);
			d.getElementById("a")?.append(ul);
			(d.getElementById("b") as Element).textContent = "après";
		},
	},
	{
		name: "HTML créé par script dans SVG",
		group: "parseur",
		html: AB,
		run: (d) => {
			const svg = d.createElementNS("http://www.w3.org/2000/svg", "svg");
			const x = d.createElement("div");
			x.textContent = "html";
			const g = d.createElementNS("http://www.w3.org/2000/svg", "g");
			const s = d.createElement("span");
			s.textContent = "s";
			g.append(s);
			svg.append(x, g);
			d.getElementById("a")?.append(svg);
			(d.getElementById("b") as Element).textContent = "après";
		},
	},
	{
		name: "les cinq pièges, présents dès le départ",
		group: "parseur",
		html: AB,
		before: hazards,
		run: (d) => {
			(d.getElementById("b") as Element).textContent = "après";
		},
	},
	{
		name: "MathML",
		group: "parseur",
		html: D('<p id="p">x</p><math id="m"><mi>a</mi><mo>+</mo><mn>2</mn></math>'),
		run: (d) => {
			const mi = d.createElementNS("http://www.w3.org/1998/Math/MathML", "mi");
			mi.textContent = "b";
			d.getElementById("m")?.append(mi);
		},
	},
	{
		name: "détaché, modifié, réinséré",
		group: "mutations",
		html: D('<section id="s"><div id="x" class="a"><span>un</span><i>deux</i></div><p id="y">p</p></section>'),
		run: async (d, _w, wait) => {
			const s = d.getElementById("s") as Element;
			const x = d.getElementById("x") as Element;
			const y = d.getElementById("y") as HTMLElement;
			x.remove();
			x.setAttribute("data-away", "1");
			(x.firstChild as Element).textContent = "changé";
			x.append(d.createElement("em"));
			await Promise.resolve();
			(x.lastElementChild as Element).textContent = "nouveau";
			await wait(40);
			x.querySelector("i")?.remove();
			s.append(x);
			y.remove();
			y.textContent = "même tâche";
			y.title = "t";
			s.prepend(y);
		},
	},
	{
		name: "déplacements",
		group: "mutations",
		html: D('<div id="a"><p>1</p><p>2</p><p>3</p></div><div id="b"><span>x</span><span>y</span></div>'),
		run: async (d, _w, wait) => {
			const a = d.getElementById("a") as Element;
			const b = d.getElementById("b") as Element;
			b.append(a.firstElementChild as Element);
			a.append(a.firstElementChild as Element);
			const box = d.createElement("div");
			box.id = "box";
			box.append(b.firstElementChild as Element);
			await wait(40);
			a.prepend(box);
			const [p, q] = Array.from(b.children);
			const ghost = d.createComment("");
			p?.replaceWith(ghost);
			if (p) q?.replaceWith(p);
			if (q) ghost.replaceWith(q);
			b.append(a);
			await Promise.resolve();
			d.body.prepend(box);
		},
	},
	{
		name: "innerHTML massif",
		group: "mutations",
		html: D('<main id="m"><p>avant</p></main><p id="z">z</p>'),
		run: async (d, _w, wait) => {
			const m = d.getElementById("m") as Element;
			let h = "";
			for (let i = 0; i < 1500; i++)
				h += `<div class="r${i % 7}" data-i="${i}"><span>ligne ${i}</span> <b>${i}</b>${i % 50 ? "" : "<table><tr><td>t</td></tr></table>"}</div>`;
			m.innerHTML = h;
			await wait(40);
			m.innerHTML = h.replace(/ligne/g, "rang");
			(d.getElementById("z") as Element).textContent = "fin";
		},
	},
	{
		name: "shadow DOM attaché plus tard",
		group: "mutations",
		html: D('<div id="h"><span>clair</span></div><p id="q">déplacé</p>'),
		run: async (d, _w, wait) => {
			const r = (d.getElementById("h") as Element).attachShadow({ mode: "open" });
			r.innerHTML = "<style>b{color:red}</style><b>ombre</b><slot></slot>";
			await wait(40);
			(r.querySelector("b") as Element).textContent = "ombre modifiée";
			r.append(d.getElementById("q") as Element);
		},
	},
	{
		name: "shadow DOM présent au départ",
		group: "mutations",
		html: D('<div id="h"><span>clair</span></div>'),
		before: (d) => {
			(d.getElementById("h") as Element).attachShadow({ mode: "open" }).innerHTML = "<i>avant</i>";
		},
		run: (d) => {
			const r = (d.getElementById("h") as Element).shadowRoot as ShadowRoot;
			(r.querySelector("i") as Element).textContent = "après";
			r.append(d.createElement("u"));
		},
	},
	{
		name: "shadow DOM attaché dans un <template>",
		group: "mutations",
		html: D('<template id="t"><p class="x">haie<span>1</span></p></template><p id="z">z</p>'),
		run: (d) => {
			const t = d.getElementById("t") as HTMLTemplateElement;
			(t.content.querySelector("p") as Element).attachShadow({ mode: "open" }).append("ombre");
		},
	},
	{
		name: "shadow DOM attaché, élément créé par innerHTML",
		group: "mutations",
		html: D('<div id="a"></div>'),
		run: async (_d, _w, wait) => {
			const a = _d.getElementById("a") as Element;
			a.innerHTML = "<p><span>6</span></p>";
			await wait(80);
			(a.querySelector("span") as Element).attachShadow({ mode: "open" }).append("ombre");
		},
	},
	{
		name: "accesseurs du DOM détournés par la page",
		group: "robustesse",
		html: D('<ul id="u"><li>un</li></ul>'),
		before: (d, w) => {
			// What zone.js and the like do: wrap a DOM accessor.
			const P = w.Node.prototype;
			const desc = Object.getOwnPropertyDescriptor(P, "firstChild") as PropertyDescriptor;
			Object.defineProperty(P, "firstChild", { configurable: true, get() { return desc.get?.call(this); } });
		},
		run: async (d, w, wait) => {
			const li = d.createElement("li");
			li.textContent = "deux";
			(d.getElementById("u") as Element).append(li);
			await wait(120);
			// The page's own nodes must keep the page's prototypes once the recorder read them.
			const first = (d.getElementById("u") as Element).firstElementChild as Element;
			if (!(first instanceof w.HTMLElement) || !(li instanceof w.HTMLElement)) throw new Error("prototypes étrangers");
		},
	},
	{
		name: "<template>",
		group: "nouveaux",
		html: D('<template id="t"><b>modèle</b><p>x</p></template><div id="a"></div>'),
		run: (d) => {
			const t = d.getElementById("t") as HTMLTemplateElement;
			(t.content.querySelector("b") as Element).textContent = "changé";
			t.content.append(d.createElement("hr"));
			(d.getElementById("a") as Element).innerHTML = '<template id="t2"><i>nouveau</i></template>';
		},
	},
	{
		name: "<select> changé par script",
		group: "nouveaux",
		o: { mask: "none" },
		html: D(
			'<select id="s1"><option>a<option selected>b<option>c</select><select id="s2" multiple><option>x<option>y<option>z</select><select id="s3"><option>p<option>q</select>',
		),
		run: (d) => {
			(d.getElementById("s1") as HTMLSelectElement).value = "c";
			const s2 = d.getElementById("s2") as HTMLSelectElement;
			(s2.options[0] as HTMLOptionElement).selected = true;
			(s2.options[2] as HTMLOptionElement).selected = true;
			((d.getElementById("s3") as HTMLSelectElement).options[1] as HTMLOptionElement).defaultSelected = true;
		},
	},
	{
		name: "<select> masqué",
		group: "masquage",
		html: D('<select id="s1"><option>a<option selected>b<option>c</select>'),
		run: (d) => {
			(d.getElementById("s1") as HTMLSelectElement).value = "c";
		},
	},
	{
		name: ".value changé sans événement",
		group: "nouveaux",
		o: { mask: "none" },
		html: D('<input id="i" value="départ"><input id="c" type="checkbox"><textarea id="t">texte</textarea><input id="r" type="range" min="0" max="10" value="2">'),
		run: (d) => {
			(d.getElementById("i") as HTMLInputElement).value = "nouveau";
			(d.getElementById("c") as HTMLInputElement).checked = true;
			(d.getElementById("t") as HTMLTextAreaElement).value = "autre";
			(d.getElementById("r") as HTMLInputElement).value = "8";
		},
	},
	{
		name: "valeurs changées avant le départ",
		group: "nouveaux",
		o: { mask: "none" },
		html: D('<input id="i" value="départ"><input id="c" type="checkbox"><textarea id="t">texte</textarea><select id="s"><option>a<option>b</select>'),
		before: (d) => {
			(d.getElementById("i") as HTMLInputElement).value = "nouveau";
			(d.getElementById("c") as HTMLInputElement).checked = true;
			(d.getElementById("t") as HTMLTextAreaElement).value = "autre";
			(d.getElementById("s") as HTMLSelectElement).value = "b";
		},
		run: (d) => {
			d.body.dataset.x = "1";
		},
	},
	{
		name: "saisie au clavier, masquée",
		group: "masquage",
		html: D('<input id="i"><textarea id="t"></textarea><input id="c" type="checkbox"><select id="s"><option>a<option>b</select>'),
		keys: [
			["#i", "Bonjour Camille"],
			["#t", "ligne\nsuite"],
		],
		clicks: ["#c"],
		select: [["#s", "b"]],
		secrets: ["Bonjour", "Camille", "suite"],
	},
	{
		name: "saisie au clavier, en clair",
		group: "nouveaux",
		o: { mask: "none" },
		html: D('<input id="i"><textarea id="t"></textarea><input id="c" type="checkbox"><select id="s"><option>a<option>b</select>'),
		keys: [
			["#i", "Bonjour"],
			["#t", "ligne\nsuite"],
		],
		clicks: ["#c"],
		select: [["#s", "b"]],
	},
	{
		name: "mot de passe, carte, champ caché",
		group: "masquage",
		o: { mask: "none" },
		html: D(
			'<form><input id="p" type="password"><input id="cc" autocomplete="cc-number"><input type="hidden" name="csrf" value="jeton-secret-123"><input id="u" value="visible"></form>',
		),
		keys: [
			["#p", "motdepasse42"],
			["#cc", "4970101010101010"],
		],
		secrets: ["motdepasse42", "4970101010101010", "jeton-secret-123"],
	},
	{
		name: "champ autorisé en clair",
		group: "masquage",
		html: D('<div data-va-unmask><input id="q" placeholder="Rechercher"></div><input id="n">'),
		keys: [
			["#q", "taille de haie"],
			["#n", "Dupont"],
		],
		secrets: ["Dupont"],
	},
	{
		name: "zone masquée : texte et attributs",
		group: "masquage",
		html: D(
			'<section data-va-mask><h2 title="Jeanne Martin">Jeanne Martin</h2><img alt="Photo de Jeanne" src="a.png"><p aria-label="adresse">12 rue des Lilas</p></section><p id="z">public</p>',
		),
		run: (d) => {
			(d.querySelector("h2") as Element).setAttribute("data-client", "Jeanne Martin");
			(d.getElementById("z") as Element).textContent = "toujours public";
		},
		secrets: ["Jeanne", "Martin", "Lilas", "Photo"],
	},
	{
		name: "tout le texte masqué",
		group: "masquage",
		o: { mask: "text" },
		html: D('<h1>Bonjour Camille</h1><p id="p">Votre devis</p>'),
		run: (d) => {
			(d.getElementById("p") as Element).textContent = "Votre devis est prêt";
		},
		secrets: ["Camille", "devis"],
	},
	{
		name: "bloqué après coup",
		group: "masquage",
		html: D('<div id="x"><p>avant</p></div><p id="z">z</p>'),
		run: async (d, _w, wait) => {
			const x = d.getElementById("x") as Element;
			x.setAttribute("data-va-block", "");
			await wait(80);
			x.setAttribute("title", "Secret Durand");
			(x.firstElementChild as Element).textContent = "Secret Durand";
		},
		secrets: ["Durand"],
	},
	{
		// The fuzzer's WebKit seed 2, round 50, reduced: the zone change and the move arrive in the
		// same batch, and forgetting the zone took the moved node along.
		name: "bloqué, puis un nœud y entre",
		group: "masquage",
		html: D('<div id="a"><b>gras</b><i>reste</i></div><div id="x"><p>avant</p></div>'),
		run: (d) => {
			const x = d.getElementById("x") as Element;
			x.setAttribute("data-va-block", "");
			x.append(d.querySelector("b") as Element);
		},
	},
	{
		// The fuzzer's seed 16, round 22, reduced: a field changed by script keeps its value when
		// its default goes; a copy that only got the attribute loses it.
		name: "champ changé par script, puis son attribut retiré",
		group: "mutations",
		html: D('<input id="f" value="haie"><input id="c" type="checkbox" checked>'),
		run: async (d, _w, wait) => {
			const f = d.getElementById("f") as HTMLInputElement;
			const c = d.getElementById("c") as HTMLInputElement;
			f.value = "haie";
			c.checked = true;
			await wait(80);
			f.removeAttribute("value");
			c.removeAttribute("checked");
		},
		o: { mask: "none" },
	},
	{
		name: "débloqué après coup",
		group: "masquage",
		html: D('<div id="x" data-va-block><p>caché</p></div>'),
		run: (d) => {
			(d.getElementById("x") as Element).removeAttribute("data-va-block");
		},
	},
	{
		name: "<dialog open> dans le HTML",
		group: "nouveaux",
		html: D('<dialog id="d1" open><p>ouvert</p></dialog><p id="p">x</p>'),
		run: (d) => {
			(d.getElementById("p") as Element).textContent = "y";
		},
	},
	{
		name: "dialog.showModal()",
		group: "nouveaux",
		html: D('<dialog id="d2"><p>modale</p></dialog>'),
		run: (d) => {
			(d.getElementById("d2") as HTMLDialogElement).showModal();
		},
	},
	{
		name: "attributs : guillemets, caractères de contrôle",
		group: "nouveaux",
		html: D(`<div id="a" title='il a dit "oui" &amp; &lt;b&gt;' data-q="l'apostrophe" @click="go" :class="k" x.y="1"></div><p id="p">a</p>`),
		run: (d) => {
			const a = d.getElementById("a") as Element;
			a.setAttribute("data-x", "a\"b'c<d>&e\u0001\u0007\t\n\u000b f");
			a.setAttribute("data-cr", "x\r\ny\rz");
			a.setAttribute("data-nul", "a\u0000b");
			(d.getElementById("p") as Element).textContent = "texte\r\nretour\u0000nul\u0007";
		},
	},
	{
		name: "champs nommés localName et hasAttribute",
		group: "nouveaux",
		html: D('<form id="f"><input name="localName" value="x"><input name="hasAttribute"><input name="attributes"></form><p id="p">a</p>'),
		run: (d) => {
			(d.getElementById("p") as Element).textContent = "b";
			(d.getElementById("f") as Element).setAttribute("data-k", "1");
		},
	},
	{
		name: "éléments personnalisés",
		group: "nouveaux",
		html: D('<x-carte id="c" titre="Bonjour"></x-carte><p>p</p>'),
		run: async (d, w, wait) => {
			w.customElements.define(
				"x-carte",
				class extends w.HTMLElement {
					connectedCallback() {
						if (this.shadowRoot) return;
						const r = this.attachShadow({ mode: "open" });
						r.innerHTML = `<h3>${this.getAttribute("titre")}</h3><slot></slot>`;
						this.innerHTML = "<p>lumière</p>";
					}
				},
			);
			await wait(40);
			const e = d.createElement("x-carte");
			e.setAttribute("titre", "second");
			d.body.append(e);
		},
	},
	{
		name: "contenteditable, en clair",
		group: "contenteditable",
		o: { mask: "none" },
		html: D('<div id="e" contenteditable="true"><p>début</p></div>'),
		keys: [["#e", " tapé\nligne deux"]],
	},
	{
		name: "contenteditable, masqué par défaut",
		group: "contenteditable",
		html: D('<div id="e" contenteditable="true"><p>début</p></div><p id="z">z</p>'),
		keys: [["#e", " Dupont"]],
		after: (d) => {
			(d.getElementById("z") as Element).textContent = "après la saisie";
		},
		secrets: ["Dupont"],
	},
	{
		name: "contenteditable : gras, liste, collage",
		group: "contenteditable",
		html: D('<div id="e" contenteditable="true"><p>Bonjour</p></div>'),
		run: async (d, _w, wait) => {
			const e = d.getElementById("e") as Element;
			const b = d.createElement("b");
			b.textContent = "important";
			(e.firstElementChild as Element).append(" ", b);
			await wait(60);
			e.insertAdjacentHTML("beforeend", "<ul><li>un</li><li>deux</li></ul>");
			await wait(60);
			(e.querySelector("li") as Element).remove();
		},
	},
	{
		name: "contenteditable, champ autorisé",
		group: "contenteditable",
		html: D('<div id="e" contenteditable="true" data-va-unmask><p>début</p></div>'),
		keys: [["#e", " visible"]],
	},
	{
		name: "srcset et <picture>",
		group: "nouveaux",
		html: D('<picture id="pi"><source srcset="a.webp 1x, b.webp 2x" type="image/webp"><img id="im" src="c.png" srcset="c.png 1x, d.png 2x" alt=""></picture>'),
		run: (d) => {
			const im = d.getElementById("im") as HTMLImageElement;
			im.srcset = "e.png 1x, f.png 3x";
			im.sizes = "50vw";
			const s = d.createElement("source");
			s.srcset = "g.avif";
			s.type = "image/avif";
			d.getElementById("pi")?.prepend(s);
		},
	},
	{
		name: "<noscript>",
		group: "nouveaux",
		html: D('<noscript><p id="n">Activez JavaScript</p></noscript><p>après</p>', "<noscript><style>body{background:red}</style></noscript>"),
		run: (d) => {
			const n = d.createElement("noscript");
			n.innerHTML = "<b>vu sans script</b>";
			d.body.append(n);
		},
	},
	{
		name: "document en mode quirks",
		group: "nouveaux",
		html: '<html><head><title>q</title></head><body><table id="t"><tr><td>quirks</td></tr></table><p id="p">x</p></body></html>',
		run: (d) => {
			(d.getElementById("p") as Element).textContent = "y";
		},
	},
	{
		name: "liens javascript: désarmés",
		group: "nouveaux",
		html: D('<a id="a" href="javascript:alert(1)" onclick="alert(2)" target="_top">x</a>'),
		run: (d) => {
			(d.getElementById("a") as Element).setAttribute("href", "javascript:alert(3)");
		},
	},
	{
		name: "CSSOM insertRule",
		group: "styles",
		html: D('<p class="a">a</p><p class="b">b</p>', '<style id="s">.a{color:red}</style>'),
		run: async (d, _w, wait) => {
			((d.getElementById("s") as HTMLStyleElement).sheet as CSSStyleSheet).insertRule(".b { color: blue; }", 1);
			const e = d.createElement("style");
			d.head.append(e);
			(e.sheet as CSSStyleSheet).insertRule(".a { font-weight: 700; }");
			await wait(200);
			((d.getElementById("s") as HTMLStyleElement).sheet as CSSStyleSheet).deleteRule(0);
		},
	},
	{
		name: "adoptedStyleSheets",
		group: "styles",
		html: D('<p class="a">a</p><div id="h"></div>'),
		run: async (d, w, wait) => {
			const s1 = new w.CSSStyleSheet();
			s1.replaceSync(".a { color: green; }");
			d.adoptedStyleSheets = [s1];
			const r = (d.getElementById("h") as Element).attachShadow({ mode: "open" });
			const s2 = new w.CSSStyleSheet();
			s2.replaceSync("b { color: red; }");
			r.adoptedStyleSheets = [s2];
			r.innerHTML = "<b>ombre</b>";
			await wait(60);
			s1.insertRule(".a { color: blue; }", 1);
		},
	},
	{
		name: "CSS-in-JS au départ",
		group: "styles",
		html: D('<p class="a">a</p>', '<style id="s"></style>'),
		before: (d) => {
			((d.getElementById("s") as HTMLStyleElement).sheet as CSSStyleSheet).insertRule(".a { color: purple; }");
		},
	},
];
