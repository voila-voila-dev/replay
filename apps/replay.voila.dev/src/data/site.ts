// What every page of replay.voila.dev shares: the links, the top bar, the footer, the call to action.
import type { Link } from "@voila.dev/site/lib/types";

export const repo = "https://github.com/voila-voila-dev/replay";
export const npm = "https://www.npmjs.com/package/@voila.dev/replay";
// The library lives at the root of this repo: the site always shows the version it is built with.
export { version } from "../../../../package.json";

/** Recorder support: below these, `record` returns null and the page goes on untouched. */
export const browsers = ["Safari 15.4", "Chrome 92", "Edge 92", "Firefox 90"];

export const siteName = "replay";

export const links: Link[] = [
	{ href: "/docs", label: "Docs" },
	{ href: "/demos", label: "Demos" },
	{ href: "/playground", label: "Playground" },
	{ href: "/benchmark", label: "Benchmark" },
];

export const footer = {
	note: "replay · MIT · by",
	by: { href: "https://voila.dev", label: "VOILA DEVELOPMENT" },
	email: "emilien@voila.dev",
	links: [
		{ href: "/docs", label: "Docs" },
		{ href: "/demos", label: "Demos" },
		{ href: "/benchmark", label: "Benchmark" },
		{ href: repo, label: "GitHub" },
		{ href: npm, label: "npm" },
		{ href: "https://voila.dev/legal", label: "Legal" },
	],
};

export const cta = {
	text: "Recording sessions with rrweb? Tell us what it costs you.",
	buttons: [
		{ href: "mailto:emilien@voila.dev?subject=replay", label: "Get in touch" },
		{ href: repo, label: "Star on GitHub ↗" },
	],
};
