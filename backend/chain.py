"""LangChain layer: prompt template -> LLM (OpenRouter) -> JSON parser, with model fallbacks."""
import json
import os
from datetime import date

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable, RunnableLambda
from langchain_openai import ChatOpenAI

import rag
from schemas import AnswerRequest

OPENROUTER_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODELS = "openai/gpt-oss-120b:free,qwen/qwen3-235b-a22b:free,openrouter/free"

TONES = {
    "professional": "professional and polished",
    "friendly": "warm, friendly and natural",
    "confident": "confident and direct, focused on concrete results",
    "enthusiastic": "enthusiastic and energetic, but still professional",
    "concise": "plain, concise and direct",
}
LENGTHS = {
    "short": "2 to 3 sentences (about 40 to 60 words)",
    "medium": "4 to 6 sentences (about 80 to 120 words)",
    "long": "two short paragraphs (about 150 to 220 words), separated by a blank line",
}

TEMPLATE = """You fill in a job application form for a candidate. Use ONLY the candidate data below.

CANDIDATE PROFILE (JSON):
{profile_json}

RELEVANT PARTS OF THE CANDIDATE'S CV AND PAST ANSWERS (retrieved for each field):
{retrieved_context}

JOB PAGE (title and start of the visible text):
Title: {page_title}
URL: {page_url}
\"\"\"
{page_text}
\"\"\"

FORM FIELDS (JSON):
{fields_json}
{avoid_block}
Return ONLY one JSON object, with no explanation and no markdown: {{"answers": {{"<field id>": <answer>, ...}}}}

Rules:
{rules}"""

prompt = ChatPromptTemplate.from_messages([("human", TEMPLATE)])

# ---------- CV parsing prompt ----------
CV_SCHEMA = """{
  "fullName": "",
  "email": "",
  "phone": "",
  "location": "city, country",
  "linkedin": "",
  "github": "",
  "website": "",
  "summary": "2-3 sentence professional summary taken from the CV",
  "skills": ["..."],
  "languages": ["..."],
  "education": [{"school":"","degree":"","field":"","start":"","end":""}],
  "experience": [{"company":"","title":"","start":"","end":"","description":"main responsibilities and achievements"}]
}"""

CV_TEMPLATE = """You extract structured data from a CV.
Return ONLY one JSON object that follows this shape, with no explanation and no markdown:
{schema}

Rules:
- Use only information present in the CV. Use "" or [] when something is missing. Never invent values.
- Dates as written in the CV (for example "Jan 2022" or "Present").
- Keep experience in the order given in the CV.

CV TEXT:
\"\"\"
{cv_text}
\"\"\""""

cv_prompt = ChatPromptTemplate.from_messages([("human", CV_TEMPLATE)])


