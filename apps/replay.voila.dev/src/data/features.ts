// Every feature of the library, in four groups, as the home page lists them; each links to its docs.
export type FeatureGroup = { group: string; items: Array<{ name: string; href: string }> };

export const features: FeatureGroup[] = [
	{
		group: "Recorder",
		items: [
			{ name: "Reads the page at rest", href: "/docs/recording#when-things-are-written" },
			{ name: "6 KB gzip", href: "/benchmark#weight" },
			{ name: "Modules on demand", href: "/docs/modules" },
			{ name: "A failing module stays alone", href: "/docs/modules#when-a-module-fails" },
		],
	},
	{
		group: "Privacy",
		items: [
			{ name: "Masked by default", href: "/docs/privacy" },
			{ name: "Passwords never leave", href: "/docs/privacy#always-hidden" },
			{ name: "Mask, block, unmask", href: "/docs/privacy#per-element" },
			{ name: "A copy that runs no script", href: "/docs/privacy#the-copy-cannot-act" },
		],
	},
	{
		group: "Network",
		items: [
			{ name: "Sent once, by hash", href: "/docs/sending#what-goes-on-the-wire" },
			{ name: "Holes marked, never hidden", href: "/docs/playing#holes" },
			{ name: "A beacon on the way out", href: "/docs/sending" },
			{ name: "Back/forward cache", href: "/docs/recording#a-page-view-start-to-end" },
		],
	},
	{
		group: "Player",
		items: [
			{ name: "Seek from checkpoints", href: "/docs/playing#seeking" },
			{ name: "1×, 2×, 4×, skip idle", href: "/docs/playing" },
			{ name: "Follow a session live", href: "/docs/playing#following-live" },
			{ name: "Checked against the page", href: "/docs/tape" },
		],
	},
];

export const featureCount = features.reduce((n, g) => n + g.items.length, 0);
