// Populate version from manifest
const manifest = chrome?.runtime?.getManifest?.() || browser?.runtime?.getManifest?.();
if (manifest) {
  document.getElementById('version').textContent = `v${manifest.version}`;
}

// Check if current tab is a GitHub blob page for a supported source file
async function checkStatus() {
  const statusEl = document.getElementById('status');
  try {
    const queryFn =
      (typeof chrome !== 'undefined' && chrome.tabs?.query) || (typeof browser !== 'undefined' && browser.tabs?.query);
    const tabs = queryFn ? await queryFn({ active: true, currentWindow: true }) : [];
    const url = tabs?.[0]?.url || '';
    const isSupportedBlob = /^https:\/\/github\.com\/.+\/blob\/.+\.(m?jsx?|tsx?)(\?|#|$)/i.test(url);
    if (isSupportedBlob) {
      statusEl.innerHTML = '<span class="status-dot active"></span> Active on this file';
    } else {
      statusEl.innerHTML =
        '<span class="status-dot inactive"></span> Open a JS/TS file on GitHub ("blob" view) to use this extension';
    }
  } catch {
    statusEl.innerHTML = '<span class="status-dot inactive"></span> Open a GitHub source file to get started';
  }
}

checkStatus();
