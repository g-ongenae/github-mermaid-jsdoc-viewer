# CLAUDE.md — GitHub Mermaid JSDoc Viewer

## What this is

Browser extension (Chrome MV3, Firefox MV2, Safari) that scans JSDoc comments in JS/TS files (and plain fenced blocks in Markdown files) on GitHub blob pages _and_ PR "Files changed" / commit diff pages for ` ```mermaid ` fenced code blocks and overlays a small badge next to the line number to preview the diagram (via mermaid.ink) or open it in the full mermaid.live editor. Sibling project to [`mermaid-jsdoc-viewer`](https://github.com/g-ongenae/mermaid-jsdoc-viewer) (the VS Code equivalent) and modeled architecturally on [`pr-review-collector`](https://github.com/g-ongenae/pr-review-collector) (another GitHub content-script extension by the same author).

## Project structure

```
content_script.js      — Parsing, DOM scan, badge overlay, preview modal (single IIFE)
viewer.css              — Badge + modal styles (light/dark mode)
scripts/build-pako.js   — Copies pako's browser build from node_modules into place at install time
pako_deflate.min.js     — Built, not committed (see "Build step" below); exposes global `pako`
popup.html / popup.js   — Extension popup (version display, status check)
manifest.chrome.json    — Chrome/Edge/Brave (MV3)
manifest.firefox.json   — Firefox (MV2)
manifest.json           — Generated copy of the active manifest (gitignored)
icon.svg                — Extension icon (shared design with mermaid-jsdoc-viewer — see "Icon" below)
PRIVACY.md              — Privacy policy linked from both store listings; keep in sync with what the code actually sends
LICENSE                 — MIT license for this project
PAKO_LICENSE            — pako's license, also built by scripts/build-pako.js — not committed
```

## Build step

`npm install` (via its `postinstall` script) runs `npm run build`, which copies `node_modules/pako/dist/pako_deflate.min.js` to the project root as `pako_deflate.min.js` (the file the manifests' `content_scripts` load directly) and `node_modules/pako/LICENSE` to `PAKO_LICENSE`. Both files are gitignored and must not be committed; regenerate them with `npm run build` any time they're missing (e.g. right after cloning, before loading the extension unpacked). Beyond this one copy step there's no bundler — every other JS/CSS file is loaded as-is by the browser extension runtime.

## Commands

```sh
npm run build          # regenerate pako_deflate.min.js (also runs automatically after npm install)
npm run check          # lint + format check (CI runs this)
npm run lint           # eslint
npm run lint:fix       # eslint --fix
npm run format         # prettier --write
npm run format:check   # prettier --check
```

There are no automated tests, but selector changes should not be guessed from memory — see "Verifying selector changes" below. Manual validation: load the extension, open a GitHub blob page and a PR "Files changed" page for a JS/TS file with a `mermaid` fence inside a JSDoc block, and check the badge appears next to the line number and opens the preview on click.

## Verifying selector changes

GitHub's DOM/embedded-payload shape is not a public API and has already changed once during this extension's development (an earlier version's diff-page selectors were guessed via `curl`, which happened to hit a different, unauthenticated rendering path than what a real logged-in browser session serves — it looked plausible and was completely wrong). Do not guess selectors from memory or from a bare `curl` fetch of a GitHub page: unauthenticated/no-JS fetches can silently return a different code path (e.g. a classic server-rendered diff table) than what actually renders in a real session.

Instead: ask for (or use) a saved copy of the _actual rendered_ page HTML — in a browser, open DevTools → right-click the `<html>` element → Copy → Copy outerHTML (or a full "Save Page As → Webpage, HTML only") on a real, logged-in view of the page — then grep/parse that file directly (Node's `JSDOM` is useful for querying it exactly like a content script would). Keep any such saved pages purely local and gitignored — don't commit them or reference their filenames in tracked docs, since they're throwaway fixtures, not part of the project. Confirm a new selector against one — ideally running the real `findMermaidBlocksFromNumberedLines`/`getDiff*`/`getBlob*` functions from `content_script.js` against a JSDOM of it — before committing to it.

## Icon

Deliberately the same SVG as [`mermaid-jsdoc-viewer`](https://github.com/g-ongenae/mermaid-jsdoc-viewer)'s `assets/icon.svg` — same author, same goal (view a mermaid diagram from a JSDoc comment), different context (browser vs. editor). Keep them in sync if one is redesigned.

## Code conventions

- Single file (`content_script.js`) wrapped in an IIFE — no modules, no imports (matches `pr-review-collector`).
- Prettier: single quotes, trailing commas, 120 print width, 2-space indent.
- ESLint: `@eslint/js` recommended, browser + webextensions globals, `pako` declared as a readonly global (built, not bundled), `no-console` off.
- Commit style: `type: short description` (feat/fix/refactor/docs), max ~60 char title.

## Architecture notes

- **Parsing** (`findMermaidBlocksFromNumberedLines(lines, kind)`) is a port of the VS Code extension's JSDoc-region + fence-tracking state machine, generalized to operate over a `{lineNumber, text}[]` list instead of a dense line array. A gap between consecutive line numbers (not-yet-mounted content, or a diff hunk/file boundary) resets any in-progress parse — this is what keeps diff scanning from stitching content across hunks/files together. `kind` (from `getFileKind(path)`) is `'jsdoc'` for JS/TS (fence must be inside `/** ... */`, `*` prefix stripped via `normalizeDiagramLine`) or `'markdown'` (plain fences, text kept as-is). In jsdoc mode, a segment (file start or post-gap hunk) whose first line is a comment _body_ line (`isJsDocBodyLine`: starts with `*` but not `*/`) is assumed to already be inside a JSDoc comment — GitHub's default 3 context lines routinely start at the `* ```mermaid` fence with the `/**` opener out of view, which used to make such blocks invisible. Only applied at segment starts, so a stray `*` line mid-file can't open a phantom comment.
- **Blob pages** — two strategies for reading source lines, most reliable first:
  1. `getBlobLinesFromEmbeddedPayload()` — reads `script[data-target="react-app.embeddedData"]`'s `payload['codeViewBlobLayoutRoute.StyledBlob'].rawLines` that GitHub's react code view uses to hydrate itself (plain text). Large files leave this `null` (deferred to a client-side fetch) — the exact size threshold is unknown, so don't assume this always works.
  2. `getBlobLinesFromDom()` — fallback: reads `[data-testid="code-cell"][data-line-number]` elements (current react code view), or walks `id="LC<n>"` sequentially (older GitHub / classic table rendering).
  - `getBlobLineAnchor()` resolves the badge's anchor to the line-number _gutter_ element (`.react-line-number[data-line-number]`, falling back to `.blob-num`/`#L<n>`/`#LC<n>`) — not the content cell — so the badge sits next to the line number as intended.
