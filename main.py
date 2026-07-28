"""
Human-like Text-to-Speech POC — FastAPI backend over the local Kokoro TTS model.

Speech is generated entirely on this machine (CPU) via the `kokoro` library, so
no TTS API key is required. OpenAI (gpt-4o-mini) is still used, optionally, to
polish the text's punctuation/pacing for a more natural read.
"""

import base64
import io
import os
from pathlib import Path

# HuggingFace's Xet transfer backend stalls on some networks; force classic HTTP
# downloads. Must be set before kokoro (and thus huggingface_hub) is imported.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

import httpx
import numpy as np
import soundfile as sf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from kokoro import KModel, KPipeline
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE = "https://api.openai.com/v1"
BASE_DIR = Path(__file__).parent
MODEL_DIR = BASE_DIR / "models"
SAMPLE_RATE = 24000

# Curated Kokoro voices. Prefix encodes language+gender: a=American, b=British.
VOICES = [
    {"voiceId": "af_heart", "displayName": "Heart (US, female)"},
    {"voiceId": "af_bella", "displayName": "Bella (US, female)"},
    {"voiceId": "af_nicole", "displayName": "Nicole (US, female)"},
    {"voiceId": "af_sarah", "displayName": "Sarah (US, female)"},
    {"voiceId": "am_adam", "displayName": "Adam (US, male)"},
    {"voiceId": "am_michael", "displayName": "Michael (US, male)"},
    {"voiceId": "am_fenrir", "displayName": "Fenrir (US, male)"},
    {"voiceId": "bf_emma", "displayName": "Emma (UK, female)"},
    {"voiceId": "bf_isabella", "displayName": "Isabella (UK, female)"},
    {"voiceId": "bm_george", "displayName": "George (UK, male)"},
    {"voiceId": "bm_lewis", "displayName": "Lewis (UK, male)"},
]

# Kokoro reads punctuation for prosody, so the enhancer improves pacing/emphasis
# rather than inserting emotion tags (which this model would read literally).
ENHANCE_SYSTEM_PROMPT = (
    "You rewrite text so a text-to-speech engine reads it more naturally and "
    "expressively. The engine has NO emotion tags; it conveys delivery only "
    "through punctuation and phrasing.\n"
    "Rules:\n"
    "- Keep ALL the original words and their meaning. Do not add or remove content.\n"
    "- You MAY adjust punctuation and sentence breaks: add commas, ellipses (...), "
    "em dashes, and paragraph breaks to control pauses, emphasis, and rhythm.\n"
    "- Do NOT use bracketed tags or stage directions of any kind.\n"
    "- Return ONLY the rewritten text, nothing else."
)

app = FastAPI(title="AI Voice POC (Kokoro)", version="2.0.0")

# Allow a separately-hosted frontend to call this API from any origin (POC).
# Tighten `allow_origins` to specific domains for production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared model (loaded from local files, downloaded once) + one KPipeline per
# language code. The KModel is language-agnostic; only the G2P differs per lang.
_kmodel: KModel | None = None
_pipelines: dict[str, KPipeline] = {}


def get_model() -> KModel:
    global _kmodel
    if _kmodel is None:
        _kmodel = KModel(
            config=str(MODEL_DIR / "config.json"),
            model=str(MODEL_DIR / "kokoro-v1_0.pth"),
        )
    return _kmodel


def get_pipeline(lang_code: str) -> KPipeline:
    if lang_code not in _pipelines:
        _pipelines[lang_code] = KPipeline(lang_code=lang_code, model=get_model())
    return _pipelines[lang_code]


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    voiceId: str = "af_heart"
    speed: float = Field(1.0, ge=0.5, le=2.0)


class EnhanceRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


def _synthesize_blocking(text: str, voice: str, speed: float) -> bytes:
    """Run Kokoro (CPU-bound, blocking) and return WAV bytes."""
    lang_code = voice[0]  # 'a' -> American English, 'b' -> British English
    pipeline = get_pipeline(lang_code)
    chunks = [audio for _, _, audio in pipeline(text, voice=voice, speed=speed)]
    if not chunks:
        raise HTTPException(status_code=422, detail="No audio produced for this text.")
    audio = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV")
    return buf.getvalue()


@app.get("/api/health")
async def health():
    """Lightweight status check for the frontend / uptime monitors."""
    return {
        "status": "ok",
        "engine": "kokoro",
        "modelLoaded": _kmodel is not None,
        "modelFilePresent": (MODEL_DIR / "kokoro-v1_0.pth").exists(),
        "enhanceAvailable": bool(OPENAI_API_KEY),
    }


@app.get("/api/voices")
async def list_voices():
    return {"voices": VOICES}


@app.post("/api/synthesize")
async def synthesize(req: SynthesizeRequest):
    """Generate speech locally with Kokoro; return base64 WAV + a data URL."""
    if not any(v["voiceId"] == req.voiceId for v in VOICES):
        raise HTTPException(status_code=400, detail=f"Unknown voice {req.voiceId}")
    wav = await run_in_threadpool(
        _synthesize_blocking, req.text, req.voiceId, req.speed
    )
    audio_b64 = base64.b64encode(wav).decode("ascii")
    return {"audioContent": audio_b64, "dataUrl": f"data:audio/wav;base64,{audio_b64}"}


@app.post("/api/enhance")
async def enhance(req: EnhanceRequest):
    """Use OpenAI gpt-4o-mini to polish punctuation/pacing for a natural read."""
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY missing. Add it to .env to use AI enhancement.",
        )
    payload = {
        "model": "gpt-4o-mini",
        "temperature": 0.7,
        "messages": [
            {"role": "system", "content": ENHANCE_SYSTEM_PROMPT},
            {"role": "user", "content": req.text},
        ],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OPENAI_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    enhanced = resp.json()["choices"][0]["message"]["content"].strip()
    return {"enhanced": enhanced}


@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
