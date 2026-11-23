const { contextBridge, ipcRenderer } = require("electron");

const APP_NAME = () => location.hostname.includes("perplexity.ai") ? "Perplexity" : "ChatGPT";
let bypassNextSubmit = false;
const pendingFiles = new WeakSet();

function getPromptText() {
  const candidates = [
    ...document.querySelectorAll('[contenteditable="true"], textarea')
  ];
  const visible = candidates.filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  // Prefer the largest visible editable element, which is normally the composer.
  visible.sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    return (br.width * br.height) - (ar.width * ar.height);
  });
  const el = visible[0];
  if (!el) return "";
  return el.value ?? el.innerText ?? el.textContent ?? "";
}

async function checkPromptAndProceed(replay) {
  if (bypassNextSubmit) {
    bypassNextSubmit = false;
    replay();
    return;
  }
  const text = getPromptText();
  if (!text) {
    replay();
    return;
  }
  const result = await ipcRenderer.invoke("dlp:inspect-prompt", {
    text,
    application: APP_NAME()
  });
  if (result.proceed) {
    bypassNextSubmit = true;
    replay();
  }
}

function isLikelySendButton(element) {
  if (!(element instanceof Element)) return false;
  const button = element.closest("button");
  if (!button) return false;
  const label = [
    button.getAttribute("aria-label"),
    button.getAttribute("data-testid"),
    button.innerText,
    button.title
  ].filter(Boolean).join(" ").toLowerCase();
  return /send|submit|search|ask|submit question/.test(label);
}

document.addEventListener("click", event => {
  if (!isLikelySendButton(event.target)) return;
  if (bypassNextSubmit) {
    bypassNextSubmit = false;
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = event.target.closest("button");
  checkPromptAndProceed(() => button?.click());
}, true);

document.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('[contenteditable="true"], textarea')) return;
  if (bypassNextSubmit) {
    bypassNextSubmit = false;
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  checkPromptAndProceed(() => {
    const form = target.closest("form");
    const submit = form?.querySelector('button[type="submit"], button[aria-label*="Send"], button[aria-label*="Search"]');
    if (submit) submit.click();
    else target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}, true);

document.addEventListener("change", async event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "file" || !input.files?.length) return;
  if (pendingFiles.has(input)) return;

  // Stop the site's listeners immediately while inspection and the native dialog run.
  event.preventDefault();
  event.stopImmediatePropagation();
  const files = Array.from(input.files);
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await ipcRenderer.invoke("dlp:inspect-file", {
      name: file.name,
      mimeType: file.type,
      bytes,
      application: APP_NAME()
    });
    if (!result.proceed) {
      input.value = "";
      return;
    }
  }
  // Continue: re-emit change only after all files have passed inspection/approval.
  pendingFiles.add(input);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  pendingFiles.delete(input);
}, true);

contextBridge.exposeInMainWorld("walledAI", {
  getStatus: () => "Walled AI DLP monitoring is active"
});
