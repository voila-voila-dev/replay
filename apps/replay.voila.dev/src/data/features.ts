// Every feature of the library, as the home page lists them. `demo` is an anchor of /demos,
// `docs` a page of the docs once they exist; each claim matches the README and the code.
export type Group = "Recorder" | "Privacy" | "Network" | "Player";
export type Feature = { group: Group; name: string; text: string; link?: { href: string; label: string } };

const demo = (id: string) => ({ href: `/demos#${id}`, label: "See it live" });

export const features: Feature[] = [
	{ group: "Recorder", name: "Read at rest", text: "Changes are only noted; the page is read at most every 50 ms. Pointer, taps and scroll go at once.", link: { href: "/benchmark", label: "Benchmark" } },
	{ group: "Recorder", name: "6 KB", text: "The recorder alone, gzip. 7.8 KB with sending. Zero dependencies.", link: { href: "/benchmark#weight", label: "Weights" } },
	{ group: "Recorder", name: "Modules", text: "Shadow DOM, iframes, canvas, CSSOM: load only what your pages use.", link: demo("modules") },
	{ group: "Recorder", name: "Fails alone", text: "A module that throws is cut and named on the tape. The rest goes on. Past 8 MB, recording stops cleanly." },

	{ group: "Privacy", name: "Masked by default", text: "Typed values leave as six stars, whatever their length. Or mask all text. Or none.", link: demo("privacy") },
	{ group: "Privacy", name: "Always hidden", text: "Passwords, card numbers, one-time codes and hidden fields, whatever the mode.", link: demo("privacy") },
	{ group: "Privacy", name: "Per element", text: "data-va-mask, data-va-unmask, and data-va-block: an empty box of the same size.", link: demo("privacy") },
	{ group: "Privacy", name: "A copy that cannot act", text: "A sandboxed iframe without scripts. Handlers, javascript: links and <base> are dropped." },

	{ group: "Network", name: "By hash", text: "Snapshots are cut by content into ~4 KB pieces. What the server already holds goes as a hash." },
	{ group: "Network", name: "Holes said", text: "A lost chunk is marked, never papered over. Play resumes at the next snapshot.", link: demo("holes") },
	{ group: "Network", name: "Beacon on the way out", text: "What is left leaves with the page, in one beacon. Chunks are retried, then given up cleanly." },
	{ group: "Network", name: "Back/forward cache", text: "Back from the cache, a new snapshot is due: the page view goes on from it." },

	{ group: "Player", name: "Seek from checkpoints", text: "A copy of the page every 10 s of tape. Seeking back never replays from the start.", link: demo("player") },
	{ group: "Player", name: "Speed and idle", text: "1×, 2×, 4×. Idle stretches over 5 s shrink to one.", link: demo("player") },
	{ group: "Player", name: "Pointer and taps", text: "The visitor's pointer, and where they pressed, drawn over the copy.", link: demo("live") },
	{ group: "Player", name: "Checked copy", text: "A fingerprint on the tape lets the player check its copy against the page. Pictures load from kept copies only." },
];
