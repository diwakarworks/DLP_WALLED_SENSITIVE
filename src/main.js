const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");

let mainWindow;
let currentTarget = "chatgpt";
let ocrWorkerPromise;

const TARGETS = {
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com" },
  perplexity: { label: "Perplexity", url: "https://www.perplexity.ai" }
};




function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: "Walled AI DLP",
    backgroundColor: "#10141c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadURL(TARGETS[currentTarget].url);

  mainWindow.webContents.on("did-finish-load", async () => {
    await injectResponseStyle();

    mainWindow.setTitle(
      `Walled AI DLP — ${TARGETS[currentTarget].label}`
    );
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith("https://chatgpt.com") ||
      url.startsWith("https://www.perplexity.ai")
    ) {
      mainWindow.loadURL(url);
    } else {
      shell.openExternal(url);
    }

    return { action: "deny" };
  });

  buildMenu();

}

//teal color: #14b8a6
// const RESPONSE_CSS = `
//   main *:not(pre):not(pre *):not(svg):not(svg *) {
//     color: #14b8a6 !important;
//   }
// `;


const RESPONSE_CSS = `
  /* ChatGPT assistant replies */
  [data-message-author-role="assistant"],
  [data-message-author-role="assistant"] p,
  [data-message-author-role="assistant"] li,
  [data-message-author-role="assistant"] h1,
  [data-message-author-role="assistant"] h2,
  [data-message-author-role="assistant"] h3,
  [data-message-author-role="assistant"] strong {
    color: #14b8a6 !important;
  }

  /* Optional: your own messages too */
  [data-message-author-role="user"] {
    color: #14b8a6 !important;
  }
`;

async function injectResponseStyle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await mainWindow.webContents.insertCSS(RESPONSE_CSS);

    const info = await mainWindow.webContents.executeJavaScript(`({
      url: location.href,
      roleCount: document.querySelectorAll('[data-message-author-role]').length,
      markdownCount: document.querySelectorAll('.markdown').length,
      title: document.title
    })`);
    console.log("STYLE DEBUG:", info);
  } catch (error) {
    console.error("Style injection failed:", error);
  }
}




function buildMenu() {
  const template = [
    {
      label: "Walled AI",
      submenu: [
        { label: "Open ChatGPT", click: () => navigate("chatgpt") },
        { label: "Open Perplexity", click: () => navigate("perplexity") },
        { type: "separator" },
        { label: "Reload page", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.webContents.reload() },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() }
      ]
    },
    {
      label: "Security",
      submenu: [
        { label: "Detection marker: WALLED_SENSITIVE", enabled: false },
        { label: "About this prototype", click: () => dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Walled AI DLP",
          message: "Standalone desktop DLP prototype",
          detail: "Monitors prompts and file selection events inside this managed desktop browser window."
        }) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function navigate(target) {
  if (!TARGETS[target] || !mainWindow) return;
  currentTarget = target;
  mainWindow.loadURL(TARGETS[target].url);
}

async function inspectFile(file) {
  const { name, mimeType, bytes } = file;
  const buffer = Buffer.from(bytes);
  const lower = (name || "").toLowerCase();
  let extracted = "";

  try {
    if (mimeType === "text/plain" || /\.(txt|csv|md|json|log)$/i.test(lower)) {
      extracted = buffer.toString("utf8");
    } else if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
      const parsed = await pdfParse(buffer);
      extracted = parsed.text || "";
    } else if ((mimeType || "").startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(lower)) {
      if (!ocrWorkerPromise) {
        ocrWorkerPromise = Tesseract.createWorker("eng");
      }
      const worker = await ocrWorkerPromise;
      const result = await worker.recognize(buffer);
      extracted = result.data.text || "";
    } else {
      return { supported: false, detected: false, reason: "Unsupported file type" };
    }
    return { supported: true, detected: extracted.includes("WALLED_SENSITIVE") };
  } catch (error) {
    console.error("File inspection failed:", error);
    return { supported: false, detected: false, reason: error.message };
  }
}

ipcMain.handle("dlp:inspect-prompt", async (_event, payload) => {
  const detected = String(payload.text || "").includes("WALLED_SENSITIVE");
  if (!detected) return { proceed: true, detected: false };

  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Walled AI — Sensitive content detected",
    message: "WALLED_SENSITIVE was detected in your text prompt.",
    detail: `Application: ${payload.application}\nAction: Text prompt submission\n\nContinue to send the original prompt, or cancel to return and edit it.`,
    buttons: ["Continue", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  return { proceed: result.response === 0, detected: true };
});

ipcMain.handle("dlp:inspect-file", async (_event, payload) => {
  const scan = await inspectFile(payload);
  if (!scan.supported) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Walled AI — File could not be inspected",
      message: `Could not inspect "${payload.name}".`,
      detail: `${scan.reason || "Unsupported format"}\n\nFor safety, this prototype will block this upload. Use TXT, PDF, PNG or JPEG.`,
      buttons: ["OK"],
      defaultId: 0
    });
    return { proceed: false, detected: false, unsupported: true };
  }
  if (!scan.detected) return { proceed: true, detected: false };

  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Walled AI — Sensitive file detected",
    message: "WALLED_SENSITIVE was detected in an uploaded file.",
    detail: `Application: ${payload.application}\nFile: ${payload.name}\n\nContinue to upload the original file, or cancel to block it.`,
    buttons: ["Continue", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  return { proceed: result.response === 0, detected: true };
});

app.whenReady().then(() => {
  createWindow();
  mainWindow.webContents.on("did-navigate", () => injectResponseStyle());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  if (ocrWorkerPromise) {
    try { await (await ocrWorkerPromise).terminate(); } catch {}
  }
  if (process.platform !== "darwin") app.quit();
});
