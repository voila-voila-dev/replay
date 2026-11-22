---
"@voila.dev/replay": patch
---

fix(play): a reference inside the page (`<use href="#icon">`, `<a href="#main">`) stays one in the copy. Made absolute, it pointed at the recorded site, which the sandboxed copy refuses to load: icons drawn with `<use>` showed empty.