- **Diff pages** (PR "Files changed", commit diffs) — each file is `<div role="region" id="diff-<hash>" aria-labelledby="heading-...">`; the file path is the linked heading's `<code>` text (strip the `‎` LRM marker GitHub wraps it in). `collectDiffEntries(root, side)` reads, for each `tr.diff-line-row`, the `td.new-diff-line-number[data-diff-side="<side>"][data-line-number]` cell for the requested side's line number and the row's single `td.diff-text-cell`'s `.diff-text-inner` for the text — context rows carry a line number on _both_ sides (their code cell is shared, tagged `data-diff-side="right"` regardless), so calling this with `side: 'left'` reconstructs the diff's _old_ content, and `side: 'right'` the _new_ content (deletion-only rows have no right-side number cell, addition-only rows no left-side one — each side naturally sees only what existed on it). `getDiffLineNumberAnchor()` anchors to the visible `td.new-diff-line-number[data-diff-side="right"]` gutter cell.
- **Before/after detection** (`extractDiffOldCode`): for a block found on the new side, the fence-open/fence-close entries' `startIndex`/`endIndex` (see below) give the exact `<tr>` rows bounding it. If both rows also have a left-side line-number cell (i.e. the fences themselves are unchanged context, not newly added), that gives an old-line-number range; filtering the full-file "old" entries to strictly between those bounds and re-joining (with the same `stripJsDocPrefix` used everywhere else) reconstructs what the diagram looked like before. `placeBadge` compares this to the new code — a mismatch renders as a 🔀 badge opening `openCompareModal` instead of a 📊 badge opening the normal single `openModal`. Returns `null` (no comparison, just show the new diagram) when the fences themselves were added or a boundary row can't be resolved.
- `findMermaidBlocksFromNumberedLines` blocks carry `startIndex`/`endIndex` — indices into the input array marking the fence-open/fence-close entries — purely so diff scanning can map a block back to its originating `<tr>` rows for the before/after lookup above. Blob-page callers ignore them.
- **Encoding** (`encodeMermaidState`) mirrors the VS Code extension exactly: JSON state object → `pako.deflate` → base64url. Produces the `pako:<...>` fragment used by both `mermaid.live/edit#pako:...` and `mermaid.ink/svg/pako:...`. Compare mode encodes old and new independently and links each pane's "Open in Mermaid Live" to its own code.
- **Badge overlay, not DOM insertion**: badges are `position: fixed` elements in a single body-level `#gmjv-badge-layer`, positioned via `getBoundingClientRect()` on the resolved anchor and recomputed on scroll (capture-phase, to catch nested scroll containers)/resize/rescan. This was a deliberate fix — an earlier version inserted new rows as DOM siblings inside GitHub's own code/diff container, which (a) could be misplaced by GitHub's own layout/reflow and (b) could have its clicks silently swallowed by GitHub's own event handling on that container. Do not go back to DOM insertion for the badge itself.
- **Modal has two modes**: `openModal(imageUrl, liveUrl)` (single diagram, zoom/pan enabled) and `openCompareModal(oldCode, newCode)` (side-by-side, no zoom/pan — simplicity over feature parity here), toggled via a `gmjv-compare-mode` class on `#gmjv-modal` that CSS uses to swap which section is visible. Both share the same singleton overlay (`ensureModal()`), so switching between a 📊 and a 🔀 badge on repeat clicks correctly resets the mode each time.
- **Navigation handling**: GitHub pages are Turbo (Hotwire)-driven — content scripts persist across in-app navigation, so the script listens for `turbo:load`/`turbo:frame-load`/`pjax:end` to rescan, and clears/reprocesses (`resetForNavigation`) when the pathname actually changes. A debounced `MutationObserver` on `document.body` catches async hydration and lazy-loaded diff chunks (PRs can have many files, loaded progressively as you scroll).
- **Preview modal** (`ensureModal`/`openModal`) is a singleton overlay reused across diagrams; its zoom/pan/drag logic is ported near-verbatim from the VS Code extension's webview JS.

