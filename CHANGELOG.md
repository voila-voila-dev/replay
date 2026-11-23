# @voila.dev/replay

## 0.4.1

### Patch Changes

- [#15](https://github.com/voila-voila-dev/replay/pull/15) [`70755a5`](https://github.com/voila-voila-dev/replay/commit/70755a528b9f33f4394de90be0e44c45f44b3c3c) Thanks [@emilienbidet](https://github.com/emilienbidet)! - fix(play): what the copy shows matches the page in two more places.

  - A blocked element the page does not render (`display: none`, recorded as a box of no size) is hidden in the copy. Shown as an empty `inline-block`, it still took a slot in a flex or grid layout, and the gap with it: what came after moved down.
  - A canvas's picture shows in the copy. The copy runs no script, and a canvas in a document without scripts renders its fallback content, never its bitmap: the pixels `canvas()` recorded were drawn but never seen. The player now also puts the picture as the canvas's background, and keeps it there when the page's style changes.

  The browser suite gets a group for what the copy shows beyond its tree (the oracle compares nodes, not layout nor pixels): the layout around a hidden blocked box, and a canvas's picture.

## 0.4.0

### Minor Changes

- [#11](https://github.com/voila-voila-dev/replay/pull/11) [`871d8ee`](https://github.com/voila-voila-dev/replay/commit/871d8eee3df734b34ef5edbf95a21063e3dbaf96) Thanks [@emilienbidet](https://github.com/emilienbidet)! - feat(play): pictures load from their kept copies only. Of a `srcset`, the candidates without a copy are dropped (all kept when none has one), so the viewer's screen no longer picks a picture from the site as it is today. `createPlayer({ sources })` restricts the copy to those origins for pictures, fonts and media: an address left uncopied is refused rather than fetched.

## 0.3.1

### Patch Changes

- [#9](https://github.com/voila-voila-dev/replay/pull/9) [`e01c0b3`](https://github.com/voila-voila-dev/replay/commit/e01c0b360338f63778adb1d768e99ecfca0bd4e0) Thanks [@emilienbidet](https://github.com/emilienbidet)! - fix(play): a reference inside the page (`<use href="#icon">`, `<a href="#main">`) stays one in the copy. Made absolute, it pointed at the recorded site, which the sandboxed copy refuses to load: icons drawn with `<use>` showed empty.

## 0.3.0

### Minor Changes

- [#7](https://github.com/voila-voila-dev/replay/pull/7) [`e036911`](https://github.com/voila-voila-dev/replay/commit/e0369119b732ef0d6253e398308ce73f741c7cca) Thanks [@emilienbidet](https://github.com/emilienbidet)! - An image that picks its picture (`srcset`, `<picture>`) says which one it shows: a new framed op, `SHOWN`. The player shows that picture, whatever the viewer's screen would pick, and a server that keeps the pictures of a recording only needs that one.

## 0.2.0

### Minor Changes

- [#5](https://github.com/voila-voila-dev/replay/pull/5) [`66cbd7d`](https://github.com/voila-voila-dev/replay/commit/66cbd7d9fbb3622447f11034e917f03deaa3570f) Thanks [@emilienbidet](https://github.com/emilienbidet)! - The player takes `asset(url)`: where to load a picture or a font from, given its address on the page. A copy kept when the page was recorded outlives the file the site later renamed or replaced. A stylesheet keeps its address, its rules being on the tape.

## 0.1.1

### Patch Changes

- [#2](https://github.com/voila-voila-dev/replay/pull/2) [`087599a`](https://github.com/voila-voila-dev/replay/commit/087599ab159b32650b1a66250288b921f5e2f943) Thanks [@emilienbidet](https://github.com/emilienbidet)! - `connect` keeps the long strings a chunk refers to until the server stops asking. A long string inside a snapshot piece (a stylesheet, a picture) was dropped after the first answer, before the server, having read the piece, could ask for it: the first visitors of a page sent copies without their stylesheets.

## 0.1.0

### Minor Changes

- [`f0b4616`](https://github.com/voila-voila-dev/replay/commit/f0b4616b5cbfa2722ee3756153f90001a0a1031d) Thanks [@emilienbidet](https://github.com/emilienbidet)! - First release: the recorder, the tape format v2, sending, the DOM-built player with its checkpoints, the modules (canvas, CSSOM, dialogs and popovers) and the testing kit (cases, fuzzer, oracle).
