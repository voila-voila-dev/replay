// The numbers of the last bench run: rrweb against @voila.dev/replay, same pages, same masking,
// same browser. bench.json is written by `bun run scripts/bench.ts` from the lab's results.
import bench from "./bench.json";

export { bench };
export type Page = (typeof bench.pages)[number];

export const benchRepo = "https://github.com/voila-voila-dev/replay";
export const sizes = bench.sizes;

/** The heaviest page: where the difference shows the most. */
const heaviest = bench.pages.reduce((a, b) => ((b.elements ?? 0) > (a.elements ?? 0) ? b : a));
export const headline = {
	page: heaviest.name,
	elements: heaviest.elements,
	startRatio: ((heaviest.rrweb.longest ?? 0) / (heaviest.replay.longest ?? 1)).toFixed(1),
	rrwebStart: Math.round(heaviest.rrweb.longest ?? 0),
	replayStart: Math.round(heaviest.replay.longest ?? 0),
	sizeRatio: ((sizes.rrweb.record ?? 0) / (sizes.replay.record ?? 1)).toFixed(1),
};

/** The pages a visitor would recognise: the real sites, not the fixtures. */
export const realPages = bench.pages.filter((p) => p.id === "jardins" || p.id === "wikipedia" || p.id === "lemonde");

export const ratio = (a: number | null, b: number | null) => (a && b ? a / b : null);
