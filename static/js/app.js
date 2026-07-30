import { getHealth, getVoices, synthesize, enhance } from "./api.js";
import { initTheme } from "./theme.js";
import { initVoices } from "./voices.js";
import { createPlayer } from "./player.js";
import { initHistory } from "./history.js";
import { createOrb } from "./orb.js";

const $ = (id) => document.getElementById(id);

const scriptText = $("scriptText");
const wordCount = $("wordCount");
const enhanceBtn = $("enhanceBtn");
const diffPanel = $("diffPanel");
const diffContent = $("diffContent");
const revertBtn = $("revertBtn");
const dismissDiffBtn = $("dismissDiffBtn");
const speedSlider = $("speedSlider");
const speedValue = $("speedValue");
const playBtn = $("playBtn");
const actionLabel = $("actionLabel");
const actionControls = $("actionControls");
const downloadBtn = $("downloadBtn");
const regenBtn = $("regenBtn");
const statusDot = $("statusDot");
const statusText = $("statusText");
const modelMissingNotice = $("modelMissingNotice");
const toastContainer = $("toastContainer");

const MAX_WORDS = 300;

const PRESETS = {
  greeting: "Hey there! Welcome — it's great to have you here. Let's get started.",
  narration:
    "The old lighthouse stood at the edge of the cliff, its beam sweeping slowly across the dark water below.",
  adread:
    "Introducing the product that changes everything. Simple, powerful, and ready when you are. Try it today.",
};

let health = { modelFilePresent: true, modelLoaded: false, enhanceAvailable: false };
let originalBeforeEnhance = null;
let hasAudio = false;
let currentDataUrl = null;
let currentMeta = null; // { text, voiceId, voiceName, speed }

initTheme();

const player = createPlayer({
  canvas: $("waveCanvas"),
  playBtn,
  timeCurrent: $("timeCurrent"),
  timeTotal: $("timeTotal"),
});

const orb = createOrb($("orbCanvas"));

const history = initHistory(
  { listEl: $("historyList"), countEl: $("historyCount") },
  {
    onRestore: (entry) => {
      scriptText.value = entry.text;
      updateWordCount();
      if (entry.voiceId) voices.setSelected(entry.voiceId);
      speedSlider.value = entry.speed;
      speedValue.textContent = entry.speed.toFixed(1) + "×";
      refreshPlayButtonMode();
    },
    onPlay: async (entry) => {
      if (!entry.dataUrl) return;
      await player.load(entry.dataUrl);
      currentDataUrl = entry.dataUrl;
      currentMeta = { text: entry.text, voiceId: entry.voiceId, voiceName: entry.voiceName, speed: entry.speed };
      setReadyState(currentMeta);
      player.play();
    },
    onDownload: (entry) => {
      if (entry.dataUrl) triggerDownload(entry.dataUrl);
    },
  }
);

let voices = null;

function updateWordCount() {
  const words = scriptText.value.match(/\S+/g) || [];
  wordCount.textContent = words.length;
}

// Truncates at the character offset right after the Nth word, rather than
// rejoining split tokens — that would collapse the original whitespace
// (newlines, double spaces) down to single spaces, quietly reformatting
// whatever the user typed.
function truncateToWordLimit(text, limit) {
  const re = /\S+/g;
  let match;
  let count = 0;
  while ((match = re.exec(text)) !== null) {
    count++;
    if (count === limit) return text.slice(0, match.index + match[0].length);
  }
  return text;
}

let wordLimitToastShown = false;

function enforceWordLimit() {
  const value = scriptText.value;
  const words = value.match(/\S+/g) || [];
  if (words.length <= MAX_WORDS) {
    wordLimitToastShown = false;
    return;
  }
  const cursor = scriptText.selectionStart;
  scriptText.value = truncateToWordLimit(value, MAX_WORDS);
  scriptText.selectionStart = scriptText.selectionEnd = Math.min(cursor, scriptText.value.length);
  if (!wordLimitToastShown) {
    showToast(`Only ${MAX_WORDS} words are allowed.`);
    wordLimitToastShown = true;
  }
}

