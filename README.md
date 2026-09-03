# GitHub Mermaid JSDoc Viewer

A browser (Chrome, Firefox & Safari) extension that finds [Mermaid](https://mermaid.js.org/) diagrams inside JSDoc comments while you browse source files on GitHub, and lets you preview them inline or open them in the full [Mermaid Live](https://mermaid.live) editor.

No GitHub login required. No API calls except to `mermaid.ink` (for the inline preview image) and `mermaid.live` (when you click "Open in Mermaid Live" from the preview). Fully client-side otherwise.

This is the "watch it inside GitHub" counterpart to [`mermaid-jsdoc-viewer`](https://github.com/g-ongenae/mermaid-jsdoc-viewer), a VS Code extension that does the same thing for diagrams you're editing locally.

---

## Why

Documenting architecture or flow logic with a ` ```mermaid ` block inside a JSDoc comment is a nice way to keep diagrams next to the code they describe — but GitHub only renders it as a fenced code block, not a diagram, whether you're reading the source or reviewing a diff. This extension adds a small badge next to the line number of every such block so you can preview or open the diagram without leaving the page or copy-pasting into an external tool.

---

## Features

- Scans `/** ... */` JSDoc comments in `.js`/`.jsx`/`.ts`/`.tsx` files, and plain fenced blocks in `.md`/`.markdown`/`.mdx` files, for ` ```mermaid ` code blocks — on blob (source file) pages, and on PR "Files changed" / commit diff pages
- Overlays a small 📊 badge next to the line number of each detected block; click it to open a zoomable/pannable preview (via [mermaid.ink](https://mermaid.ink)), which also links to the full mermaid.live editor
- On diff pages, if the diagram _itself_ was edited (not just surrounding code), the badge turns into 🔀 and clicking it shows the diagram **before and after side by side** — a red-tinted "Before" pane and a green-tinted "After" pane, each with its own "Open in Mermaid Live" link
- Preview supports scroll-to-zoom, drag-to-pan, double-click-to-reset, and a +/−/⟳ toolbar
- Works on GitHub's Turbo-driven navigation and lazy-loaded diffs — badges refresh automatically as you browse between files or scroll
- Light and dark mode support

---

## Architecture

````mermaid
flowchart LR
    A["GitHub blob page /<br/>PR Files changed page<br/>JSDoc comments with<br/>```mermaid fences"] -->|scan source / diff| B["Content script<br/>Finds mermaid blocks<br/>Resolves line anchor"]
    B -->|overlay| C["📊 badge<br/>next to line number"]
    C -->|click| E["Preview modal<br/>zoom · pan · toolbar"]
    E -->|image via| F["mermaid.ink<br/>SVG render"]
    E -->|Open in Mermaid Live| D["mermaid.live<br/>full editor"]
````

Extension files: `manifest.{firefox,chrome}.json` · `content_script.js` · `viewer.css` · `pako_deflate.min.js`

Permissions required: `activeTab` (for the popup's status check) · host access to `github.com` (to run the content script on blob, PR, and commit pages)

---

## Installation

Requires [Node.js](https://nodejs.org/) 26+ for the one-time build step (`npm install`), which fetches and places `pako_deflate.min.js` — the extension won't load without it.

The extension ships two manifest files — pick the one for your browser:

| File                    | Browser               | Manifest version |
| ----------------------- | --------------------- | ---------------- |
| `manifest.firefox.json` | Firefox               | V2               |
| `manifest.chrome.json`  | Chrome / Edge / Brave | V3               |
| `manifest.chrome.json`  | Safari (via Xcode)    | V3               |

Before loading, install dependencies and copy the right manifest to `manifest.json`:

```bash
npm install

# Firefox
cp manifest.firefox.json manifest.json

# Chrome / Edge / Brave
cp manifest.chrome.json manifest.json
```

### Firefox (temporary / development)

1. Clone this repository
2. `npm install`
3. `cp manifest.firefox.json manifest.json`
4. Open Firefox and navigate to `about:debugging`
5. Click **This Firefox** → **Load Temporary Add-on**
6. Select `manifest.json`

The extension is active until Firefox is closed. Repeat step 5–6 after each restart.

### Chrome / Edge / Brave

1. Clone this repository
2. `npm install`
3. `cp manifest.chrome.json manifest.json`
4. Open Chrome and navigate to `chrome://extensions`
5. Enable **Developer mode** (top-right toggle)
6. Click **Load unpacked** and select the repository folder

### Safari (macOS — requires Xcode)

Safari supports WebExtensions through Apple's converter tool. You need a Mac with **Xcode 12+** installed.

1. Clone this repository
2. `npm install`
3. `cp manifest.chrome.json manifest.json`
4. Run the converter:
   ```bash
   xcrun safari-web-extension-converter /path/to/github-mermaid-jsdoc-viewer --project-location ./safari-extension
   ```
5. Xcode opens automatically with the generated project — click **Build** (⌘B)
6. Open Safari and go to **Safari → Settings → Extensions**
7. Enable **GitHub Mermaid JSDoc Viewer**

> Safari may show a warning that the extension is unsigned. To allow it, enable **Develop → Allow Unsigned Extensions** from the menu bar (this must be re-enabled after each Safari restart). The **Develop** menu can be turned on in **Safari → Settings → Advanced → Show features for web developers**.

### Permanent (self-distributed)

Run `npm install` first so `pako_deflate.min.js` and `PAKO_LICENSE` exist to include.

**Firefox:** Zip the extension folder contents and install via `about:addons` → gear icon → **Install Add-on From File**.

> For signing and distribution via addons.mozilla.org, see [Mozilla's extension signing docs](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

**Chrome:** Zip the folder and distribute the `.crx` file, or publish to the [Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/).

---

## Usage

1. Open any `.js`/`.jsx`/`.ts`/`.tsx` or Markdown file on GitHub — either the "blob" view (e.g. `github.com/org/repo/blob/main/src/foo.ts`; for Markdown, the code view via `?plain=1`, since the rendered view already draws the diagrams) or a PR's "Files changed" tab / a commit diff
2. Scroll to a JSDoc comment (or, in Markdown, any spot) containing a ` ```mermaid ` fenced code block
3. A small badge appears next to that line's line number — 📊 for a normal preview, or 🔀 if the diagram itself changed in this diff
4. Click it to open the preview:
   - 📊 opens a single zoomable/pannable diagram — scroll to zoom, drag to pan, double-click to reset, use the toolbar, or click **Open in Mermaid Live ↗** to edit it in the full editor
   - 🔀 opens a before/after comparison — a red-tinted "Before" pane and a green-tinted "After" pane side by side, each with its own "Open in Mermaid Live" link

---

## How it works

1. **Reads the source.** On blob pages, the react code view sometimes embeds the file's raw lines as JSON to hydrate itself (`script[data-target="react-app.embeddedData"]`, `payload['codeViewBlobLayoutRoute.StyledBlob'].rawLines`); large files leave this `null` and fetch content client-side instead, so there's a DOM fallback reading each `[data-testid="code-cell"][data-line-number]` element (or `id="LC<n>"` on older GitHub). On PR "Files changed" / commit diff pages, each file's diff is a `<table>`-based grid inside `<div role="region" id="diff-<hash>">`; the content script reads each row's "new file" code cell (`td.diff-text-cell[data-diff-side="right"]`) and its `.diff-text-inner` text — and, for comparison, the "old file" side (`data-diff-side="left"`) the same way, since context rows carry both.
2. **Finds mermaid blocks.** The same JSDoc-region + fence-tracking algorithm as [`mermaid-jsdoc-viewer`](https://github.com/g-ongenae/mermaid-jsdoc-viewer)'s VS Code extension, generalized to work over a (possibly gapped) list of `{lineNumber, text}` pairs — a diff's line numbers jump at hunk/file boundaries, and the parser treats any such gap as a reason to abandon whatever block it was mid-parsing rather than risk stitching unrelated lines together. A hunk that _starts_ on a ` * ...` comment-body line (GitHub's default three lines of context frequently begin right at the `* ```mermaid` fence, with the `/**` opener out of view) is assumed to already be inside a JSDoc comment. For Markdown files the JSDoc requirement is dropped and the fence is matched as a plain code block.
3. **Detects a changed diagram.** On diff pages, once a block is found on the "new" side, the content script checks whether its ` ```mermaid `/` ``` ` fence lines are context rows (i.e. existed before the change too). If so, it reconstructs the same line range from the "old" side and compares the two — a mismatch means the diagram itself changed, triggering the before/after badge and modal instead of a single preview.
4. **Encodes for mermaid.live/mermaid.ink.** Each diagram's source (old and/or new) is wrapped in the same JSON state object mermaid.live expects, deflated with [pako](https://github.com/nodeca/pako), and base64url-encoded — producing a `pako:<...>` fragment usable by both `mermaid.live/edit#pako:...` and `mermaid.ink/svg/pako:...`.
5. **Overlays a badge.** Rather than inserting new elements into GitHub's own code/diff DOM (fragile, and any click inside that DOM can be intercepted by GitHub's own handlers), the content script computes the target line-number gutter element's `getBoundingClientRect()` and positions a small `position: fixed` badge next to it in a body-level overlay layer, recomputed on scroll/resize/rescan.

> **Note:** GitHub's DOM (and embedded payload shape) is not a public API and has changed shape at least once already during this extension's development. If GitHub ships a UI redesign, `getBlobLinesFromEmbeddedPayload`/`getBlobLinesFromDom`/`getBlobLineAnchor` (blob pages) and `getDiffFileContainers`/`collectDiffEntries`/`getDiffLineNumberAnchor`/`extractDiffOldCode` (diff pages) in `content_script.js` are the functions to patch — they're intentionally isolated for that purpose. The selectors currently in place were verified against real saved GitHub page HTML, not guessed from memory.

---

## Project structure

```
github-mermaid-jsdoc-viewer/
├── manifest.firefox.json   # Firefox manifest (V2)
├── manifest.chrome.json    # Chrome/Edge/Brave manifest (V3)
├── content_script.js       # Parsing, DOM scan, injection, preview modal
├── viewer.css              # Action bar + modal styles (light + dark mode)
├── scripts/build-pako.js   # Copies pako's browser build into place at install time
├── pako_deflate.min.js     # Built by `npm install`/`npm run build` — not committed
├── popup.html / popup.js   # Toolbar popup (extension info, status check)
├── icon.svg                # Extension icon (shared design with mermaid-jsdoc-viewer)
├── LICENSE                 # MIT license for this project
└── PAKO_LICENSE            # pako's license — also built, not committed
```

---

## CI / CD

A GitHub Actions workflow (`.github/workflows/publish.yml`) can publish to both stores on push to `main`. It gracefully skips any store whose secrets are not configured.

### Required secrets

| Secret                 | Store   | Where to get it                                                                                           |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `FIREFOX_JWT_ISSUER`   | Firefox | [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/en-US/developers/addon/api/key/) |
| `FIREFOX_JWT_SECRET`   | Firefox | Same page as above                                                                                        |
| `CHROME_EXTENSION_ID`  | Chrome  | [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole) — your extension's ID         |
| `CHROME_CLIENT_ID`     | Chrome  | [Google Cloud Console](https://console.cloud.google.com/) OAuth credentials                               |
| `CHROME_CLIENT_SECRET` | Chrome  | Same as above                                                                                             |
| `CHROME_REFRESH_TOKEN` | Chrome  | OAuth flow — see [Chrome Web Store API docs](https://developer.chrome.com/docs/webstore/using-api/)       |

Add these in your repository's **Settings → Secrets and variables → Actions**.

---

## Scope / limitations

- On PR "Files changed" and commit diff pages, only the diff's _new_ content is scanned (context + added lines). A mermaid block that spans outside the visible diff hunk (e.g. only part of it changed, with the rest collapsed into an unexpanded context gap) won't be detected until that context is expanded — the parser deliberately refuses to stitch across a line-number gap rather than risk a corrupted diagram. Both the ` ```mermaid ` opener and the closing ` ``` ` must be visible in the hunk; the `/**` line of the enclosing JSDoc comment need not be.
- Only the unified diff view is supported, not the side-by-side split view.
- Only `.js`, `.jsx`, `.ts`, `.tsx` (JSDoc comments) and `.md`, `.markdown`, `.mdx` (plain fences) files are scanned.
- On a Markdown blob page GitHub renders the file (and its mermaid blocks) itself, so badges only appear in the code view (`?plain=1`). On diff pages they always appear — handy since GitHub's "rich diff" for Markdown renders the whole file rather than just the changed diagram.

---

## License

[MIT](./LICENSE)
