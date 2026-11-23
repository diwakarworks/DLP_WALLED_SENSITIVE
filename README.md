# Walled AI DLP — Standalone Desktop Application

A standalone Electron desktop application prototype for inspecting text prompts and file selections in a managed desktop browser window for ChatGPT and Perplexity.

**Detection marker:** `WALLED_SENSITIVE`

## What this project implements

- Standalone desktop application built with Electron (not a browser extension).
- Opens ChatGPT and Perplexity in its own managed desktop browser window.
- Intercepts common prompt submission paths (send/search buttons, Enter, and form submission).
- Checks prompt text for the exact marker `WALLED_SENSITIVE`.
- Inspects selected TXT/text, PDF, and image files before the website receives the file-input change event.
- Extracts PDF text with `pdf-parse`.
- Uses Tesseract.js OCR for PNG/JPEG and other supported raster image formats.
- Displays native operating-system confirmation dialogs using Electron's `dialog.showMessageBox`.
- Continue permits the original prompt/file action; Cancel blocks it.
- Injects CSS to change the color of assistant/answer content on both sites.

## Important scope and limitations

This is a **standalone desktop application**, not a Chrome/Firefox extension. For a predictable and self-contained demo, it opens the two supported AI websites inside its own Electron-managed browser window. It does **not** monitor an independently launched Chrome, Safari, or Firefox session. The assignment wording says the sites are accessed through a web browser; if the evaluator expects interception in the user's existing external browser, this implementation would need a separately engineered OS-level/browser-proxy integration and should not be represented as supporting that.

Web applications change their DOM frequently. The prompt interception uses common DOM patterns and heuristics for send/search controls. Before submission, test current ChatGPT and Perplexity UI versions and adjust selectors if needed. Some website flows (voice input, drag-and-drop, clipboard integrations, mobile layouts, unusual keyboard shortcuts, or future DOM changes) may bypass these heuristics.

File inspection is triggered on the browser file input's `change` event, before the selected file is handed to the website's normal change listeners. This is a client-side interception point within the managed app, not a general-purpose network egress firewall. Drag-and-drop upload paths may use different events and require additional handling. The application fails closed for unsupported file types or files it cannot inspect.

Image detection uses English OCR (`eng`). Detection quality depends on image resolution, contrast, orientation, and text clarity. PDF scanning extracts embedded text; image-only/scanned PDFs may require rendering pages and OCR, which is not included in this starter version. Password-protected, malformed, or very large files may fail inspection and will be blocked.

The response color CSS is best-effort and selector-based. Site markup can change, and CSS selectors may need maintenance. It is intended to recolor assistant/answer text; it does not recolor every possible UI element.

## Requirements

- macOS, Windows, or Linux
- Node.js 20 LTS or newer
- npm (included with Node.js)
- Internet connection for dependency installation and to access ChatGPT/Perplexity
- A normal browser login to ChatGPT/Perplexity may be required inside the app

## 1. Extract and open the project

1. Extract `walled-ai-dlp.zip`.
2. Open Terminal.
3. Change directory into the extracted project folder:

```bash
cd walled-ai-dlp
```

4. Confirm Node and npm are installed:

```bash
node -v
npm -v
```

Use Node.js 20 LTS or newer.

## 2. Install dependencies

```bash
npm install
```

The first install downloads Electron, PDF parsing, OCR, and packaging dependencies. OCR may download language data on first use.

## 3. Run the desktop application

```bash
npm start
```

The Walled AI window opens ChatGPT by default.

Use the **Walled AI** menu in the application menu bar:
- **Open ChatGPT**
- **Open Perplexity**
- **Reload page**
- **Quit**

Log in normally if the website asks you to.

## 4. Test prompt inspection

### Test A — clean prompt

1. Open ChatGPT.
2. Enter `Explain how a hash map works`.
3. Submit.
4. Expected: no confirmation dialog; prompt submits normally.

Repeat on Perplexity.

### Test B — sensitive prompt, Cancel

1. Enter `Please review this value: WALLED_SENSITIVE`.
2. Submit.
3. Expected: a native desktop dialog identifies the application and says the marker was detected in a text prompt.
4. Select **Cancel**.
5. Expected: the prompt is not submitted. You can edit it and try again.

### Test C — sensitive prompt, Continue

1. Enter `Please review this value: WALLED_SENSITIVE`.
2. Submit.
3. Select **Continue**.
4. Expected: the original prompt is submitted without changing its text.

## 5. Test file inspection

Create test files containing the exact marker `WALLED_SENSITIVE`. For example:

**marker.txt**
```text
This is a test document.
WALLED_SENSITIVE
```

For a PDF, create a PDF containing the marker as selectable text (not only as an image). For an image, create a PNG or JPEG with the marker visibly printed in clear, high-contrast text.

Then test each file type on both sites:

1. Click the site's attachment/upload control.
2. Select the test file.
3. Expected for a clean file: no dialog; normal upload continues.
4. Expected for a sensitive file: native desktop dialog identifies the file name.
5. Select **Cancel**: file selection is cleared and upload is blocked.
6. Repeat and select **Continue**: original file selection is allowed through to the website.

