const scanBtn      = document.getElementById('scanBtn');
const highlightBtn = document.getElementById('highlightBtn');
const clearBtn     = document.getElementById('clearBtn');
const exportBtn    = document.getElementById('exportBtn');
const statusBar    = document.getElementById('statusBar');
const resultsDiv   = document.getElementById('results');
const summaryDiv   = document.getElementById('summary');
const filterBar    = document.getElementById('filterBar');

let lastResults = [];
let activeFilter = null;

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setStatus(text, type) {
  const dotClass = type === 'scanning' ? 'yellow' : type === 'found' ? 'red' : type === 'clean' ? 'green' : 'gray';
  statusBar.className = 'status-bar ' + (type || '');
  statusBar.innerHTML = '<span class="dot ' + dotClass + '"></span><span>' + escapeHtml(text) + '</span>';
}

function updateButtonStates() {
  const has = lastResults.length > 0;
  highlightBtn.disabled = !has;
  clearBtn.disabled = !has;
  exportBtn.disabled = !has;
  highlightBtn.style.opacity = has ? '1' : '0.4';
  clearBtn.style.opacity = has ? '1' : '0.4';
  exportBtn.style.opacity = has ? '1' : '0.4';
}

function renderFilterBar(findings) {
  if (!findings.length) { filterBar.innerHTML = ''; filterBar.style.display = 'none'; return; }
  const counts = {};
  findings.forEach(f => counts[f.type] = (counts[f.type] || 0) + 1);
  const types = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  filterBar.innerHTML = types.map(([t, c]) => '<button class="filter-chip' + (activeFilter === t || !activeFilter ? ' active' : '') + '" data-type="' + escapeHtml(t) + '">' + escapeHtml(t.replace(/_/g, ' ')) + ' <span>' + c + '</span></button>').join('') + '<button class="filter-chip clear-filter' + (!activeFilter ? ' active' : '') + '" data-type="">all <span>' + findings.length + '</span></button>';
  filterBar.style.display = 'flex';
  filterBar.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => { activeFilter = btn.dataset.type || null; renderFilterBar(lastResults); renderFindingCards(lastResults); });
  });
}

function renderFindingCards(findings) {
  const filtered = activeFilter ? findings.filter(f => f.type === activeFilter) : findings;
  if (!filtered.length) { resultsDiv.innerHTML = '<div class="empty-state clean"><div class="icon">🔍</div><p>No findings match this filter.</p></div>'; return; }
  const sc = { critical: '#ff003c', high: '#ff6600', medium: '#f5a623', low: '#5ba3f5' };
  resultsDiv.innerHTML = filtered.map(f => {
    const i = findings.indexOf(f);
    const c = sc[f.severity] || '#ff003c';
    return '<div class="finding" data-index="' + i + '"><div class="finding-header"><span class="badge ' + escapeHtml(f.type) + '">' + escapeHtml(f.type.replace(/_/g, ' ')) + '</span><span class="severity-badge" style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '44">' + escapeHtml(f.severity) + '</span><span class="finding-num">#' + (i + 1) + ' &lt;' + escapeHtml(f.tag) + '&gt;</span></div><div class="finding-dest" title="' + escapeHtml(f.destination || '') + '">' + escapeHtml(f.destination || '<no destination>') + '</div><div class="finding-reasons">' + f.reasons.map(r => '<span class="reason-tag">' + escapeHtml(r) + '</span>').join('') + '</div><button class="copy-btn" data-url="' + escapeHtml(f.destination || '') + '" title="Copy URL">📋</button></div>';
  }).join('');
  document.querySelectorAll('.finding').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.copy-btn')) return;
      const f = findings[parseInt(el.dataset.index)];
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs || !tabs.length) return;
        chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: (h, d, t, s, r) => { console.group('[HLD] ' + t + ' (' + s + ')'); console.log('URL:', d); console.log('Reasons:', r.join(', ')); console.log('HTML:', h); console.groupEnd(); }, args: [f.outerHTML, f.destination, f.type, f.severity, f.reasons] });
      });
    });
  });
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); const url = btn.dataset.url; if (!url) return; navigator.clipboard.writeText(url).then(() => { btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋', 1500); }); });
  });
}

