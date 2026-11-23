// The copy of the home page.
import { headline, sizes } from "./bench";

export const marquee = [`${sizes.replay.send} KB recorder`, "Masked by default", "Says when it misses", "Seeks without replaying", "No HTML parser", "Open source · MIT"];

export const statuses = {
	measured: { label: "Measured", color: "#1fbf75" },
	built: { label: "Built", color: "#2633ff" },
};

export const fixes = [
	{ pain: "The recorder freezes the page it records.", fix: `The page is read at rest, at most every 50 ms. ${headline.startRatio}× shorter start than rrweb.`, status: "measured" },
	{ pain: `A ${sizes.rrweb.record} KB script for a feature visitors never see.`, fix: `${sizes.replay.send} KB gzip, recording and sending included.`, status: "measured" },
	{ pain: "Every visitor uploads the same stylesheets again.", fix: "What the server already holds goes as a hash.", status: "built" },
	{ pain: "Passwords and card numbers end up on your servers.", fix: "Masked in the core, before any module. Always.", status: "built" },
	{ pain: "A chunk gets lost and the replay quietly lies.", fix: "The hole is marked. Play resumes at the next snapshot.", status: "built" },
	{ pain: "Seeking back replays the whole session.", fix: "A checkpoint every 10 s. Seeks start from the nearest.", status: "built" },
	{ pain: "The replay runs the site's scripts.", fix: "Rebuilt through the DOM API, in a sandbox, without scripts.", status: "built" },
	{ pain: "One broken plugin kills the recording.", fix: "A module that throws is cut alone. The rest goes on.", status: "built" },
];

export const steps: Array<[string, string]> = [
	["Record", "A snapshot, then what changed. Typed values stay on the page."],
	["Send", "Chunks to your endpoint. A beacon on the way out."],
	["Play", "A sandboxed copy, rebuilt node by node. Seek anywhere."],
];
