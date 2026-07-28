# AI Voice — Human-like TTS POC

A proof of concept for human-like text-to-speech using the **local Kokoro model**
(runs fully on-device, no TTS API key), with a **FastAPI** backend and a small web
UI. Optionally uses **OpenAI gpt-4o-mini** to polish the text's pacing/punctuation.

## Stack
- Python 3.12 + FastAPI
- **Kokoro** (82M) TTS running locally on CPU (via `kokoro` + PyTorch CPU)
- `uv` for env / dependency management
- Vanilla HTML/JS frontend (no build step)

## Setup

```bash
uv venv --python 3.12
# CPU-only PyTorch (smaller; avoids CUDA):
uv pip install torch --index-url https://download.pytorch.org/whl/cpu
uv pip install -r requirements.txt
```

### Model files
The Kokoro weights live in `models/` (downloaded once, ~312 MB):

```bash
mkdir -p models
curl -L -o models/config.json \
  https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/config.json
curl -L -C - --retry 10 -o models/kokoro-v1_0.pth \
  https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1_0.pth
```

> **Note:** HuggingFace's "Xet" download backend can stall on some networks, so
> the app sets `HF_HUB_DISABLE_XET=1` and loads the model from local files in
> `models/`. `curl -C -` resumes if the download is interrupted.

### OpenAI (optional, for the ✨ Enhance button)
Add your key to `.env`:

```
OPENAI_API_KEY=sk-...
```

## Run

```bash
uv run uvicorn main:app --reload --port 8000
```

Open http://127.0.0.1:8000

## Features
- Type text (up to 2000 chars) and generate speech locally
- **11 voices** (US/UK, male/female) and a **speed** control
- **✨ Enhance with AI** — gpt-4o-mini rewrites punctuation/phrasing for a more
  natural read (no words changed). Kokoro conveys delivery via punctuation, not
  emotion tags.
- In-browser playback + WAV download

## API (for frontend integration)

Base URL: `http://localhost:8000`. **CORS is open** (`*`), so a frontend on any
origin (e.g. `localhost:3000`) can call these directly. Interactive docs at
`http://localhost:8000/docs`.

### `GET /api/health`
```json
{ "status": "ok", "engine": "kokoro", "modelLoaded": false,
  "modelFilePresent": true, "enhanceAvailable": true }
```

### `GET /api/voices`
```json
{ "voices": [ { "voiceId": "af_heart", "displayName": "Heart (US, female)" }, ... ] }
```

### `POST /api/synthesize`
Request:
```json
{ "text": "Hello world", "voiceId": "af_heart", "speed": 1.0 }
```
`speed` is 0.5–2.0 (default 1.0). `text` ≤ 2000 chars. Response:
```json
{ "audioContent": "<base64 WAV>", "dataUrl": "data:audio/wav;base64,..." }
```
Play it in the browser with `audio.src = data.dataUrl`.

### `POST /api/enhance` (optional, needs `OPENAI_API_KEY`)
```json
// request
{ "text": "raw text" }
// response
{ "enhanced": "text with better punctuation/pacing" }
```

Errors are returned as `{ "detail": "..." }` with a non-200 status.

Example fetch:
```js
const r = await fetch("http://localhost:8000/api/synthesize", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text, voiceId: "af_heart", speed: 1.0 }),
});
const { dataUrl } = await r.json();
new Audio(dataUrl).play();
```

Synthesis runs on CPU in a threadpool so it doesn't block the event loop.
First generation per language loads the model into memory (a few seconds).