scriptText.addEventListener("input", () => {
  enforceWordLimit();
  updateWordCount();
  refreshPlayButtonMode();
});
updateWordCount();

document.querySelectorAll(".preset-pills [data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    scriptText.value = PRESETS[btn.dataset.preset] || "";
    updateWordCount();
    scriptText.focus();
  });
});

speedSlider.addEventListener("input", () => {
  speedValue.textContent = parseFloat(speedSlider.value).toFixed(1) + "×";
  refreshPlayButtonMode();
});

function showToast(message, variant = "error") {
  const el = document.createElement("div");
  el.className = "toast" + (variant === "error" ? " error-toast" : "");
  el.setAttribute("role", "alert");
  el.setAttribute("aria-live", "assertive");
  el.innerHTML = `
    <div class="toast-body">
      <i class="fa-solid ${variant === "error" ? "fa-circle-exclamation" : "fa-circle-check"}"></i>
      <span>${message}</span>
    </div>`;
  toastContainer.appendChild(el);
  const toast = new bootstrap.Toast(el, { delay: 5000 });
  el.addEventListener("hidden.bs.toast", () => el.remove());
  toast.show();
}

function triggerDownload(dataUrl) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = "speech.wav";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --- word-level diff for the Enhance panel (insertions/deletions only;
// punctuation-only rewrites keep this small and readable) ---
function tokenize(text) {
  return text.split(/(\s+)/).filter((t) => t.length);
}

function diffWords(oldText, newText) {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", value: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", value: a[i] });
      i++;
    } else {
      ops.push({ type: "ins", value: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", value: a[i++] });
  while (j < m) ops.push({ type: "ins", value: b[j++] });
  return ops;
}

function renderDiff(oldText, newText) {
  const ops = diffWords(oldText, newText);
  diffContent.innerHTML = ops
    .map((op) => {
      const escaped = op.value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      if (op.type === "eq") return escaped;
      if (op.type === "ins") return `<span class="diff-ins">${escaped}</span>`;
      return `<span class="diff-del">${escaped}</span>`;
    })
    .join("");
}

enhanceBtn.addEventListener("click", async () => {
  const text = scriptText.value.trim();
  if (!text) return;
  originalBeforeEnhance = scriptText.value;
  enhanceBtn.disabled = true;
  const label = enhanceBtn.innerHTML;
  enhanceBtn.innerHTML = `<span class="spinner-border" role="status" aria-hidden="true"></span>Enhancing…`;
  try {
    const { enhanced } = await enhance({ text: scriptText.value });
    renderDiff(originalBeforeEnhance, enhanced);
    scriptText.value = enhanced;
    updateWordCount();
    diffPanel.classList.remove("d-none");
  } catch (e) {
    showToast("Enhance failed: " + e.message);
  } finally {
    enhanceBtn.disabled = false;
    enhanceBtn.innerHTML = label;
  }
});

revertBtn.addEventListener("click", () => {
  if (originalBeforeEnhance !== null) {
    scriptText.value = originalBeforeEnhance;
    updateWordCount();
  }
  diffPanel.classList.add("d-none");
});
dismissDiffBtn.addEventListener("click", () => diffPanel.classList.add("d-none"));

function setStatus(dotClass, text) {
  statusDot.className = "status-dot " + dotClass;
  statusText.textContent = text;
}

async function loadHealth() {
  try {
    health = await getHealth();
    if (!health.modelFilePresent) {
      setStatus("err", "Model files missing");
      modelMissingNotice.classList.remove("d-none");
      playBtn.disabled = true;
      regenBtn.disabled = true;
    } else if (health.modelLoaded) {
      setStatus("ok", "Model ready");
    } else {
      setStatus("warn", "Ready · loads on first run");
    }
    if (!health.enhanceAvailable) {
      enhanceBtn.disabled = true;
      enhanceBtn.title = "Add OPENAI_API_KEY to .env to enable AI enhancement";
    }
  } catch (e) {
    setStatus("err", "Backend unreachable");
    showToast("Couldn't reach the backend: " + e.message);
  }
}

async function loadVoices() {
  let list;
  try {
    const data = await getVoices();
    list = data.voices && data.voices.length ? data.voices : null;
  } catch (e) {
    showToast("Couldn't load voices, using a default: " + e.message);
  }
  if (!list) list = [{ voiceId: "af_heart", displayName: "Heart (US, female)" }];
  voices = initVoices(list, { onSelect: refreshPlayButtonMode });
}

function setLoadingState() {
  hasAudio = false;
  playBtn.disabled = true;
  regenBtn.disabled = true;
  actionControls.classList.add("d-none");
  actionLabel.textContent = health.modelLoaded
    ? "Generating speech…"
    : "Loading model — first run takes ~15s…";
  orb.setGenerating();
}

function setReadyState(meta) {
  hasAudio = true;
  playBtn.disabled = false;
  regenBtn.disabled = false;
  actionControls.classList.remove("d-none");
  actionLabel.textContent = meta.voiceName ? `Generated · ${meta.voiceName}` : "Generated";
  playBtn.setAttribute("aria-label", "Play");
  const icon = playBtn.querySelector("i");
  if (icon) icon.className = "fa-solid fa-play";
  orb.setIdle();
}

function setIdleState() {
  hasAudio = false;
  playBtn.disabled = false;
  regenBtn.disabled = true;
  actionControls.classList.add("d-none");
  actionLabel.textContent = "Ready to generate";
  playBtn.setAttribute("aria-label", "Generate speech");
  const icon = playBtn.querySelector("i");
  if (icon) icon.className = "fa-solid fa-arrow-up";
  player.showDormant();
  orb.setIdle();
}

// True once the form (text/voice/speed) no longer matches the audio that's
// currently loaded — e.g. the user picked a different voice after already
// generating once. The main button then needs to generate again instead of
// just replaying the stale clip.
function isCurrentStale() {
  if (!hasAudio || !currentMeta) return false;
  const voice = voices?.getSelected();
  if (!voice) return false;
  const text = scriptText.value.trim();
  const speed = parseFloat(speedSlider.value);
  return text !== currentMeta.text || voice.voiceId !== currentMeta.voiceId || speed !== currentMeta.speed;
}

function refreshPlayButtonMode() {
  if (!hasAudio) return;
  const icon = playBtn.querySelector("i");
  if (!icon) return;
  if (isCurrentStale()) {
    icon.className = "fa-solid fa-arrow-up";
    playBtn.setAttribute("aria-label", "Generate speech");
  } else {
    icon.className = player.isPlaying() ? "fa-solid fa-pause" : "fa-solid fa-play";
    playBtn.setAttribute("aria-label", player.isPlaying() ? "Pause" : "Play");
  }
}

async function generate() {
  const text = scriptText.value.trim();
  if (!text) {
    showToast("Type something for the voice to say first.");
    scriptText.focus();
    return;
  }
  const voice = voices?.getSelected();
  if (!voice) {
    showToast("No voice available.");
    return;
  }
  const speed = parseFloat(speedSlider.value);

  setLoadingState();
  try {
    const result = await synthesize({ text, voiceId: voice.voiceId, speed });
    await player.load(result.dataUrl);
    health.modelLoaded = true;
    setStatus("ok", "Model ready");

    currentDataUrl = result.dataUrl;
    currentMeta = { text, voiceId: voice.voiceId, voiceName: voice.name, speed };
    setReadyState(currentMeta);
    player.play();

    history.add({ ...currentMeta, dataUrl: result.dataUrl });
  } catch (e) {
    setIdleState();
    showToast("Generation failed: " + e.message);
  }
}

playBtn.addEventListener("click", () => {
  if (!hasAudio || isCurrentStale()) generate();
  else player.togglePlay();
});

regenBtn.addEventListener("click", generate);

downloadBtn.addEventListener("click", () => {
  if (currentDataUrl) triggerDownload(currentDataUrl);
});

setIdleState();
loadHealth();
loadVoices();
