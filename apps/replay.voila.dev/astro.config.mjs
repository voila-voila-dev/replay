import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: "https://replay.voila.dev",
	trailingSlash: "never",
	build: { format: "directory" },
	integrations: [sitemap()],
});
