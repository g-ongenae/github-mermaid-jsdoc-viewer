// Populate version from manifest
const manifest = chrome?.runtime?.getManifest?.() || browser?.runtime?.getManifest?.();
if (manifest) {
  document.getElementById('version').textContent = `v${manifest.version}`;
}

// Check if the current tab is a GitHub page the content script runs on: a
// blob page for a supported file (JS/TS or Markdown), or a PR / commit /
// compare page.
async function checkStatus() {
  const statusEl = document.getElementById('status');
  try {
    const queryFn =
      (typeof chrome !== 'undefined' && chrome.tabs?.query) || (typeof browser !== 'undefined' && browser.tabs?.query);
    const tabs = queryFn ? await queryFn({ active: true, currentWindow: true }) : [];
    const url = tabs?.[0]?.url || '';
    const isSupportedBlob =
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/.+\.(m?jsx?|tsx?|md|markdown|mdx)(\?|#|$)/i.test(url);
    const isDiffPage = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|commit|compare)\//i.test(url);
    if (isSupportedBlob) {
      statusEl.innerHTML = '<span class="status-dot active"></span> Active on this file';
    } else if (isDiffPage) {
      statusEl.innerHTML = '<span class="status-dot active"></span> Active on this diff';
    } else {
      statusEl.innerHTML =
        '<span class="status-dot inactive"></span> Open a JS/TS or Markdown file, a PR, a commit or a compare view on GitHub';
    }
  } catch {
    statusEl.innerHTML = '<span class="status-dot inactive"></span> Open a GitHub source file to get started';
  }
}

checkStatus();
