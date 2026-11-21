# @voila.dev/replay

## 0.2.0

### Minor Changes

- [#5](https://github.com/voila-voila-dev/replay/pull/5) [`66cbd7d`](https://github.com/voila-voila-dev/replay/commit/66cbd7d9fbb3622447f11034e917f03deaa3570f) Thanks [@emilienbidet](https://github.com/emilienbidet)! - The player takes `asset(url)`: where to load a picture or a font from, given its address on the page. A copy kept when the page was recorded outlives the file the site later renamed or replaced. A stylesheet keeps its address, its rules being on the tape.

## 0.1.1

### Patch Changes

- [#2](https://github.com/voila-voila-dev/replay/pull/2) [`087599a`](https://github.com/voila-voila-dev/replay/commit/087599ab159b32650b1a66250288b921f5e2f943) Thanks [@emilienbidet](https://github.com/emilienbidet)! - `connect` keeps the long strings a chunk refers to until the server stops asking. A long string inside a snapshot piece (a stylesheet, a picture) was dropped after the first answer, before the server, having read the piece, could ask for it: the first visitors of a page sent copies without their stylesheets.

## 0.1.0

### Minor Changes

- [`f0b4616`](https://github.com/voila-voila-dev/replay/commit/f0b4616b5cbfa2722ee3756153f90001a0a1031d) Thanks [@emilienbidet](https://github.com/emilienbidet)! - First release: the recorder, the tape format v2, sending, the DOM-built player with its checkpoints, the modules (canvas, CSSOM, dialogs and popovers) and the testing kit (cases, fuzzer, oracle).