function renderResults(findings, duration) {
  lastResults = findings;
  activeFilter = null;
  updateButtonStates();
  if (!findings.length) {
    resultsDiv.innerHTML = '<div class="empty-state clean"><div class="icon">✅</div><p>No hidden redirect elements detected.<br>Page appears clean.</p></div>';
    summaryDiv.className = 'summary';
    filterBar.style.display = 'none';
    filterBar.innerHTML = '';
    setStatus('Scan complete — no threats found', 'clean');
    return;
  }
  const counts = {};
  findings.forEach(f => counts[f.type] = (counts[f.type] || 0) + 1);
  const breakdown = Object.entries(counts).map(([k, v]) => v + ' ' + k.replace(/_/g, ' ')).join(' · ');
  const dt = duration !== undefined ? ' in ' + duration + 'ms' : '';
  summaryDiv.innerHTML = '<span>' + findings.length + ' finding' + (findings.length > 1 ? 's' : '') + dt + '</span><b>' + escapeHtml(breakdown) + '</b>';
  summaryDiv.className = 'summary visible';
  setStatus('Found ' + findings.length + ' suspicious element' + (findings.length > 1 ? 's' : '') + dt, 'found');
  renderFilterBar(findings);
  renderFindingCards(findings);
}

function exportResults() {
  if (!lastResults.length) return;
  const data = { url: '', scanTime: new Date().toISOString(), totalFindings: lastResults.length, findings: lastResults.map(f => ({ type: f.type, severity: f.severity, tag: f.tag, destination: f.destination, reasons: f.reasons, outerHTML: f.outerHTML })) };
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs && tabs.length && tabs[0].url) data.url = tabs[0].url;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hld-scan-' + Date.now() + '.json';
    a.click();
  });
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:');
}

// Inject content.js, then send a message. Returns a promise.
function injectAndMessage(tabId, message) {
  return new Promise(resolve => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] }, () => {
      // Whether injection succeeded or content script was already there, try messaging
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, message, response => {
          if (chrome.runtime.lastError || !response) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      }, 400);
    });
  });
}

// --- Scan Button ---

scanBtn.addEventListener('click', async () => {
  setStatus('Scanning page...', 'scanning');
  scanBtn.disabled = true;
  scanBtn.textContent = '⏳ Scanning...';
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs.length || !tabs[0].id) { setStatus('Error: cannot access this page', ''); return; }
    const tab = tabs[0];
    if (isRestrictedUrl(tab.url)) { setStatus('Cannot scan browser or extension pages', ''); return; }

    const t0 = Date.now();
    const response = await injectAndMessage(tab.id, { action: 'scan' });
    const duration = Date.now() - t0;

    if (response && response.results) {
      renderResults(response.results, duration);
      chrome.action.setBadgeText({ text: response.results.length > 0 ? String(response.results.length) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff003c' });
    } else {
      setStatus('Could not scan this page', '');
    }
  } catch (err) {
    setStatus('Error: ' + (err.message || 'cannot access this page'), '');
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = '⚡ Scan Page';
  }
});

// --- Highlight Button ---

highlightBtn.addEventListener('click', async () => {
  if (!lastResults.length) return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs.length || !tabs[0].id) return;
  await injectAndMessage(tabs[0].id, { action: 'highlight' });
});

// --- Clear Button ---

clearBtn.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs.length && tabs[0].id) {
    await injectAndMessage(tabs[0].id, { action: 'clear' });
  }
  lastResults = [];
  activeFilter = null;
  updateButtonStates();
  filterBar.style.display = 'none';
  filterBar.innerHTML = '';
  resultsDiv.innerHTML = '<div class="empty-state"><div class="icon">🛡️</div><p>Highlights cleared. Click Scan to re-analyze.</p></div>';
  summaryDiv.className = 'summary';
  setStatus('Ready — click Scan to analyze this page', '');
});

exportBtn.addEventListener('click', exportResults);

// Badge update from content script
chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'updateBadge') {
    const count = msg.count || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff003c' });
  }
});

updateButtonStates();
