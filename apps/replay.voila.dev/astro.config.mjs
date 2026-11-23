import { fileURLToPath } from "node:url";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// The demos run the library of this repo, from its sources: `@voila.dev/replay/play` is `src/play/index.ts`.
const library = fileURLToPath(new URL("../../src", import.meta.url));

export default defineConfig({
	site: "https://replay.voila.dev",
	trailingSlash: "never",
	build: { format: "directory" },
	integrations: [sitemap({ filter: (page) => !page.includes("/demo/") })],
	vite: {
		resolve: {
			alias: [{ find: /^@voila\.dev\/replay\/(\w+)$/, replacement: `${library}/$1/index.ts` }],
		},
	},
});
