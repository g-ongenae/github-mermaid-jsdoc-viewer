// content_script.js
// Injected on every github.com page (GitHub navigates client-side with
// Turbo, so a script matched only on /blob/, /pull/… URLs would never be
// injected when the user reaches such a page from elsewhere on the site);
// it only does work on blob, PR, commit and compare pages. Finds ```mermaid
// fenced code blocks — inside JSDoc comments in JS/TS files, or as plain
// fenced blocks in Markdown files — and overlays a small floating badge next
// to the line number that opens a diagram preview.
//
// Requires pako_deflate.min.js (vendored, exposes the global `pako`) to be
// loaded before this script — see manifest.{chrome,firefox}.json.
//
// Badges are positioned via `getBoundingClientRect()` on a line-number gutter
// element and rendered in a body-level overlay, rather than inserted into
// GitHub's own code/diff DOM. GitHub's code view re-renders and virtualizes
// aggressively enough that sibling-inserted rows land in the wrong place and
// can be swallowed by GitHub's own click handling — an overlay sidesteps
// both problems.

(function () {
  // Two kinds of file are scanned: JS/TS sources, where a mermaid fence must
  // sit inside a `/** ... */` JSDoc comment, and Markdown files, where the
  // fence is a plain top-level code block.
  const JSDOC_EXT = /\.(m?jsx?|tsx?)$/i;
  const MARKDOWN_EXT = /\.(md|markdown|mdx)$/i;

  // Returns 'jsdoc' | 'markdown' | null for a file path (or URL pathname).
  function getFileKind(path) {
    if (JSDOC_EXT.test(path)) return 'jsdoc';
    if (MARKDOWN_EXT.test(path)) return 'markdown';
    return null;
  }

  // Pages the extension does anything on: a blob page for a supported file,
  // or a PR / commit / compare page. Everything else on github.com is left
  // untouched (the script is injected site-wide because of Turbo navigation).
  function isSupportedPage(pathname = location.pathname) {
    if (/^\/[^/]+\/[^/]+\/(pull|commit|compare)\//.test(pathname)) return true;
    return /^\/[^/]+\/[^/]+\/blob\//.test(pathname) && getFileKind(pathname) !== null;
  }

  // ── JSDoc / mermaid block parsing ──────────────────────────────────────
  // Same JSDoc-region + fence-tracking state machine as mermaid-jsdoc-viewer
  // (the VS Code extension), generalized to work over a sparse list of
  // `{ lineNumber, text }` entries instead of a dense line array — this lets
  // the same function serve both the full-text blob view and a diff's
  // hunk-numbered lines (which have real gaps at hunk/file boundaries).

  function stripJsDocPrefix(line) {
    return line.replace(/^\s*\*\s?/, '');
  }

  // Turns a raw source line into a diagram line: JSDoc body lines lose their
  // leading ` * `, Markdown lines are kept as-is. Trailing whitespace goes
  // either way.
  function normalizeDiagramLine(text, kind) {
    const content = kind === 'jsdoc' ? stripJsDocPrefix(text) : text;
    return content.replace(/\s+$/, '');
  }

  // A JSDoc *body* line (` * foo`, ` *`) — not the `/**` opener nor the
  // ` */` closer. Used to recognise a diff hunk that starts in the middle of
  // a comment: GitHub's default 3 lines of context often begin at the
  // ` * \`\`\`mermaid` fence itself, with the `/**` opener out of view.
  function isJsDocBodyLine(trimmed) {
    return /^\*(?![/*])/.test(trimmed);
  }

  // `startIndex`/`endIndex` on each returned block are indices into
  // `numberedLines` for the fence-open/fence-close entries — blob-page
  // callers ignore them, diff-page scanning uses them to look up the row
  // elements backing a block, to reconstruct the pre-change diagram (see
  // `extractDiffOldCode`).
  //
  // `kind` is 'jsdoc' (fences must be inside a `/** ... */` comment, and each
  // line's leading ` * ` is stripped) or 'markdown' (plain fenced blocks).
  function findMermaidBlocksFromNumberedLines(numberedLines, kind = 'jsdoc') {
    const blocks = [];

    // Markdown has no enclosing comment — treat the whole file as "inside".
    let inJsDoc = kind !== 'jsdoc';
    let inMermaid = false;
    let mermaidStartLine = -1;
    let mermaidStartIndex = -1;
    let mermaidLines = [];
    let prevLineNumber = null;

    numberedLines.forEach(({ lineNumber, text }, index) => {
      // A gap means lines are missing (not yet mounted, or a hunk/file
      // boundary) — anything we were mid-parsing can't be trusted.
      const atSegmentStart = prevLineNumber === null || lineNumber !== prevLineNumber + 1;
      if (atSegmentStart) {
        inJsDoc = kind !== 'jsdoc';
        inMermaid = false;
      }
      prevLineNumber = lineNumber;

      const trimmed = text.trim();

      if (!inJsDoc) {
        if (trimmed.startsWith('/**')) {
          inJsDoc = true;
          return;
        }
        // A hunk (or partially mounted view) that begins on a ` * ...` line
        // is already inside a comment whose `/**` opener we can't see.
        // Assume so and keep going — a fence is still required before
        // anything is reported, so a wrong guess costs nothing.
        if (atSegmentStart && isJsDocBodyLine(trimmed)) {
          inJsDoc = true;
        } else {
          return;
        }
      }

      if (kind === 'jsdoc' && trimmed.endsWith('*/') && !inMermaid) {
        inJsDoc = false;
        return;
      }

      const content = normalizeDiagramLine(text, kind);

      if (!inMermaid) {
        if (content.trim().startsWith('```mermaid')) {
          inMermaid = true;
          mermaidStartLine = lineNumber;
          mermaidStartIndex = index;
          mermaidLines = [];
        }
      } else if (content.trim() === '```') {
        blocks.push({
          startLine: mermaidStartLine,
          code: mermaidLines.join('\n'),
          startIndex: mermaidStartIndex,
          endIndex: index,
        });
        inMermaid = false;
      } else {
        mermaidLines.push(content);
      }
    });

    return blocks;
  }

  // ── Mermaid Live / mermaid.ink URL encoding (pako state format) ────────

  function encodeMermaidState(code) {
    const state = {
      code,
      mermaid: { theme: 'default' },
      autoSync: true,
      updateDiagram: true,
    };
    const deflated = pako.deflate(JSON.stringify(state), { level: 9 });
    let binary = '';
    deflated.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function buildMermaidLiveUrl(code) {
    return `https://mermaid.live/edit#pako:${encodeMermaidState(code)}`;
  }

  function buildMermaidInkUrl(code) {
    return `https://mermaid.ink/svg/pako:${encodeMermaidState(code)}`;
  }

  // ── Blob page: reading source lines ─────────────────────────────────────
  // GitHub's DOM/embedded payload shape is not a public API — these are the
  // functions to patch if GitHub changes its markup.

  // Fast path: the react code view sometimes embeds the raw file content as
  // JSON to hydrate itself (small/medium files). Large files leave this
  // null and fetch content client-side instead — the DOM fallback below
  // covers that case once it's rendered.
  function getBlobLinesFromEmbeddedPayload() {
    const scripts = document.querySelectorAll('script[type="application/json"][data-target="react-app.embeddedData"]');
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent);
        const rawLines = json?.payload?.['codeViewBlobLayoutRoute.StyledBlob']?.rawLines;
        if (Array.isArray(rawLines)) return rawLines.map((text, i) => ({ lineNumber: i + 1, text }));
      } catch {
        // Not the payload we're looking for — try the next script tag.
      }
    }
    return null;
  }

  // DOM fallback: each rendered line's content lives in a
  // `[data-testid="code-cell"][data-line-number]` element (current react
  // code view) or, on older/classic rendering, a `#LC<n>` element. Reading
  // by attribute rather than assuming a dense 1..N id sequence means partial
  // (not-yet-mounted) content degrades gracefully instead of stopping short.
  function getBlobLinesFromDom() {
    const map = new Map();
    document.querySelectorAll('[data-testid="code-cell"][data-line-number]').forEach((el) => {
      const n = parseInt(el.getAttribute('data-line-number'), 10);
      if (!Number.isNaN(n)) map.set(n, el.textContent ?? '');
    });
    if (!map.size) {
      for (let n = 1; ; n++) {
        const el = document.getElementById(`LC${n}`);
        if (!el) break;
        map.set(n, el.textContent ?? '');
      }
    }
    if (!map.size) return null;
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([lineNumber, text]) => ({ lineNumber, text }));
  }

  function getBlobNumberedLines() {
    return getBlobLinesFromEmbeddedPayload() || getBlobLinesFromDom();
  }

  // Anchor to overlay the badge against: prefer the line-number gutter
  // element (puts the badge "next to the line number" as intended), falling
  // back to whatever we can find.
  function getBlobLineAnchor(lineNumber) {
    return (
      document.querySelector(`.react-line-number[data-line-number="${lineNumber}"]`) ||
      document.querySelector(`.blob-num[data-line-number="${lineNumber}"]`) ||
      document.getElementById(`L${lineNumber}`) ||
      document.getElementById(`LC${lineNumber}`)
    );
  }

  function scanBlobPage(seenKeys) {
    const kind = getFileKind(location.pathname);
    if (!kind) return;

    const numberedLines = getBlobNumberedLines();
    if (!numberedLines) return;

    const blocks = findMermaidBlocksFromNumberedLines(numberedLines, kind);
    blocks.forEach((block) => {
      const anchor = getBlobLineAnchor(block.startLine);
      if (!anchor) return;
      const key = `blob:${location.pathname}:${block.startLine}`;
      seenKeys.add(key);
      placeBadge(key, anchor, { newCode: block.code, oldCode: null });
    });
  }

  // ── Diff pages (PR "Files changed", commit and compare diffs) ───────────
  // GitHub currently serves three diff markups, all `<table>`-based with one
  // `<tr>` per line, and all handled by the same three helpers below:
  //  1. PR "Files changed" (React) — file container
  //     `<div role="region" id="diff-<hash>" aria-labelledby="heading-...">`
  //     (path = the heading's `<code>` text); rows `tr.diff-line-row`; line
  //     numbers as `td.new-diff-line-number[data-diff-side][data-line-number]`
  //     (a cell exists only for the sides that have a number); text in
  //     `td.diff-text-cell .diff-text-inner`.
  //  2. Commit pages (React) — same container minus the `id`, same rows and
  //     text cell, but two attribute-less `td.diff-line-number` cells (left,
  //     then right) with the number as text and an empty cell for the
  //     missing side.
  //  3. Compare pages (classic server-rendered) — file container
  //     `div.file[data-tagsearch-path]` holding a `table.diff-table`; plain
  //     `<tr>` rows; two `td.blob-num` cells (left, then right) carrying
  //     `data-line-number` when that side has one (hunk rows carry "...");
  //     text in `td.blob-code` (or its `.blob-code-inner` child). The `+`/`-`
  //     markers are CSS-generated from `data-code-marker`, so they never
  //     appear in `textContent`.
  // In every layout a context row has a number on both sides, so asking for
  // `'left'` reconstructs the old content and `'right'` the new content.

  function getDiffFileContainers() {
    const containers = [];
    document.querySelectorAll('div[role="region"][aria-labelledby]').forEach((root) => {
      const heading = document.getElementById(root.getAttribute('aria-labelledby') || '');
      containers.push({ root, filePath: heading?.querySelector('code')?.textContent ?? '' });
    });
    document.querySelectorAll('div.file[data-tagsearch-path]').forEach((root) => {
      containers.push({ root, filePath: root.getAttribute('data-tagsearch-path') ?? '' });
    });
    return containers
      .map(({ root, filePath: rawPath }) => {
        const filePath = rawPath.replace(/\u200E/gi, '').trim();
        const kind = getFileKind(filePath);
        return kind ? { filePath, kind, root } : null;
      })
      .filter(Boolean);
  }

  function getDiffRows(root) {
    return root.querySelectorAll('tr.diff-line-row, table.diff-table tr');
  }

  // Resolves a row's line-number cell for one side (`'left'` = old file,
  // `'right'` = new file) as `{ cell, lineNumber }`, or null when the row
  // has no number on that side (a pure addition/deletion, or a hunk header).
  function getRowLineNumber(row, side) {
    const attrCell = row.querySelector(`td.new-diff-line-number[data-diff-side="${side}"][data-line-number]`);
    if (attrCell) {
      const n = parseInt(attrCell.getAttribute('data-line-number'), 10);
      return Number.isNaN(n) ? null : { cell: attrCell, lineNumber: n };
    }
    const cells = row.querySelectorAll('td.diff-line-number, td.blob-num');
    if (cells.length < 2) return null;
    const cell = cells[side === 'left' ? 0 : 1];
    const raw = cell.hasAttribute('data-line-number') ? cell.getAttribute('data-line-number') : cell.textContent;
    const n = parseInt(raw.trim(), 10);
    return Number.isNaN(n) ? null : { cell, lineNumber: n };
  }

  function getRowText(row) {
    const reactText = row.querySelector('td.diff-text-cell .diff-text-inner');
    if (reactText) return reactText.textContent ?? '';
    const classicCell = row.querySelector('td.blob-code');
    if (!classicCell) return '';
    return (classicCell.querySelector('.blob-code-inner') ?? classicCell).textContent ?? '';
  }

  // Entries carry the row (for `extractDiffOldCode`) and the side's
  // line-number cell (`numCell`, the badge anchor for that line).
  function collectDiffEntries(root, side) {
    const entries = [];
    getDiffRows(root).forEach((row) => {
      const num = getRowLineNumber(row, side);
      if (!num) return;
      entries.push({ lineNumber: num.lineNumber, text: getRowText(row), row, numCell: num.cell });
    });
    return entries;
  }

  // Given a block found on the "new" side, checks whether its fence lines
  // existed before the change (i.e. are context rows with a left-side line
  // number) and, if so, reconstructs what the diagram looked like there.
  // Returns null when the block was newly added (fences have no old-side
  // counterpart) or when either boundary row can't be resolved.
  function extractDiffOldCode(newEntries, oldEntries, block, kind) {
    const openRow = newEntries[block.startIndex]?.row;
    const closeRow = newEntries[block.endIndex]?.row;
    if (!openRow || !closeRow) return null;

    const oldStart = getRowLineNumber(openRow, 'left');
    const oldEnd = getRowLineNumber(closeRow, 'left');
    if (!oldStart || !oldEnd) return null;

    const oldStartLine = oldStart.lineNumber;
    const oldEndLine = oldEnd.lineNumber;

    return oldEntries
      .filter((e) => e.lineNumber > oldStartLine && e.lineNumber < oldEndLine)
      .map((e) => normalizeDiagramLine(e.text, kind))
      .join('\n');
  }

  function scanDiffPage(seenKeys) {
    getDiffFileContainers().forEach(({ filePath, kind, root }) => {
      const newEntries = collectDiffEntries(root, 'right');
      if (!newEntries.length) return;

      const blocks = findMermaidBlocksFromNumberedLines(newEntries, kind);
      if (!blocks.length) return;

      const oldEntries = collectDiffEntries(root, 'left');
      blocks.forEach((block) => {
        const anchor = newEntries[block.startIndex]?.numCell;
        if (!anchor) return;
        const key = `diff:${filePath}:${block.startLine}`;
        seenKeys.add(key);
        const oldCode = extractDiffOldCode(newEntries, oldEntries, block, kind);
        placeBadge(key, anchor, { newCode: block.code, oldCode });
      });
    });
  }

  // ── Badge overlay ────────────────────────────────────────────────────────
  // Positioned with `position: fixed` and recomputed on scroll/resize/rescan
  // (rather than inserted as a DOM sibling of GitHub's own content), so it
  // can't be misplaced by GitHub's layout/virtualization and isn't inside
  // any container that might intercept its clicks.

  const badges = new Map(); // key -> { el, anchor }

  function ensureBadgeLayer() {
    let layer = document.getElementById('gmjv-badge-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'gmjv-badge-layer';
      document.body.appendChild(layer);
    }
    return layer;
  }

  function placeBadge(key, anchor, { newCode, oldCode }) {
    const changed = oldCode != null && oldCode.trim() !== newCode.trim();

    let entry = badges.get(key);
    if (!entry) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'gmjv-badge';
      ensureBadgeLayer().appendChild(el);
      entry = { el, anchor: null };
      badges.set(key, entry);
    }
    entry.anchor = anchor;
    entry.el.title = changed ? 'Display mermaid diagram (changed — compare before/after)' : 'Display mermaid diagram';
    const glyph = changed ? '🔀' : '📊';
    if (entry.el.textContent !== glyph) entry.el.textContent = glyph;
    entry.el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (changed) {
        openCompareModal(oldCode, newCode);
      } else {
        openModal(buildMermaidInkUrl(newCode), buildMermaidLiveUrl(newCode));
      }
    };
    repositionBadge(entry);
  }

  function repositionBadge({ el, anchor }) {
    if (!anchor || !anchor.isConnected) {
      el.style.display = 'none';
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.top = `${rect.top + rect.height / 2}px`;
    el.style.left = `${rect.right + 4}px`;
  }

  function repositionAllBadges() {
    badges.forEach(repositionBadge);
  }

  function removeStaleBadges(seenKeys) {
    badges.forEach((entry, key) => {
      if (!seenKeys.has(key)) {
        entry.el.remove();
        badges.delete(key);
      }
    });
  }

  let repositionQueued = false;
  function scheduleReposition() {
    if (repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(() => {
      repositionQueued = false;
      repositionAllBadges();
    });
  }

  // ── Preview modal (zoom/pan viewport) ───────────────────────────────────

  let modalEls = null;

  function ensureModal() {
    if (modalEls) return modalEls;

    const overlay = document.createElement('div');
    overlay.id = 'gmjv-overlay';
    overlay.innerHTML = `
      <div id="gmjv-modal">
        <div id="gmjv-modal-header">
          <a id="gmjv-modal-live-link" target="_blank" rel="noopener noreferrer">Open in Mermaid Live ↗</a>
          <span id="gmjv-compare-heading">Diagram changed</span>
          <div id="gmjv-toolbar">
            <button id="gmjv-zoom-out" type="button" title="Zoom out">−</button>
            <button id="gmjv-zoom-reset" type="button" title="Reset zoom">⟳</button>
            <button id="gmjv-zoom-in" type="button" title="Zoom in">+</button>
            <button id="gmjv-close" type="button" title="Close">✕</button>
          </div>
        </div>
        <div id="gmjv-viewport">
          <img id="gmjv-diagram" alt="Mermaid diagram" />
        </div>
        <div id="gmjv-compare">
          <div class="gmjv-compare-pane gmjv-compare-before">
            <div class="gmjv-compare-label">Before</div>
            <img class="gmjv-compare-img" id="gmjv-diagram-before" alt="Diagram before change" />
            <a class="gmjv-compare-live-link" id="gmjv-compare-live-before" target="_blank" rel="noopener noreferrer"
              >Open in Mermaid Live ↗</a
            >
          </div>
          <div class="gmjv-compare-pane gmjv-compare-after">
            <div class="gmjv-compare-label">After</div>
            <img class="gmjv-compare-img" id="gmjv-diagram-after" alt="Diagram after change" />
            <a class="gmjv-compare-live-link" id="gmjv-compare-live-after" target="_blank" rel="noopener noreferrer"
              >Open in Mermaid Live ↗</a
            >
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const viewport = overlay.querySelector('#gmjv-viewport');
    const diagram = overlay.querySelector('#gmjv-diagram');

    let scale = 1;
    let x = 0;
    let y = 0;
    let zoomActive = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;

    function apply() {
      diagram.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    }

    function ensureZoomMode() {
      if (zoomActive) return;
      const vRect = viewport.getBoundingClientRect();
      const iRect = diagram.getBoundingClientRect();
      diagram.classList.add('gmjv-zooming');
      diagram.style.width = `${iRect.width}px`;
      diagram.style.height = `${iRect.height}px`;
      x = iRect.left - vRect.left;
      y = iRect.top - vRect.top;
      scale = 1;
      zoomActive = true;
      apply();
    }

    function resetZoom() {
      zoomActive = false;
      diagram.classList.remove('gmjv-zooming');
      diagram.style.transform = '';
      diagram.style.width = '';
      diagram.style.height = '';
    }

    function zoomAt(factor, clientX, clientY) {
      ensureZoomMode();
      const rect = viewport.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const newScale = Math.min(10, Math.max(0.05, scale * factor));
      x = px - ((px - x) / scale) * newScale;
      y = py - ((py - y) / scale) * newScale;
      scale = newScale;
      apply();
    }

    viewport.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
      },
      { passive: false },
    );

    viewport.addEventListener('mousedown', (e) => {
      ensureZoomMode();
      dragging = true;
      startX = e.clientX - x;
      startY = e.clientY - y;
      viewport.classList.add('gmjv-dragging');
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      x = e.clientX - startX;
      y = e.clientY - startY;
      apply();
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
      viewport.classList.remove('gmjv-dragging');
    });
    viewport.addEventListener('dblclick', resetZoom);

    overlay.querySelector('#gmjv-zoom-in').addEventListener('click', () => {
      const rect = viewport.getBoundingClientRect();
      zoomAt(1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
    overlay.querySelector('#gmjv-zoom-out').addEventListener('click', () => {
      const rect = viewport.getBoundingClientRect();
      zoomAt(1 / 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
    overlay.querySelector('#gmjv-zoom-reset').addEventListener('click', resetZoom);

    function close() {
      overlay.classList.remove('gmjv-open');
      resetZoom();
    }
    overlay.querySelector('#gmjv-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('gmjv-open')) close();
    });

    modalEls = {
      overlay,
      diagram,
      liveLink: overlay.querySelector('#gmjv-modal-live-link'),
      beforeDiagram: overlay.querySelector('#gmjv-diagram-before'),
      afterDiagram: overlay.querySelector('#gmjv-diagram-after'),
      beforeLiveLink: overlay.querySelector('#gmjv-compare-live-before'),
      afterLiveLink: overlay.querySelector('#gmjv-compare-live-after'),
      resetZoom,
      close,
    };
    return modalEls;
  }

  function openModal(imageUrl, liveUrl) {
    const { overlay, diagram, liveLink, resetZoom } = ensureModal();
    resetZoom();
    overlay.querySelector('#gmjv-modal').classList.remove('gmjv-compare-mode');
    diagram.src = imageUrl;
    liveLink.href = liveUrl;
    overlay.classList.add('gmjv-open');
  }

  function openCompareModal(oldCode, newCode) {
    const { overlay, beforeDiagram, afterDiagram, beforeLiveLink, afterLiveLink, resetZoom } = ensureModal();
    resetZoom();
    overlay.querySelector('#gmjv-modal').classList.add('gmjv-compare-mode');
    beforeDiagram.src = buildMermaidInkUrl(oldCode);
    afterDiagram.src = buildMermaidInkUrl(newCode);
    beforeLiveLink.href = buildMermaidLiveUrl(oldCode);
    afterLiveLink.href = buildMermaidLiveUrl(newCode);
    overlay.classList.add('gmjv-open');
  }

  // ── Scan / orchestration ─────────────────────────────────────────────────

  let lastPathname = location.pathname;

  function scan() {
    const seenKeys = new Set();
    if (isSupportedPage()) {
      scanBlobPage(seenKeys);
      scanDiffPage(seenKeys);
    }
    removeStaleBadges(seenKeys);
    repositionAllBadges();
  }

  function resetForNavigation() {
    badges.forEach((entry) => entry.el.remove());
    badges.clear();
    if (modalEls) modalEls.close();
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  function checkNavigation() {
    if (location.pathname !== lastPathname) {
      lastPathname = location.pathname;
      resetForNavigation();
    }
  }

  // Initial run.
  scheduleScan();

  // GitHub is Turbo (Hotwire) driven — full DOM swaps happen without a real
  // page load, so the initially-injected content script has to watch for
  // in-app navigation itself.
  ['turbo:load', 'turbo:frame-load', 'pjax:end'].forEach((evt) => {
    document.addEventListener(evt, () => {
      checkNavigation();
      scheduleScan();
    });
  });

  // The react code view / diff hydration can also finish after the initial
  // script run, and diffs lazy-load per file as you scroll.
  //
  // Mutations inside our own badge layer / modal are ignored — otherwise
  // every badge update made by a scan would schedule the next scan, and the
  // page would be rescanned every 250 ms for as long as a badge exists.
  function isOwnMutation(mutation) {
    const el = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
    return Boolean(el?.closest('#gmjv-badge-layer, #gmjv-overlay'));
  }
  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isOwnMutation)) return;
    checkNavigation();
    scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('resize', scheduleReposition);
  // `capture: true` also catches scrolling inside a nested scrollable panel,
  // not just the window/document itself.
  document.addEventListener('scroll', scheduleReposition, { capture: true, passive: true });

  // The toolbar popup pings us to learn whether the current page is one we
  // work on and how many diagrams were found — it has no permission to read
  // the tab's URL itself (and none is needed).
  const runtime =
    (typeof browser !== 'undefined' && browser.runtime) || (typeof chrome !== 'undefined' && chrome.runtime);
  runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'gmjv-ping') return;
    sendResponse({ ok: isSupportedPage(), badges: badges.size });
  });
})();
