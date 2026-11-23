# replay.voila.dev

The site of replay, on [replay.voila.dev](https://replay.voila.dev): Astro, fully static, served by Cloudflare Workers static assets. Same design as [freewheel.voila.dev](https://freewheel.voila.dev) and [voila.dev](https://voila.dev).

```sh
bun install                      # at the root of the repo (workspace)
bun run build                    # at the root: the library, which the demos import
cd apps/replay.voila.dev
bun run dev                      # http://localhost:4321
bun run build                    # dist/
```

- The demos run the library of this repo (`workspace:*`), so the site always shows the code on `main`: `public/demo/shop.html` is the page recorded, `src/scripts/live.ts` records it and plays it back.
- Bench numbers in `src/data/bench.json`, from the replay lab (`~/Documents/replay-lab/bench-replay`, `node scripts/run-all.mjs`), written by `bun run scripts/bench.ts`. Run it again when a version changes the recorder.
- Push to `main` deploys (`.github/workflows/site.yml` at the root); a pull request uploads a preview version and comments its URL.
