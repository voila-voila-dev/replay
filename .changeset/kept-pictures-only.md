---
"@voila.dev/replay": minor
---

feat(play): pictures load from their kept copies only. Of a `srcset`, the candidates without a copy are dropped (all kept when none has one), so the viewer's screen no longer picks a picture from the site as it is today. `createPlayer({ sources })` restricts the copy to those origins for pictures, fonts and media: an address left uncopied is refused rather than fetched.
