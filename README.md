# Hide-seek
Detects hidden redirect links, clickjacking overlays, transparent iframes, and invisible anchors on any webpage. Auto-scans on load, highlights threats by severity, and exports results to JSON. Privacy-first - all scanning happens locally in your browser.


# Hidden Link Detector

A Chrome extension that scans web pages for deceptive and potentially malicious UI elements — hidden redirect links, clickjacking overlays, transparent iframes, and invisible anchors.

## Features

- **7 detection strategies** covering CSS hiding, DOM tricks, framework bindings, Shadow DOM, and print media exploits
- **Severity scoring** — each finding is rated low/medium/high/critical based on risk
- **Auto-scan** — automatically scans pages on load and watches for DOM mutations
- **Filter by type** — filter results by hidden link, clickjack, iframe, etc.
- **Export to JSON** — download full scan results for reporting or analysis
- **Copy URL** — one-click copy of any suspicious destination
- **Extension badge** — badge count shows threats without opening the popup
- **Color-coded highlights** — overlay highlights colored by severity on the page

## Install

### From source (developer mode)

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select this directory
5. The extension icon appears in your toolbar

### Usage

1. Navigate to any web page
2. Click the extension icon — the popup opens
3. Click **Scan Page** (or it auto-scans on load)
4. Review findings, filter by type, copy URLs, or export results
5. Click **Highlight** to overlay colored borders on suspicious elements
6. Click **Clear** to remove highlights

## Detection Strategies

| # | Strategy | What it catches |
|---|----------|----------------|
| 1 | **Hidden anchors** | `<a>` tags with opacity ~0, transparent color, font-size 0, off-screen position, visibility:hidden, clip-path collapse |
| 2 | **Hidden clickables** | Non-anchor elements with `onclick`, `data-href`, `data-url`, `data-action`, framework bindings (Vue, Angular, React) |
| 3 | **Overlay clickjack** | High z-index positioned elements covering large viewport areas with low opacity |
| 4 | **Suspicious iframes** | Transparent, high z-index, or fullscreen iframes |
| 5 | **1x1 pixel clickables** | Elements with a destination but rendered as 1x1 pixel |
| 6 | **Framework bindings** | Elements with `ng-click`, `v-on:click`, `@click`, `(click)` that are hidden |
| 7 | **Print media hiding** | Elements hidden on screen but made visible via `@media print` rules |

### CSS hiding techniques detected

- `opacity: 0` / `filter: opacity(0)`
- `color: transparent`
- `visibility: hidden` with `pointer-events` active
- `font-size: 0`
- `clip-path` collapse to zero
- `clip: rect(0,0,0,0)` (legacy)
- `transform: scale(0)`
- `filter: blur(heavy)`
- `text-indent: -9999px`
- `overflow: hidden` with zero dimensions
- Off-screen positioning (< -500px)
- Fixed/absolute positioned invisible overlays (z-index > 1000, opacity < 0.03)

### Severity levels

| Level | Score | Meaning |
|-------|-------|---------|
| **Critical** | 12+ | Multiple strong indicators — almost certainly malicious |
| **High** | 8-11 | Strong hiding technique with a destination URL |
| **Medium** | 5-7 | Suspicious but could be a false positive (e.g., lazy-loaded content) |
| **Low** | < 5 | Minor indicator — likely benign (e.g., transparent bg on a nav link) |

## File Structure

```
hidden-link-detector/
├── manifest.json        # Chrome extension manifest (MV3)
├── popup.html           # Extension popup UI
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── background.js    # Service worker — badge updates
    ├── content.js       # Core detection engine
    └── popup.js         # Popup controller
```

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Access the current tab to inject scan results |
| `scripting` | Execute highlighting script on the page |
| `<all_urls>` | Content script runs on all pages to detect threats |

No data is sent anywhere. All scanning happens locally in the browser.

