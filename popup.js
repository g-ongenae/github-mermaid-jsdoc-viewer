// Prefer the promise-based `browser` namespace (Firefox); Chrome MV3 `chrome.*` also returns promises.
const ext = (typeof browser !== 'undefined' && browser) || chrome;

// Populate version from manifest
const manifest = ext?.runtime?.getManifest?.();
if (manifest) {
  document.getElementById('version').textContent = `v${manifest.version}`;
}

function setStatus(active, message) {
  const statusEl = document.getElementById('status');
  statusEl.replaceChildren();
  const dot = document.createElement('span');
  dot.className = `status-dot ${active ? 'active' : 'inactive'}`;
  statusEl.append(dot, ` ${message}`);
}

const NOT_HERE = 'Open a JS/TS or Markdown file, a PR, a commit or a compare view on GitHub';

// Ping the content script instead of reading the tab URL: that needs no
// permission at all, and it reflects GitHub's client-side (Turbo) navigation,
// which never reloads the page — the script itself knows where it is.
async function checkStatus() {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    const reply = await ext.tabs.sendMessage(tab.id, { type: 'gmjv-ping' });
    if (!reply?.ok) {
      setStatus(false, NOT_HERE);
    } else if (reply.badges > 0) {
      setStatus(true, `Active — ${reply.badges} mermaid diagram${reply.badges === 1 ? '' : 's'} found on this page`);
    } else {
      setStatus(true, 'Active — no mermaid diagram found on this page (yet)');
    }
  } catch {
    // No receiver → content script not injected → not a github.com tab
    setStatus(false, NOT_HERE);
  }
}

checkStatus();
