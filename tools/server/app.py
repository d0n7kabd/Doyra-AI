"""Doyra Studio, full power on this laptop.

Serves the website and an /api that runs the same pipeline as add_song.py,
including Demucs "exact drums". The studio notices the server by itself:
uploads go through it and the studio shows "AI engine: full (laptop)".

Start (from the repo root):
    python tools/server/app.py              # http://localhost:8000
    python tools/server/app.py --port 8080 --no-demucs

Nothing leaves this computer: files are processed here and kept only in memory
(and a temp folder while processing).
"""
from __future__ import annotations

import argparse
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SITE = REPO / "doyra-ai-site"
sys.path.insert(0, str(REPO / "tools" / "library"))

import pipeline  # noqa: E402
from fastapi import FastAPI, File, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

app = FastAPI(title="Doyra Studio, laptop engine")
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()  # one Demucs run at a time: it needs a lot of memory
OPTIONS = {"demucs": True}


@app.get("/api/health")
def health():
    return {"engine": "full", "demucs": OPTIONS["demucs"] and pipeline.demucs_available()}


@app.post("/api/process")
async def process(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    job = {"id": uuid.uuid4().hex, "name": file.filename, "stage": "queued", "result": None,
           "error": None, "started": time.time()}
    JOBS[job["id"]] = job
    threading.Thread(target=run, args=(job, data, Path(file.filename or "song").suffix or ".mp3"), daemon=True).start()
    return {"job": job["id"]}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "no such job")
    return JSONResponse({k: job[k] for k in ("id", "stage", "result", "error")}
                        | {"seconds": round(time.time() - job["started"])})


def run(job: dict, data: bytes, suffix: str) -> None:
    def progress(stage: str, partial: dict) -> None:
        job["stage"] = stage
        if stage == "analysed":  # the studio can start playing while Demucs works
            job["result"] = dict(partial)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / f"upload{suffix}"
            src.write_bytes(data)
            with LOCK:
                job["result"] = pipeline.process(src, use_demucs=OPTIONS["demucs"], progress=progress)
        job["stage"] = "done"
    except Exception as e:  # report, don't crash the server
        job["error"] = str(e)
        job["stage"] = "failed"
    finally:
        # forget old jobs (results can be large)
        for k in [k for k, j in JOBS.items() if time.time() - j["started"] > 3600]:
            JOBS.pop(k, None)


app.mount("/", StaticFiles(directory=SITE, html=True), name="site")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-demucs", action="store_true", help="skip exact drums (faster, less memory)")
    a = ap.parse_args()
    OPTIONS["demucs"] = not a.no_demucs
    import uvicorn
    demucs = "on" if OPTIONS["demucs"] and pipeline.demucs_available() else "off"
    print(f"Doyra Studio, laptop engine (Demucs exact drums: {demucs})")
    print(f"Open http://localhost:{a.port}/studio/   (Ctrl+C to stop)")
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
