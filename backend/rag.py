"""RAG layer: turn the candidate's data into chunks, embed them, store them in Chroma, retrieve them."""
import os
from functools import lru_cache

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

PERSIST_DIR = os.getenv("CHROMA_DIR", "./chroma_db")
EMBED_MODEL = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
COLLECTION = "candidate"

_splitter = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=100)


@lru_cache(maxsize=1)
def _embeddings() -> HuggingFaceEmbeddings:
    # Runs locally on CPU: free, no extra API key. The model downloads on first use (~90 MB).
    return HuggingFaceEmbeddings(model_name=EMBED_MODEL)


def _store() -> Chroma:
    return Chroma(
        collection_name=COLLECTION,
        embedding_function=_embeddings(),
        persist_directory=PERSIST_DIR,
    )


def _s(value) -> str:
    """Clean string; lists (the LLM sometimes returns a list for skills) are joined with commas."""
    if isinstance(value, list):
        return ", ".join(str(v).strip() for v in value if str(v).strip())
    return value.strip() if isinstance(value, str) else ""


def build_documents(profile: dict, cv_text: str) -> list[Document]:
    """Split everything we know about the candidate into small, searchable chunks."""
    docs: list[Document] = []

    def add(text: str, kind: str) -> None:
        if text.strip():
            docs.append(Document(page_content=text.strip(), metadata={"type": kind}))

    # 1) Structured profile: one chunk per job / degree so retrieval returns a whole entry.
    for e in profile.get("experience") or []:
        if not isinstance(e, dict):
            continue
        period = f"{_s(e.get('start'))} - {_s(e.get('end'))}".strip(" -")
        add(
            f"Experience: {_s(e.get('title'))} at {_s(e.get('company'))} ({period}). "
            f"{_s(e.get('description'))}",
            "experience",
        )
    for e in profile.get("education") or []:
        if not isinstance(e, dict):
            continue
        period = f"{_s(e.get('start'))} - {_s(e.get('end'))}".strip(" -")
        add(
            f"Education: {_s(e.get('degree'))} in {_s(e.get('field'))} at {_s(e.get('school'))} ({period})",
            "education",
        )
    if _s(profile.get("skills")):
        add(f"Skills: {_s(profile['skills'])}", "skills")
    if _s(profile.get("languages")):
        add(f"Languages: {_s(profile['languages'])}", "skills")
    if _s(profile.get("summary")):
        add(f"Summary: {_s(profile['summary'])}", "summary")
    extra = profile.get("extra") or {}
    if _s(extra.get("notes")):
        add(f"Notes from the candidate: {_s(extra['notes'])}", "notes")

    # 2) Raw CV text: catches details the structured parsing missed (projects, certificates...).
    for piece in _splitter.split_text(cv_text or ""):
        add(piece, "cv")

    return docs


def ingest(profile: dict, cv_text: str) -> int:
    """Replace the whole collection with fresh chunks. Returns how many were stored."""
    docs = build_documents(profile, cv_text)
    try:
        _store().delete_collection()
    except Exception:
        pass  # first run: nothing to delete
    if docs:
        _store().add_documents(docs)
    return len(docs)


def retrieve(query: str, k: int = 4) -> list[Document]:
    return _store().similarity_search(query, k=k)
