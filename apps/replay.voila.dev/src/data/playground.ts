// The playground records Wikipedia articles, served from this site by the Worker
// (worker/index.ts, /playground/wiki/<lang>/wiki/<title>).
const ARTICLE = /^(?:https?:\/\/)?([a-z]{2,3}(?:-[a-z]{2,8})?)(?:\.m)?\.wikipedia\.org\/wiki\/([^?#]+)/i;

export const playground = {
	/** The page is laid out at a desktop size, then scaled with its copy to fit. */
	width: 1100,
	height: 760,
	/** Where the copy may load pictures from, besides this site. */
	sources: ["https://upload.wikimedia.org", "https://thumb.wikimedia.org", "https://*.wikipedia.org"],
	presets: [
		{ label: "Ada Lovelace", url: "https://en.wikipedia.org/wiki/Ada_Lovelace" },
		{ label: "Bassin d'Arcachon", url: "https://fr.wikipedia.org/wiki/Bassin_d%27Arcachon" },
		{ label: "World Wide Web", url: "https://en.wikipedia.org/wiki/World_Wide_Web" },
		{ label: "Tour de France", url: "https://fr.wikipedia.org/wiki/Tour_de_France" },
	],
	/** The path of an article served here, from its Wikipedia address; null when it is not one. */
	path(address: string): string | null {
		const m = ARTICLE.exec(address.trim());
		if (!m) return null;
		const [, lang, title] = m;
		return `/playground/wiki/${(lang as string).toLowerCase()}/wiki/${title}`;
	},
};
