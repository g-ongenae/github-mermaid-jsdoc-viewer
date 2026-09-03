# Privacy Policy — GitHub Mermaid JSDoc Viewer

_Last updated: 2026-09-03_

GitHub Mermaid JSDoc Viewer is a browser extension that finds ` ```mermaid ` fenced code blocks (inside JSDoc comments in JS/TS files, or as plain fences in Markdown files) on the GitHub page you are viewing, and shows a small badge next to the line number that lets you preview the diagram or open it in the Mermaid Live editor.

## Data collection

**The extension does not collect, store, sell, or share any data.** There is no backend server, no analytics, no telemetry, no crash reporting, and no account.

- It runs only on `https://github.com` pages. Because GitHub navigates client-side (Turbo), the script has to be present on every github.com page, but it stays idle everywhere except on source files (`/blob/`), pull requests (`/pull/`), commits (`/commit/`) and branch comparisons (`/compare/`).
- Scanning happens entirely locally: the extension reads the source lines already rendered on the page you are viewing and looks for mermaid fences. Nothing is sent anywhere at this stage.
- No GitHub login, token or API is used. The extension works the same on public and private repositories because it only reads what your browser has already displayed.

## Data sent to third parties — only when you click

The extension itself has no server. To render a diagram it relies on two public services run by the Mermaid project, and it only contacts them **after an explicit click by you**:

| When you…                        | What is sent                                                         | Where                                     |
| -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| Click a 📊 / 🔀 badge            | The text of that mermaid diagram (and, for 🔀, its previous version) | `https://mermaid.ink` (renders an SVG)    |
| Click **Open in Mermaid Live ↗** | The text of that mermaid diagram                                     | `https://mermaid.live` (opens the editor) |

The diagram text is compressed and embedded in the URL (the standard `pako:` format used by the Mermaid Live editor). **No other content of the page, file, repository or diff is sent** — only the lines between the ` ```mermaid ` and ` ``` ` fences you clicked. Your GitHub identity, the repository name and the file path are not transmitted.

If the diagram comes from a private repository, be aware that its text will be processed by mermaid.ink / mermaid.live when you click. Their handling of that data is governed by the Mermaid project's own terms: <https://mermaid.js.org/> . If you do not want a diagram to leave your browser, simply do not click its badge — the extension never sends anything on its own.

## Data stored on your device

None. The extension uses no `localStorage`, `sessionStorage`, cookies, IndexedDB or extension storage.

## Permissions

The extension requests **no permissions**. The toolbar popup learns whether the current page is supported by messaging the content script, not by reading the tab's URL.

| Access                                   | Why it is needed                                                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content script on `https://github.com/*` | Needed on all github.com pages because GitHub navigates client-side without reloading; it reads the code already rendered on file, PR, commit and compare pages to find mermaid fences, and overlays the badge and the preview modal. No other site is touched. |

## Third-party code

The extension bundles one open-source library, [pako](https://github.com/nodeca/pako) (MIT license), used locally to compress the diagram text into the `pako:` URL format. It is copied unmodified from the official npm package (see `PAKO_LICENSE`). No remote code is loaded or executed.

## Changes and contact

Changes to this policy are tracked in the project's Git history. Questions: open an issue at <https://github.com/g-ongenae/github-mermaid-jsdoc-viewer/issues>.
