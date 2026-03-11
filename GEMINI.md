# GEMINI Project Context: 运营助手 (Operations Helper)

## 1. Project Overview

This project is an Electron-based desktop application named "资海云运营助手" (Operations Helper). It acts as a specialized, programmable browser designed for automating content management and publishing on multiple Chinese media platforms like Douyin, Xiaohongshu, and Zhihu.

The core architecture consists of an Electron main process that manages windows (`BrowserWindow`) and sessions. It injects custom JavaScript files into web pages based on their URL. These scripts then perform automated actions (like logging in, creating content, or publishing) by interacting with the page's DOM and a powerful API exposed by the application.

## 2. Key Technologies

- **Backend/Shell:** Electron, Node.js
- **Frontend UI:** The main control panel is a web application, likely built with Vue.js (as per the `README.md`), which runs separately in development and is loaded remotely in production.
- **Automation:** Plain JavaScript files are injected into standard web pages.

## 3. Core Architectural Concepts

- **`browserAPI`:** The heart of the application. A powerful, global JavaScript object `window.browserAPI` is exposed to every web page loaded within the application (via `content-preload.js`). This API is the bridge between the web content and the Electron backend, providing functions for window management, session control, inter-page communication, and persistent data storage.
- **Script Injection:** The application's automation capabilities are driven by scripts in the `injected-scripts/` directory. The `injected-scripts/scripts-config.json` file maps URLs (with wildcards) to an array of JavaScript files that should be injected into that page. This allows for targeted, platform-specific automation logic.
- **Multi-Account Session Management:** The application is designed to manage multiple user accounts for a single platform (e.g., three different Douyin accounts). It achieves this by creating isolated, persistent session partitions for each account, ensuring their cookies, local storage, and login states do not conflict.
- **Inter-Page Communication:** The `browserAPI` provides a pub/sub mechanism (`sendToHome`, `onMessageFromOtherPage`, etc.) that allows the main control panel and the various platform pages (running in separate windows) to communicate and coordinate actions.

## 4. How to Build and Run

### A. Initial Setup

```bash
# 1. Install npm dependencies
npm install

# In case of Electron download issues, use the mirror:
# rm -rf node_modules
# ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

### B. Running in Development Mode

The development environment requires **two** separate processes to be running:

1.  **Start the Frontend UI:** The main control panel is a separate Vue.js project. You must start its development server first.
    ```bash
    # (In the separate frontend project directory)
    # cd /path/to/ai-media-edit
    # npm run dev
    ```
    This will typically run on `http://localhost:5173`.

2.  **Start the Electron App:** Once the UI server is running, you can start the Electron shell.
    ```bash
    npm start
    ```
    The Electron app will load the UI from the local development server.

### C. Building for Production

Use the scripts defined in `package.json` to create packaged applications.

```bash
# Build for Windows (NSIS installer)
npm run build

# Build for Windows (Portable .exe)
npm run build:portable

# Build for macOS (DMG and ZIP)
npm run build:mac
```
Builds are placed in the `dist/` directory.

## 5. Common Development Workflow

### Adding a New Automation Script

1.  **Create the Script:** Write the automation logic in a new JavaScript file inside `injected-scripts/`. For example, `injected-scripts/new-platform-publish.js`.
2.  **Use the API:** Inside your script, use `window.browserAPI` to manage windows, get data, or communicate with the main UI. Use helper functions from `injected-scripts/common.js` (like `waitForElement`) to simplify DOM interactions.
3.  **Register the Script:** Open `injected-scripts/scripts-config.json` and add an entry to map a target URL to your new script.
    ```json
    {
      "scripts": {
        "https://www.new-platform.com/publish-page": ["common.js", "new-platform-publish.js"]
      }
    }
    ```

## 6. Key Files and Directories

- `main.js`: The Electron main process entry point. Manages application lifecycle, windows, and sessions.
- `preload.js` / `content-preload.js`: Injects the `window.browserAPI` into renderer processes, exposing backend functionality securely.
- `script-manager.js`: Handles reading the script configuration and injecting the correct scripts into web pages.
- `injected-scripts/`: Contains all automation scripts.
  - `scripts-config.json`: The URL-to-script mapping configuration.
  - `common.js`: A library of shared helper functions for automation scripts.
  - `*-creator.js` / `*-publish.js`: Platform-specific scripts for authorization and publishing tasks.
- `README.md`: The primary source of truth for project architecture and API documentation.
