// The docs' navigation, in reading order: previous and next follow it.
import type { NavGroup } from "@voila.dev/site/lib/types";

export const docsNav: NavGroup[] = [
	{
		title: "Start",
		items: [
			{ href: "/docs/getting-started", label: "Getting started" },
			{ href: "/docs/browsers", label: "Browsers" },
		],
	},
	{
		title: "Record",
		items: [
			{ href: "/docs/recording", label: "Recording" },
			{ href: "/docs/privacy", label: "Privacy" },
			{ href: "/docs/modules", label: "Modules" },
		],
	},
	{
		title: "Send and store",
		items: [
			{ href: "/docs/sending", label: "Sending" },
			{ href: "/docs/server", label: "Your endpoint" },
		],
	},
	{
		title: "Play",
		items: [
			{ href: "/docs/playing", label: "Playing" },
			{ href: "/docs/tape", label: "The tape" },
		],
	},
];
