// What a visitor downloads, minified and gzipped: the core with sending, then each module.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const bundle = async (contents) => {
	const out = await build({
		stdin: { contents, resolveDir: ".", loader: "ts" },
		bundle: true,
		minify: true,
		format: "iife",
		target: "es2021",
		write: false,
	});
	const code = out.outputFiles[0].contents;
	return gzipSync(code, { level: 9 }).length;
};

const core = await bundle(`import { record } from "./src/record/index"; import { connect } from "./src/send/index"; globalThis.r = [record, connect];`);
const lines = [["cœur + envoi", core, 4096]];
for (const m of ["shadow", "iframes", "canvas", "cssom"]) {
	const all = await bundle(`import { record } from "./src/record/index"; import { connect } from "./src/send/index"; import { ${m} } from "./src/modules/index"; globalThis.r = [record, connect, ${m}];`);
	lines.push([`module ${m}`, all - core, 400]);
}
lines.push(["lecteur", await bundle(`import { createPlayer } from "./src/play/index"; globalThis.p = createPlayer;`), 8192]);
let over = false;
for (const [name, bytes, budget] of lines) {
	const flag = bytes > budget ? "  AU-DESSUS" : "";
	if (flag) over = true;
	console.log(`${name.padEnd(16)} ${String(bytes).padStart(6)} o gzip  (budget ${budget})${flag}`);
}
process.exit(over ? 1 : 0);
