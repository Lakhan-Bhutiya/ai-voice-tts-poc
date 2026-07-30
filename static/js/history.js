// Session history. Audio (dataUrl) is kept in memory only — a single ~30s
// WAV is roughly 1.4MB as base64, so persisting it would blow past
// localStorage's ~5MB quota fast. Only text/voice/speed metadata survives
// a refresh; the UI says so rather than pretending the audio is still there.

const STORAGE_KEY = "aivoice.history";
const MAX_ENTRIES = 10;

function truncate(text, max = 60) {
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(entries) {
  const metaOnly = entries.map(({ text, voiceId, voiceName, speed }) => ({
    text,
    voiceId,
    voiceName,
    speed,
  }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metaOnly.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota exceeded — history just won't survive a refresh this time */
  }
}

export function initHistory({ listEl, countEl }, { onRestore, onPlay, onDownload } = {}) {
  let entries = loadPersisted().map((e) => ({ ...e, dataUrl: null }));

  function render() {
    listEl.innerHTML = "";
    if (!entries.length) {
      listEl.innerHTML = `<div class="history-empty">No generations yet this session.</div>`;
      if (countEl) countEl.textContent = "00 · 10";
      return;
    }
    entries.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "history-row";
      row.innerHTML = `
        <span class="history-index">${String(entries.length - i).padStart(2, "0")}</span>
        <span class="history-text" title="${entry.text.replace(/"/g, "&quot;")}">"${truncate(entry.text)}"</span>
        <span class="history-voice">${entry.voiceName || entry.voiceId}</span>
        <span class="history-speed">${entry.speed.toFixed(1)}×</span>
        <span class="history-actions">
          <button class="btn-icon-sm" data-action="restore" title="Restore to composer" aria-label="Restore to composer">
            <i class="fa-solid fa-arrow-rotate-left"></i>
          </button>
          ${
            entry.dataUrl
              ? `<button class="btn-icon-sm" data-action="play" title="Play" aria-label="Play"><i class="fa-solid fa-play"></i></button>
                 <button class="btn-icon-sm" data-action="download" title="Download" aria-label="Download"><i class="fa-solid fa-download"></i></button>`
              : `<span class="btn-icon-sm" title="Audio not saved across reloads" style="cursor:default;"><i class="fa-solid fa-ban text-fade"></i></span>`
          }
        </span>
      `;
      row.querySelector('[data-action="restore"]').addEventListener("click", () => onRestore && onRestore(entry));
      const playBtn = row.querySelector('[data-action="play"]');
      if (playBtn) playBtn.addEventListener("click", () => onPlay && onPlay(entry));
      const dlBtn = row.querySelector('[data-action="download"]');
      if (dlBtn) dlBtn.addEventListener("click", () => onDownload && onDownload(entry));
      listEl.appendChild(row);
    });
    if (countEl) countEl.textContent = `${String(entries.length).padStart(2, "0")} · ${MAX_ENTRIES}`;
  }

  function add(entry) {
    entries.unshift({ ...entry });
    entries = entries.slice(0, MAX_ENTRIES);
    persist(entries);
    render();
  }

  render();

  return { add };
}
