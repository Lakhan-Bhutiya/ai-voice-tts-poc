// Voice card grid + filter pills. All metadata (accent, gender) is parsed
// client-side from the voiceId convention documented in main.py:
// char 1 = a(US)/b(UK), char 2 = f(female)/m(male). No backend change needed.

function parseVoice(voice) {
  const accent = voice.voiceId[0] === "b" ? "UK" : "US";
  const gender = voice.voiceId[1] === "m" ? "MALE" : "FEMALE";
  const name = (voice.displayName || voice.voiceId).replace(/\s*\(.*\)\s*$/, "");
  return { ...voice, accent, gender, name, monogram: name.charAt(0).toUpperCase() };
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "US", label: "US" },
  { key: "UK", label: "UK" },
  { key: "FEMALE", label: "Female" },
  { key: "MALE", label: "Male" },
];

export function initVoices(rawVoices, { onSelect } = {}) {
  const parsed = rawVoices.map(parseVoice);
  let selectedId = parsed[0]?.voiceId || null;
  let activeFilter = "all";

  const listEl = document.getElementById("voiceList");
  const filterEl = document.getElementById("voiceFilters");
  const countEl = document.getElementById("voiceCount");

  function matchesFilter(v) {
    if (activeFilter === "all") return true;
    if (activeFilter === "US" || activeFilter === "UK") return v.accent === activeFilter;
    return v.gender === activeFilter;
  }

  function render() {
    listEl.innerHTML = "";
    let visible = 0;
    parsed.forEach((v) => {
      const shown = matchesFilter(v);
      if (shown) visible++;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "voice-card" + (v.voiceId === selectedId ? " selected" : "") + (shown ? "" : " hidden");
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", String(v.voiceId === selectedId));
      card.dataset.voiceId = v.voiceId;
      card.innerHTML = `
        <span class="voice-monogram">${v.monogram}</span>
        <span class="voice-info">
          <span class="voice-name">${v.name}</span>
          <span class="voice-badges">
            <span class="badge-tag">${v.accent}</span>
            <span class="badge-tag">${v.gender}</span>
          </span>
        </span>
        <i class="fa-solid fa-check"></i>
      `;
      card.addEventListener("click", () => select(v.voiceId));
      listEl.appendChild(card);
    });
    if (countEl) countEl.textContent = `${String(visible).padStart(2, "0")} · ${parsed.length}`;
  }

  function select(voiceId) {
    selectedId = voiceId;
    render();
    if (onSelect) onSelect(getSelectedVoice());
  }

  function getSelectedVoice() {
    return parsed.find((v) => v.voiceId === selectedId) || null;
  }

  if (filterEl) {
    filterEl.innerHTML = "";
    FILTERS.forEach((f) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "pill" + (f.key === activeFilter ? " active" : "");
      pill.textContent = f.label;
      pill.addEventListener("click", () => {
        activeFilter = f.key;
        [...filterEl.children].forEach((c) => c.classList.remove("active"));
        pill.classList.add("active");
        render();
      });
      filterEl.appendChild(pill);
    });
  }

  render();

  return {
    getSelected: getSelectedVoice,
    setSelected: select,
    all: parsed,
  };
}
