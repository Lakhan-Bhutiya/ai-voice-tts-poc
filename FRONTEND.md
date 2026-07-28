# Frontend Integration Guide — AI Voice API

Everything a frontend developer needs to consume the TTS backend. You do **not**
need Python, the model, or any keys — just call the HTTP API.

- **Base URL (local):** `http://localhost:8000`
- **CORS:** open (`*`) — call it directly from any origin (e.g. a React app on `localhost:3000`).
- **Content-Type:** `application/json` for all POSTs.
- **Interactive docs:** `http://localhost:8000/docs` (try requests in-browser).

> Audio comes back as **base64 WAV** plus a ready-to-use **`dataUrl`**. Set it as
> an `<audio>` src and play — no blob/decoding needed.

---

## Endpoints

### 1. `GET /api/health`
Check the backend and model status (good for a startup ping).
```json
{
  "status": "ok",
  "engine": "kokoro",
  "modelLoaded": false,        // true after the first synth loads the model
  "modelFilePresent": true,    // false → backend can't synthesize yet
  "enhanceAvailable": true     // false → hide the "Enhance" button
}
```

### 2. `GET /api/voices`
List the voices for a dropdown.
```json
{
  "voices": [
    { "voiceId": "af_heart",    "displayName": "Heart (US, female)" },
    { "voiceId": "af_bella",    "displayName": "Bella (US, female)" },
    { "voiceId": "af_nicole",   "displayName": "Nicole (US, female)" },
    { "voiceId": "af_sarah",    "displayName": "Sarah (US, female)" },
    { "voiceId": "am_adam",     "displayName": "Adam (US, male)" },
    { "voiceId": "am_michael",  "displayName": "Michael (US, male)" },
    { "voiceId": "am_fenrir",   "displayName": "Fenrir (US, male)" },
    { "voiceId": "bf_emma",     "displayName": "Emma (UK, female)" },
    { "voiceId": "bf_isabella", "displayName": "Isabella (UK, female)" },
    { "voiceId": "bm_george",   "displayName": "George (UK, male)" },
    { "voiceId": "bm_lewis",    "displayName": "Lewis (UK, male)" }
  ]
}
```

### 3. `POST /api/synthesize`  ← the main one
| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string | yes | 1–2000 chars |
| `voiceId` | string | no | default `af_heart`; must be a valid `voiceId` |
| `speed` | number | no | `0.5`–`2.0`, default `1.0` |

Request:
```json
{ "text": "Hello there!", "voiceId": "af_heart", "speed": 1.0 }
```
Response:
```json
{
  "audioContent": "<base64-encoded WAV>",
  "dataUrl": "data:audio/wav;base64,UklGR... (playable directly)"
}
```

### 4. `POST /api/enhance` (optional)
Polishes punctuation/phrasing for a more natural read (no words changed).
Requires `OPENAI_API_KEY` on the backend — check `enhanceAvailable` first.
```json
// request
{ "text": "raw text without much punctuation" }
// response
{ "enhanced": "Raw text — now with better punctuation, and pacing." }
```

---

## Errors
Non-200 responses use:
```json
{ "detail": "human-readable message" }
```
Common: `400` invalid voice, `422` empty/oversized text, `500` enhance when no
OpenAI key (or OpenAI outage). Always read `detail` for the message.

---

## Copy-paste examples

### Vanilla JS
```js
const API = "http://localhost:8000";

async function loadVoices() {
  const { voices } = await (await fetch(`${API}/api/voices`)).json();
  return voices; // [{ voiceId, displayName }]
}

async function speak(text, voiceId = "af_heart", speed = 1.0) {
  const res = await fetch(`${API}/api/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId, speed }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
  const { dataUrl } = await res.json();
  new Audio(dataUrl).play();
}
```

### React (minimal)
```jsx
import { useEffect, useState } from "react";
const API = "http://localhost:8000";

export default function TTS() {
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState("af_heart");
  const [text, setText] = useState("Hello from React!");
  const [audio, setAudio] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/voices`).then(r => r.json())
      .then(d => setVoices(d.voices)).catch(() => {});
  }, []);

  async function generate() {
    setLoading(true); setError("");
    try {
      const r = await fetch(`${API}/api/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId, speed: 1.0 }),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      setAudio((await r.json()).dataUrl);
    } catch (e) { setError(String(e.message || e)); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000} />
      <select value={voiceId} onChange={e => setVoiceId(e.target.value)}>
        {voices.map(v => <option key={v.voiceId} value={v.voiceId}>{v.displayName}</option>)}
      </select>
      <button onClick={generate} disabled={loading}>
        {loading ? "Generating…" : "Generate speech"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {audio && <audio src={audio} controls autoPlay />}
    </div>
  );
}
```

---

## Things to know
- **First synth is slower** (~10–15s) — the backend loads the model into memory
  once. Later requests are fast. Show a loading state.
- **No emotion tags.** This engine expresses tone through **voice choice** and
  **punctuation**, not `[happy]`/`[sad]` markup. Typing tags will read them aloud.
  Use `/api/enhance` to auto-improve punctuation instead.
- **Downloading the audio:** the `dataUrl` works as an `<a download href={dataUrl}>`.
- **Deploying to a different host?** Ask the backend dev to restrict
  `allow_origins` in `main.py` to your frontend's domain instead of `*`.
