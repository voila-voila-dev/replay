// Builds the package (one ESM file per entry point, TypeScript enums inlined) and the bundles
// the browser tests load.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { build } from "esbuild";

const entries = ["format", "record", "send", "play", "modules", "testing"];
rmSync("dist", { recursive: true, force: true });
await build({
	entryPoints: Object.fromEntries(entries.map((e) => [e, `src/${e}/index.ts`])),
	outdir: "dist",
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2021",
	splitting: true,
	chunkNames: "shared/[name]-[hash]",
	logLevel: "warning",
});
execSync("npx tsc -p tsconfig.json", { stdio: "inherit" });

await build({
	entryPoints: { lab: "test/browser/lab.ts", recorder: "test/browser/recorder.ts", visit: "test/browser/visit.ts" },
	outdir: "test/browser/build",
	bundle: true,
	format: "iife",
	platform: "browser",
	target: "es2021",
	logLevel: "warning",
});
