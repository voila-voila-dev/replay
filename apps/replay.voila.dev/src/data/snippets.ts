// The code shown on the site, in one place: the home page, the demos and the docs show the same.
export const recordSnippet = `// bun add @voila.dev/replay
import { record } from "@voila.dev/replay/record";
import { connect } from "@voila.dev/replay/send";

const rec = record(window, { mask: "inputs" });
const link = connect({ endpoint: "/replay", head });
link.send(rec.snap());
setInterval(() => link.send(rec.drain()), 5000);
addEventListener("pagehide", () => link.leave(rec.drain()));`;

export const playSnippet = `// later, wherever you watch
import { createPlayer } from "@voila.dev/replay/play";

const player = createPlayer({ root, chunks });
player.play();
player.seek(42_000); // from the nearest checkpoint`;

export const demoSnippet = `// the recorded page lives in an iframe
const rec = record(frame.contentWindow, { mask, modules: [cssom()] });
const snap = rec.snap();
const player = createPlayer({
  root: stage,
  chunks: [{ base: snap.base, seq: 0, tape: snap.tape }],
});

setInterval(() => {
  const d = rec.drain();
  player.append([{ base: d.base, seq: ++seq, tape: d.tape }]);
  if (!player.playing) player.play();
}, 250);`;

export const suiteSnippet = `# the library's own suite
git clone https://github.com/voila-voila-dev/replay
cd replay && bun install
bun test test/unit          # format, sending
npm run test:browser        # 48 cases × 3 engines
node test/browser/fuzz.mjs  # random mutations
npm run size                # fails over budget`;
