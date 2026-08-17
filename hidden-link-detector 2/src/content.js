/**
 * Hidden Link Detector - Content Script
 * Detects invisible/hidden redirect elements using multiple strategies
 */
(() => {
  const RESULTS_KEY = '__hld_results__';
  const HIGHLIGHT_CLASS = '__hld_highlight__';
  let observerInstance = null;
  let autoScanEnabled = true;
  let debounceTimer = null;

  if (window.__hld_loaded__) return;
  window.__hld_loaded__ = true;

  function getComputedRect(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }

  function resolveUrl(raw) {
    if (!raw) return null;
    try { return new URL(raw, location.href).href; } catch { return raw; }
  }

  function getDestination(el) {
    if (el.href) return resolveUrl(el.href);
    const dh = el.getAttribute('data-href');
    if (dh) return resolveUrl(dh);
    const du = el.getAttribute('data-url');
    if (du) return resolveUrl(du);
    const onclick = el.getAttribute('onclick') || '';
    const m = onclick.match(/(?:location\.href|location\.replace|window\.open)\s*[=(]\s*['"]([^'"]+)['"]/);
    if (m) return resolveUrl(m[1]);
    if (el.dataset && el.dataset.navigo) return resolveUrl(el.dataset.navigo);
    return null;
  }

  function computeSeverity(type, reasons) {
    let score = ({ hidden_link: 3, hidden_clickable: 4, overlay_clickjack: 5, suspicious_iframe: 5 })[type] || 2;
    const w = {
      'opacity ~0': 3, 'color transparent': 2, 'visibility:hidden + pointer-events': 4,
      'clip-path collapse': 3, 'font-size:0': 3, '0x0 size high z-index': 4,
      'off-screen position': 3, 'text-indent off-screen': 3, 'clip rect collapse': 3,
      'transform:scale(0)': 4, 'filter:opacity(0)': 4, 'filter:blur(heavy)': 3,
      'large viewport overlay, low opacity': 5, 'high z-index full-page overlay': 5,
      'invisible positioned overlay': 5, 'transparent iframe': 4, 'high z-index iframe': 4,
      'fullscreen iframe': 5, '1x1 pixel clickable': 5, 'transparent bg large area': 1,
      'fixed high-z overlay': 4, 'overflow:hidden zero-size': 2,
    };
    reasons.forEach(r => { score += w[r] || 2; });
    return score >= 12 ? 'critical' : score >= 8 ? 'high' : score >= 5 ? 'medium' : 'low';
  }

  function queryShadow(root, selector) {
    const results = [...root.querySelectorAll(selector)];
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) results.push(...queryShadow(el.shadowRoot, selector));
    });
    return results;
  }

  function isSuspiciouslyHidden(el, style) {
    const reasons = [];
    const opacity = parseFloat(style.opacity);
    if (!isNaN(opacity) && opacity < 0.05) reasons.push('opacity ~0');
    if (style.color === 'rgba(0, 0, 0, 0)' || style.color === 'transparent') reasons.push('color transparent');
    if (style.backgroundColor === 'rgba(0, 0, 0, 0)' && el.tagName === 'A') {
      const rect = getComputedRect(el);
      if (rect.width > 200 && rect.height > 100 && (opacity < 0.1 || style.visibility === 'hidden' || parseFloat(style.fontSize) === 0 || rect.left < -500 || rect.top < -500)) {
        reasons.push('transparent bg large area');
      }
    }
    if (style.visibility === 'hidden' && style.pointerEvents !== 'none') reasons.push('visibility:hidden + pointer-events');
    if (style.clipPath && style.clipPath !== 'none' && style.clipPath.includes('0px')) reasons.push('clip-path collapse');
    if (parseFloat(style.fontSize) === 0) reasons.push('font-size:0');
    const rect = getComputedRect(el);
    if (rect.width === 0 && rect.height === 0 && parseInt(style.zIndex) > 100) reasons.push('0x0 size high z-index');
    if (rect.left < -500 || rect.top < -500) reasons.push('off-screen position');
    const ti = parseFloat(style.textIndent);
    if (!isNaN(ti) && Math.abs(ti) > 500) reasons.push('text-indent off-screen');
    if (style.clip && style.clip !== 'auto' && style.clip.includes('0')) {
      const cm = style.clip.match(/rect\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/);
      if (cm) reasons.push('clip rect collapse');
    }
    if (style.transform && style.transform.includes('scale(0') && style.pointerEvents !== 'none') reasons.push('transform:scale(0)');
    if (style.filter) {
      if (style.filter.includes('opacity(0')) reasons.push('filter:opacity(0)');
      if (style.filter.includes('blur(')) {
        const bm = style.filter.match(/blur\((\d+)/);
        if (bm && parseInt(bm[1]) > 20) reasons.push('filter:blur(heavy)');
      }
    }
    if (style.overflow === 'hidden' && rect.width === 0 && rect.height === 0) reasons.push('overflow:hidden zero-size');
    return reasons;
  }

  function isOverlayClickjack(el, style) {
    const reasons = [];
    const rect = getComputedRect(el);
    const vw = window.innerWidth, vh = window.innerHeight;
    if (rect.width > vw * 0.5 && rect.height > vh * 0.5) {
      const opacity = parseFloat(style.opacity);
      if (!isNaN(opacity) && opacity < 0.1) reasons.push('large viewport overlay, low opacity');
      if ((style.pointerEvents === 'all' || style.pointerEvents === 'auto') && parseInt(style.zIndex) > 900) reasons.push('high z-index full-page overlay');
    }
    if (style.position === 'fixed' || style.position === 'absolute') {
      const opacity = parseFloat(style.opacity);
      if (!isNaN(opacity) && opacity < 0.03 && parseInt(style.zIndex) > 1000) reasons.push('invisible positioned overlay');
    }
    if (style.position === 'fixed' && parseInt(style.zIndex) > 1000 && rect.width > vw * 0.3 && rect.height > vh * 0.3) {
      const opacity = parseFloat(style.opacity);
      if (!isNaN(opacity) && opacity < 0.15) reasons.push('fixed high-z overlay');
    }
    return reasons;
  }

  function detectPrintMediaHiding() {
    const findings = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.type === CSSRule.MEDIA_RULE && rule.conditionText && rule.conditionText.includes('print')) {
            for (const inner of rule.cssRules || []) {
              if (inner.type === CSSRule.STYLE_RULE && (inner.style.display === 'block' || inner.style.display === 'inline' || inner.style.display === 'flex')) {
                try {
                  document.querySelectorAll(inner.selectorText).forEach(el => {
                    const ss = getComputedStyle(el);
                    if (ss.display === 'none' || parseFloat(ss.opacity) < 0.05) {
                      const d = getDestination(el);
                      if (d) findings.push({ type: 'hidden_link', tag: el.tagName, destination: d, reasons: ['hidden on screen, visible in print'], outerHTML: el.outerHTML.slice(0, 300), rect: getComputedRect(el) });
                    }
                  });
                } catch {}
              }
            }
          }
        }
      } catch {}
    }
    return findings;
  }

  function scanPage() {
    const findings = [], seen = new Set();

    function addFinding(type, el, dest, reasons, rect) {
      if (seen.has(el) || !reasons || !reasons.length) return;
      seen.add(el);
      findings.push({ type, tag: el.tagName, destination: dest, reasons, severity: computeSeverity(type, reasons), outerHTML: el.outerHTML.slice(0, 300), rect: rect || getComputedRect(el) });
    }

    queryShadow(document, 'a[href], a[onclick], a[data-href], a[data-url]').forEach(el => {
      if (getComputedStyle(el).display === 'none') return;
      const r = isSuspiciouslyHidden(el, getComputedStyle(el));
      if (r.length) addFinding('hidden_link', el, getDestination(el), r);
    });

    queryShadow(document, '[onclick], [data-href], [data-url], [data-action], [data-handler]').forEach(el => {
      if (el.tagName === 'A' || getComputedStyle(el).display === 'none') return;
      const dest = getDestination(el);
      if (!dest) return;
      const r = isSuspiciouslyHidden(el, getComputedStyle(el));
      if (r.length) addFinding('hidden_clickable', el, dest, r);
    });

    queryShadow(document, 'div, section, span').forEach(el => {
      if (seen.has(el)) return;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.position === 'static') return;
      if (isNaN(parseInt(s.zIndex)) || parseInt(s.zIndex) < 500) return;
      const r = isOverlayClickjack(el, s);
      if (r.length && (getDestination(el) || el.querySelector('a'))) addFinding('overlay_clickjack', el, getDestination(el) || '[contains links]', r);
    });

    queryShadow(document, 'iframe').forEach(el => {
      if (seen.has(el)) return;
      const s = getComputedStyle(el), op = parseFloat(s.opacity), rect = getComputedRect(el), zi = parseInt(s.zIndex);
      if (s.pointerEvents === 'none') return;
      const r = [];
      if (!isNaN(op) && op < 0.1) r.push('transparent iframe');
      if (!isNaN(zi) && zi > 500) r.push('high z-index iframe');
      if (rect.width > innerWidth * 0.7 && rect.height > innerHeight * 0.7) r.push('fullscreen iframe');
      if (r.length) addFinding('suspicious_iframe', el, resolveUrl(el.src) || '[no src]', r, rect);
    });

    queryShadow(document, 'a, button, [role="button"], [tabindex]').forEach(el => {
      if (seen.has(el) || getComputedStyle(el).display === 'none') return;
      const rect = getComputedRect(el);
      if (rect.width <= 1 && rect.height <= 1) {
        const d = getDestination(el);
        if (d) addFinding('hidden_link', el, d, ['1x1 pixel clickable'], rect);
      }
    });

    queryShadow(document, '[ng-click], [v-on\\:click], [\\@click], [\\(click\\)]').forEach(el => {
      if (seen.has(el) || getComputedStyle(el).display === 'none') return;
      const r = isSuspiciouslyHidden(el, getComputedStyle(el));
      const d = getDestination(el);
      if (r.length && d) addFinding('hidden_clickable', el, d, [...r, 'framework click binding']);
    });

    const printFindings = detectPrintMediaHiding();
    printFindings.forEach(f => { if (!seen.has(f.outerHTML)) findings.push(f); });

    return findings;
  }

  function highlightFindings(findings) {
    document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(e => e.remove());
    const colors = { critical: '#ff003c', high: '#ff6600', medium: '#f5a623', low: '#5ba3f5' };
    findings.forEach((f, i) => {
      const color = colors[f.severity] || '#ff003c';
      const div = document.createElement('div');
      div.className = HIGHLIGHT_CLASS;
      div.style.cssText = 'position:fixed;top:' + Math.max(0, f.rect.top) + 'px;left:' + Math.max(0, f.rect.left) + 'px;width:' + Math.max(f.rect.width, 10) + 'px;height:' + Math.max(f.rect.height, 10) + 'px;border:3px solid ' + color + ';background:' + color + '26;z-index:2147483647;pointer-events:none;box-sizing:border-box;';
      const label = document.createElement('div');
      label.style.cssText = 'position:absolute;top:0;left:0;background:' + color + ';color:white;font:bold 10px monospace;padding:2px 5px;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;';
      label.textContent = '#' + (i + 1) + ' [' + f.severity + '] ' + f.type;
      div.appendChild(label);
      document.body.appendChild(div);
    });
  }

  function clearHighlights() {
    document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(e => e.remove());
  }

  function startAutoScan() {
    if (observerInstance) return;
    observerInstance = new MutationObserver(mutations => {
      if (!autoScanEnabled) return;
      if (!mutations.some(m => m.addedNodes.length > 0)) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const results = scanPage();
        window[RESULTS_KEY] = results;
        highlightFindings(results);
        chrome.runtime.sendMessage({ action: 'updateBadge', count: results.length }).catch(() => {});
      }, 1500);
    });
    observerInstance.observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') { sendResponse({ ok: true }); return; }
    if (msg.action === 'scan') {
      autoScanEnabled = false;
      if (observerInstance) { observerInstance.disconnect(); observerInstance = null; }
      const startTime = performance.now();
      const results = scanPage();
      const duration = Math.round(performance.now() - startTime);
      window[RESULTS_KEY] = results;
      highlightFindings(results);
      chrome.runtime.sendMessage({ action: 'updateBadge', count: results.length }).catch(() => {});
      sendResponse({ results, duration });
    } else if (msg.action === 'highlight') {
      highlightFindings(window[RESULTS_KEY] || []);
      sendResponse({ ok: true });
    } else if (msg.action === 'clear') {
      clearHighlights();
      sendResponse({ ok: true });
    }
  });

  function runInitialScan() {
    if (!document.body) { setTimeout(runInitialScan, 500); return; }
    try {
      const results = scanPage();
      window[RESULTS_KEY] = results;
      if (results.length > 0) highlightFindings(results);
      chrome.runtime.sendMessage({ action: 'updateBadge', count: results.length }).catch(() => {});
    } catch {}
    startAutoScan();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(runInitialScan, 1500);
  }
})();