## Things to watch out for

- DOM/payload assumptions rely on GitHub's internal structure and have already changed once (see "Verifying selector changes" above) — these can break again when GitHub ships UI changes. The functions to patch are called out in the README's "How it works" section and are kept isolated for that reason.
- On diff pages, a mermaid block whose fence lines sit outside the currently-expanded diff context won't be detected (by design — see "Scope / limitations" in the README); the enclosing `/**` line may be out of view, but both fences must be visible. Only the unified diff view is supported, not split view.
- A saved page whose diff tables haven't been hydrated yet (e.g. "Save Page As → HTML only" taken before React rendered the rows) contains the diff only as JSON in `script[data-target="react-app.embeddedData"]` → `payload.pullRequestsChangesRoute.diffContents[].diffLines` (`{type, left, right, text}`), and only for the first few files — the rest are lazy-loaded. That's useful for checking which lines a hunk contains, but useless for verifying DOM selectors; use DevTools "Copy outerHTML" on the hydrated page for those.
- `manifest.json` is generated (gitignored) — keep `manifest.chrome.json` and `manifest.firefox.json` as the source of truth, matching `pr-review-collector`'s convention.
- `pako_deflate.min.js` and `PAKO_LICENSE` are both generated by `npm run build` (see "Build step" above) — never hand-edit or commit either one. Any packaging step (CI, zipping for a store, etc.) must run `npm install`/`npm run build` first, or the files simply won't be there.
- If bumping the pako version, update the `pako` entry in `package.json`'s `dependencies` and re-run `npm install` — `PAKO_LICENSE` is copied fresh from the installed package every time, so it never needs a manual update.
- Version must be updated in both manifests and `package.json` when releasing.