# ---------- parsing ----------
def extract_json(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("The model did not return JSON.")
    return json.loads(text[start : end + 1])


parse_json = RunnableLambda(extract_json)


# ---------- LLM + fallbacks ----------
def _chain_for(model: str, template: ChatPromptTemplate) -> Runnable:
    llm = ChatOpenAI(
        model=model,
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=OPENROUTER_URL,
        temperature=0,
        timeout=90,
        max_retries=0,  # fail fast so the next model can take over
        default_headers={"X-Title": "Job Autofill AI"},
    )
    return template | llm | StrOutputParser() | parse_json


def build_chain(template: ChatPromptTemplate) -> Runnable:
    """First model is the main one; the others are tried in order if it errors or returns bad JSON."""
    models = [m.strip() for m in os.getenv("MODELS", DEFAULT_MODELS).split(",") if m.strip()][:3]
    chains = [_chain_for(m, template) for m in models]
    return chains[0].with_fallbacks(chains[1:]) if len(chains) > 1 else chains[0]


# ---------- prompt pieces ----------
def build_rules(req: AnswerRequest) -> str:
    common = (
        "- Include every field id. Use null when the candidate data does not contain the answer.\n"
        "- Never guess salary, dates, ID numbers or other personal facts. "
        "Never invent employers, degrees, skills or years of experience."
    )
    if req.long_form:
        tone = TONES.get(req.style.tone, TONES["professional"])
        length = LENGTHS.get(req.style.length, LENGTHS["medium"])
        extra = f"\n- Extra instructions from the candidate: {req.style.extra.strip()}" if req.style.extra.strip() else ""
        return (
            f"{common}\n"
            f"- Write in the first person in a {tone} tone. Length: {length}.\n"
            "- Be specific: use real projects, tools, results and years from the candidate's own experience. "
            'No filler openings such as "I am writing to apply" or "I am passionate about", and no clichés.\n'
            "- If the job page makes the company or role clear, tie the answer to it. "
            "If it is not clear, do not name a company and never write placeholders like [Company].\n"
            '- If "maxChars" is present, stay safely under it.\n'
            f"- Plain text only: no markdown, bullet points or headings.{extra}"
        )
    return (
        f"{common}\n"
        '- text, email, tel, url, number: a short value only, no explanation. Respect "maxChars" if present.\n'
        "- select and radio: answer with exactly one of the listed options, copied word for word.\n"
        "- checkbox: true or false.\n"
        '- Gender, ethnicity, disability and veteran questions: choose the option meaning "prefer not to say" '
        'or "decline to answer" if one exists, otherwise null.\n'
        f"- Years of experience: work it out from the experience dates if possible (today is {date.today().strftime('%a %b %d %Y')}), otherwise null."
    )


def retrieve_context(req: AnswerRequest) -> tuple[str, dict[str, list[str]]]:
    """RAG step: for each form field, fetch the CV chunks most similar to the question."""
    retrieved: dict[str, list[str]] = {}
    blocks: list[str] = []
    for f in req.fields:
        # For free-text answers, also search with the job title so we pull the most relevant experience.
        query = f"{f.question}\n{req.page.title}" if req.long_form else f.question
        try:
            docs = rag.retrieve(query, k=4 if req.long_form else 3)
        except Exception:
            docs = []  # nothing ingested yet: the model still gets the structured profile
        texts = [d.page_content for d in docs]
        retrieved[f.id] = texts
        if texts:
            body = "\n".join(f"- {t}" for t in texts)
            blocks.append(f"[{f.id}] {f.question}\n{body}")
    return "\n\n".join(blocks) or "(nothing retrieved)", retrieved


# ---------- main entry ----------
_chain: Runnable | None = None
_cv_chain: Runnable | None = None


def parse_cv(cv_text: str) -> dict:
    """Structured extraction: raw CV text -> JSON profile (same shape the extension stores)."""
    global _cv_chain
    if _cv_chain is None:
        _cv_chain = build_chain(cv_prompt)
    return _cv_chain.invoke({"schema": CV_SCHEMA, "cv_text": cv_text[:12000]})


def generate_answers(req: AnswerRequest) -> tuple[dict, dict[str, list[str]]]:
    global _chain
    if _chain is None:
        _chain = build_chain(prompt)

    context, retrieved = retrieve_context(req)

    field_list = [
        {
            "id": f.id,
            "question": f.question,
            "type": f.type,
            "required": f.required,
            "maxChars": f.maxChars,
            "options": f.options,
        }
        for f in req.fields
    ]
    rejected = {k: v for k, v in req.avoid.items() if v and any(f.id == k for f in req.fields)}
    avoid_block = (
        "\nREJECTED EARLIER ANSWERS (the candidate did not like these, so write something clearly different):\n"
        f"{json.dumps(rejected)}\n"
        if rejected
        else ""
    )

    raw = _chain.invoke(
        {
            "profile_json": json.dumps(req.profile, ensure_ascii=False),
            "retrieved_context": context,
            "page_title": req.page.title,
            "page_url": req.page.url,
            "page_text": req.page.text,
            "fields_json": json.dumps(field_list, ensure_ascii=False),
            "avoid_block": avoid_block,
            "rules": build_rules(req),
        }
    )

    found = raw.get("answers") if isinstance(raw.get("answers"), dict) else raw
    answers: dict = {}
    for f in req.fields:
        v = found.get(f.id)
        answers[f.id] = v if isinstance(v, (str, bool)) else (None if v is None else str(v))
    return answers, retrieved
