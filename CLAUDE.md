# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

There's a file modification bug in Claude Code. The workaround is: always use complete absolute Windows paths with drive letters and backslashes for ALL file operations. Apply this rule going forward, not just for this file.

## Project Overview

This is a custom Electron-based programmable browser with Chromium engine, featuring JavaScript injection and inter-page communication capabilities. The browser is designed for automation, testing, and operational tasks with a fixed homepage at `http://localhost:5173/`.

## Common Commands

```bash
# Install dependencies
npm install

# Run the browser
npm start
```

## Architecture

### Multi-Process Structure

The application uses Electron's multi-process architecture:

1. **Main Process** (`main.js`) - Controls the application lifecycle, manages windows, BrowserView, and IPC communication
2. **Control Panel** (`index.html` + `renderer.js`) - The browser UI with navigation controls and script editor
3. **Content Pages** (BrowserView) - Displays actual web pages using persistent session
4. **Preload Scripts** - Security bridges between processes:
   - `preload.js` - Exposes APIs to the control panel (electronAPI)
   - `content-preload.js` - Exposes APIs to content pages (browserAPI)

### Key Components

**Session Persistence** (main.js:84-92)
- Uses `session.fromPartition('persist:browserview')` for persistent cookies and storage
- Custom User-Agent: `zh.Cloud-browse`
- Auto-saves session data every 30 seconds
- Converts session cookies to persistent cookies on window close

**Script Injection System** (script-manager.js)
- Manages JavaScript injection per URL
- Scripts stored in `injected-scripts/` directory
- Supports URL pattern matching with wildcards (e.g., `http://localhost:5173/*`)
- Two loading methods:
  1. Manual: Via browser UI script editor
  2. Automatic: Via `injected-scripts/scripts-config.json` configuration file
- Scripts execute on `did-finish-load` and `did-navigate-in-page` events

**BrowserView Layout** (main.js:170-175)
- Top 60px reserved for toolbar
- Right 400px reserved when script panel is open
- Dynamically adjusts when script panel toggles

## Script Injection Workflow

1. **Configuration Loading** (script-manager.js:39-75)
   - On startup, loads `injected-scripts/scripts-config.json`
   - Maps URLs to script files (e.g., `{"http://localhost:5173/": "auth.js"}`)
   - Scripts from config marked with `source: 'config'`

2. **Script Execution** (main.js:113-140)
   - When page loads, checks URL against saved scripts
   - Supports exact match and wildcard pattern matching
   - Executes via `browserView.webContents.executeJavaScript()`

3. **SPA Routing** (main.js:153-158)
   - Re-injects scripts on `did-navigate-in-page` for hash/path changes
   - Ensures scripts work with single-page applications

## Inter-Page Communication

Three communication channels are available:

### 1. Other Pages → Homepage
```javascript
// From any non-homepage page
window.browserAPI.sendToHome({ type: 'event', data: {...} });

// On homepage (http://localhost:5173/)
window.browserAPI.onMessageFromOtherPage((message) => { ... });
```

### 2. Homepage → Other Pages
```javascript
// From homepage
window.browserAPI.sendToOtherPage({ type: 'config', data: {...} });

// On other pages
window.browserAPI.onMessageFromHome((message) => { ... });
```

### 3. Control Panel → Content Pages
```javascript
// From control panel (renderer.js)
window.electronAPI.sendToContent({ command: 'action' });

// On content pages
window.browserAPI.onMessageFromMain((message) => { ... });
```

**Implementation Note**: Communication uses IPC between processes, then `postMessage` for final delivery to page context. Homepage is identified by exact URL match: `http://localhost:5173/`.

## Script Storage

- **Location**: `injected-scripts/` directory
- **Manifest**: `manifest.json` tracks all scripts with metadata
- **Filename**: MD5 hash of URL (e.g., `a1b2c3d4e5f6.js`)
- **Config File**: `scripts-config.json` for predefined URL→script mappings
- **Import/Export**: Scripts can be exported/imported with original structure

## Development Notes

### Modifying the Homepage URL
Change the `HOME_URL` constant in main.js:9:
```javascript
const HOME_URL = 'http://localhost:5173/';
```

### Adding IPC Handlers
1. Define handler in main.js using `ipcMain.handle()` or `ipcMain.on()`
2. Expose API in appropriate preload script:
   - `preload.js` for control panel APIs
   - `content-preload.js` for content page APIs
3. Call from renderer using exposed API

### Script Injection Debugging
- Main process logs show `[Script Injection]` prefixed messages
- Content page console shows `BrowserAPI ready:` on load
- Use DevTools button to inspect content pages separately from control panel

### Session Data Persistence
- Session path logged on startup
- Cookie count logged during auto-save (every 30 seconds)
- Manual flush available via `window.electronAPI.flushSession()`
- Session cookies converted to persistent (1 year expiration) on window close

## Important Patterns

**URL Pattern Matching** (script-manager.js:161-173)
- Supports `*` wildcard in URL patterns
- Converts pattern to regex for matching
- Useful for SPA routes: `http://localhost:5173/*` matches all paths

**Script Panel Toggle** (renderer.js:139-167)
- Toggles panel position with CSS right property (`0px` / `-400px`)
- Notifies main process to adjust BrowserView bounds
- Prevents content overlap with script editor

**Window Close Handling** (main.js:31-81)
- Prevents immediate close to save session data
- Converts session cookies to persistent
- Flushes storage data before shutdown
- 200ms delay ensures disk write completion
