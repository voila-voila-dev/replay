---
"@voila.dev/replay": patch
---

`connect` keeps the long strings a chunk refers to until the server stops asking. A long string inside a snapshot piece (a stylesheet, a picture) was dropped after the first answer, before the server, having read the piece, could ask for it: the first visitors of a page sent copies without their stylesheets.
