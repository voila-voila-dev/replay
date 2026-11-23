---
"@voila.dev/replay": patch
---

fix(play): what the copy shows matches the page in two more places.

- A blocked element the page does not render (`display: none`, recorded as a box of no size) is hidden in the copy. Shown as an empty `inline-block`, it still took a slot in a flex or grid layout, and the gap with it: what came after moved down.
- A canvas's picture shows in the copy. The copy runs no script, and a canvas in a document without scripts renders its fallback content, never its bitmap: the pixels `canvas()` recorded were drawn but never seen. The player now also puts the picture as the canvas's background, and keeps it there when the page's style changes.

The browser suite gets a group for what the copy shows beyond its tree (the oracle compares nodes, not layout nor pixels): the layout around a hidden blocked box, and a canvas's picture.