Also test a clean TXT, PDF, and image file. The app should not interrupt those uploads.

**Note:** Image OCR is English-only in this starter. A first image scan can take longer while Tesseract initializes.

## 6. Verify response text customization

1. Ask a normal question in ChatGPT.
2. Wait for the response.
3. Confirm assistant response text changes to a teal color.
4. Switch to Perplexity from the Walled AI menu.
5. Ask a normal question.
6. Confirm answer text changes to the same teal color.

If a site's markup changes and the color does not apply, inspect the current response container in DevTools and update the CSS selectors in `src/main.js` (`injectResponseStyle`).

## 7. Build a distributable desktop app (optional)

Build for the current operating system:

```bash
npm run dist
```

Platform-specific commands:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Artifacts are written to `dist/`. Build on the target operating system where practical. macOS distribution outside your own machine may require code signing/notarization.

## Architecture overview

```text
┌────────────────────────────────────────────┐
│ Walled AI DLP — Electron desktop process   │
│                                            │
│  Native menu: ChatGPT / Perplexity         │
│  Native dialogs: Continue / Cancel         │
│  PDF parser + OCR engine                   │
└──────────────────────┬─────────────────────┘
                       │ IPC
┌──────────────────────▼─────────────────────┐
│ Electron preload (isolated bridge)         │
│                                            │
│  Prompt submit event interception          │
│  File input change interception            │
│  Sends prompt/file bytes to main process   │
└──────────────────────┬─────────────────────┘
                       │
┌──────────────────────▼─────────────────────┐
│ Managed browser page                       │
│                                            │
│  chatgpt.com / www.perplexity.ai           │
│  Assistant response CSS customization     │
└────────────────────────────────────────────┘
```

### Prompt interception and enforcement

The preload script registers capture-phase listeners for send/search button clicks, Enter key submission, and form submission. It reads the visible composer text and calls the Electron main process through a narrow IPC channel. The main process checks for the exact marker. If it is absent, the action proceeds. If present, Electron displays a native confirmation dialog. Continue replays the action; Cancel leaves the prompt in the composer and blocks that submission.

### File interception and enforcement

The preload script watches file input `change` events. Before allowing the site's normal event handlers to run, it reads the selected file bytes and sends them to the main process. The main process extracts text from text files, parses PDF text, or runs OCR for images. A detected marker triggers a native confirmation dialog. Continue allows the original change event to continue; Cancel clears the file input and stops propagation.

### Response customization

After each page load, the main process injects CSS into the page to recolor common assistant-response and answer content selectors. The injection is repeated after navigation/reload.

### Security boundaries

- Renderer Node.js integration is disabled.
- Context isolation is enabled.
- The preload exposes only a small status API to page JavaScript.
- Native dialogs and file parsing execute in the main process.
- This is an assignment prototype, not a hardened enterprise DLP agent. A production solution would need stronger browser/network interception, comprehensive upload-path coverage, signed updates, audit logging, policy management, and extensive compatibility/security testing.

## Project structure

```text
walled-ai-dlp/
├── package.json
├── README.md
├── .gitignore
└── src/
    ├── main.js
    └── preload.js
```

## Troubleshooting

### `npm install` fails
- Confirm Node.js 20+ and npm are installed.
- Retry with `npm install`.
- On macOS, install Xcode Command Line Tools if native build tooling requests them.

### Website does not load
- Check internet access.
- Try **Reload page**.
- Confirm the website is available and sign in through the app window.

### Sensitive prompt is not detected
- Ensure the marker is spelled exactly `WALLED_SENSITIVE`.
- Try the website's visible Send/Search button rather than an alternate submission mechanism.
- Website DOM changes may require updating selectors and event handlers in `src/preload.js`.

### File upload is blocked as uninspectable
- Use TXT, PDF, PNG, or JPEG.
- Ensure the PDF is not password protected.
- For image tests, use a clear English marker with high contrast.

### Response text color does not change
- Website CSS selectors may have changed.
- Update `injectResponseStyle()` in `src/main.js` to match the current assistant answer DOM.

## Demo recording checklist

Record one continuous or clearly chaptered demonstration showing:

1. Walled AI desktop application launches (not a browser extension).
2. ChatGPT clean prompt submits without a dialog.
3. ChatGPT sensitive prompt → native dialog → Cancel blocks it.
4. ChatGPT sensitive prompt → native dialog → Continue submits it.
5. ChatGPT TXT, PDF, and image upload checks (both clean and marker-containing samples).
6. ChatGPT assistant response text color is changed.
7. Repeat prompt, file, and response-color tests on Perplexity.
8. Show the project README and GitHub repository.

Do not show passwords, API keys, personal files, or private account information in the recording.

## Submission checklist

- [ ] Push the complete source code to a public GitHub repository.
- [ ] Keep this README in the repository.
- [ ] Include the architecture overview (included above).
- [ ] Record the demo video and make its link publicly viewable without sign-in.
- [ ] Add your CV and confirm its link is publicly accessible.
- [ ] Test repository and video links in a private/incognito browser window before submitting.
