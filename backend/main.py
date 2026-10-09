"""FastAPI server for Job Autofill AI. All the "thinking" lives here; the extension only talks to the page.

Run:   uvicorn main:app --port 8000
Share: ngrok http 8000

Endpoints:
  POST /parse-cv   upload a CV file -> profile JSON (LangChain) and the CV is stored for RAG
  POST /autofill   form fields -> an answer per field (rules, saved answers, then RAG + LangChain)
"""
import hmac
import os

from dotenv import load_dotenv

load_dotenv()  # must run before chain.py / rag.py read the environment

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

import autofill  # noqa: E402
import chain  # noqa: E402
import cv  # noqa: E402
import rag  # noqa: E402
from schemas import AutofillRequest, AutofillResponse  # noqa: E402

MAX_UPLOAD = 10 * 1024 * 1024

app = FastAPI(title="Job Autofill AI backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # the extension authenticates with a secret header, not with cookies
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_secret(x_api_secret: str = Header(default="")) -> None:
    expected = os.getenv("BACKEND_SECRET", "")
    if expected and not hmac.compare_digest(x_api_secret, expected):
        raise HTTPException(status_code=401, detail="Wrong or missing X-Api-Secret.")


def require_key() -> None:
    if not os.getenv("OPENROUTER_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not set in backend/.env")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/parse-cv", dependencies=[Depends(require_secret), Depends(require_key)])
def parse_cv(file: UploadFile = File(...)) -> dict:
    """Read the CV file, extract the profile with LangChain, and store the CV chunks for RAG."""
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="The file is over 10 MB.")
    try:
        text = cv.extract_text(file.filename or "", data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Couldn't read this file: {str(e)[:200]}") from e
    if len(text) < 30:
        raise HTTPException(
            status_code=400,
            detail="No text found in this file. If it is a scanned PDF, export a text version and try again.",
        )
    try:
        profile = cv.normalize_profile(chain.parse_cv(text))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM step failed: {str(e)[:300]}") from e
    rag.ingest(profile, text)  # replaces whatever CV was stored before
    return profile


@app.post("/autofill", response_model=AutofillResponse, dependencies=[Depends(require_secret)])
def run_autofill(req: AutofillRequest) -> AutofillResponse:
    """Decide the answer for every field (the AI part needs OPENROUTER_API_KEY)."""
    return autofill.run(req)
