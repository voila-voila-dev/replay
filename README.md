# @voila.dev/replay

Session recording and replay for the web. A small recorder, a flat tape format, and a player that rebuilds the page through the DOM API, never through the HTML parser.

```ts
import { record } from "@voila.dev/replay/record";
import { connect } from "@voila.dev/replay/send";
import { cssom, shadow } from "@voila.dev/replay/modules";

const recorder = record(window, { mask: "inputs", modules: [shadow(), cssom()] });
const link = connect({ endpoint: "/replay", head: () => ({ url: location.href, pv: pageViewId }) });
link.send(recorder.snap());
setInterval(() => link.send(recorder.drain()), 5000);
addEventListener("pagehide", () => link.leave(recorder.drain()));
```

```ts
import { createPlayer } from "@voila.dev/replay/play";

const player = createPlayer({ root, chunks });
player.play();
```

## What it does

- **One flat tape.** An opcode, then its operands (`src/format`). Nodes are numbered implicitly, in the order they are made, on both sides. Codes from 128 are framed, so an older player skips what it does not know.
- **The page is read at rest.** The `MutationObserver` only notes what changed; the page is read at most every 50 ms. What the visitor does (pointer, taps, scroll, focus, size) is written at once, with its own tick.
- **Masking happens in the core, before any module.** Typed values are hidden by default (`mask: "inputs"`), all text with `mask: "text"`, nothing with `mask: "none"`. Passwords, card numbers, one-time codes and hidden fields are always hidden. `data-va-mask`, `data-va-unmask` and `data-va-block` refine it per element. `contenteditable` is replayed whole, its text as stars of the same length.
- **What the server may already hold goes as a hash.** A snapshot is cut by its content into pieces of about 4 KB; long strings (stylesheets, pictures) go by hash too.
- **Holes are said, not replayed.** Each chunk carries its rank and the number its first node takes; the player marks a hole and resumes at the next snapshot. A fingerprint (`PRINT`) lets the player check its copy against the page.
- **Seeking back does not replay from the start.** Every 10 s of tape, the player keeps a checkpoint: a copy of the rebuilt page in a document of no window, its node numbers, and what a copy does not carry (constructed sheets and who adopts them, canvas pixels, modal dialogs and popovers, scroll positions, frames' documents). A seek starts from the nearest checkpoint or snapshot before it. Past 64 checkpoints, one in two goes.
- **The copy cannot act.** It plays in a sandboxed iframe without scripts; event handlers, `javascript:` URLs, `<script>`, `<base>` and `target` are dropped.

## Browsers

Recorder: Safari 15.4, Chrome and Edge 92, Firefox 90 and later. Below, `record` returns `null`.

## Tests

```
bun test test/unit          # format, sending, joining chunks
npm run test:browser        # 46 cases, each also played back through a checkpoint; Chromium, WebKit and Firefox
node test/browser/fuzz.mjs  # random mutations, the copy judged after each round
npm run size
```

## License

MIT
