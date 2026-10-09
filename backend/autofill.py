"""The decision logic: for every form field decide the answer and where it comes from.

Order for each field:  1) profile rules  ->  2) answers the user saved  ->  3) the AI (RAG + LangChain)
"""
import re
from typing import Optional

import chain
from schemas import (
    AnswerRequest,
    AutofillRequest,
    AutofillResponse,
    FieldIn,
    FieldResult,
    LlmField,
    OptionIn,
)

TEXT_KINDS = {"text", "email", "tel", "url", "number"}
CONSENT = re.compile(r"(agree|terms|privacy|consent|acknowledg|certify|gdpr|policy|accept)", re.I)
UNCLEAR_CHECKBOX = re.compile(r"^(check ?box( label)?|label)$", re.I)
MAX_AI_FIELDS = 40


# ---------- small helpers ----------
def _s(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def _key(text: str) -> str:
    """Same question written slightly differently gives the same key."""
    return re.sub(r"[\W_]+", " ", text.lower()).strip()


def _rule_norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[*:_\-]+", " ", text.lower())).strip()


def split_name(full: str) -> tuple[str, str]:
    parts = full.strip().split()
    return (parts[0] if parts else ""), " ".join(parts[1:])


# ---------- 1) profile rules: fast, free answers for obvious text fields ----------
def rule_answer(f: FieldIn, p: dict) -> Optional[str]:
    if f.kind not in TEXT_KINDS:
        return None

    label, name, ac = _rule_norm(f.label), _rule_norm(f.name), f.autocomplete.lower()
    hay = f"{label} {name} {_rule_norm(f.placeholder)}"
    first, last = split_name(_s(p.get("fullName")))
    extra = p.get("extra") or {}

    def pick(v) -> Optional[str]:
        return _s(v) or None

    if "given-name" in ac:
        return pick(first)
    if "family-name" in ac:
        return pick(last)
    if ac == "name":
        return pick(p.get("fullName"))
    if ac == "email":
        return pick(p.get("email"))
    if ac.startswith("tel"):
        return pick(p.get("phone"))

    if f.kind == "email" or re.search(r"e ?mail", hay):
        return pick(p.get("email"))
    if f.kind == "tel" or re.search(r"\b(phone|mobile|cell|telephone)\b", hay):
        return pick(p.get("phone"))
    if "linkedin" in hay:
        return pick(p.get("linkedin"))
    if "github" in hay:
        return pick(p.get("github"))

    if re.search(r"(first|given|fore) ?name", hay):
        return pick(first)
    if re.search(r"(last|family|sur) ?name", hay):
        return pick(last)
    if re.match(r"^((your|legal|full|candidate) )*name$", label) or name in ("name", "fullname", "full name"):
        return pick(p.get("fullName"))

    if re.search(r"\b(website|portfolio|personal site|personal url|blog)\b", hay):
        return pick(p.get("website"))
    if re.search(r"\b(salary|compensation|expected pay|pay expectation)\b", hay):
        return pick(extra.get("salaryExpectation"))
    if re.search(r"(notice period|earliest start|start date|when can you start|availability)", hay):
        return pick(extra.get("noticePeriod"))
    if re.search(r"\b(city|location|based|where do you live|residence)\b", hay):
        return pick(p.get("location"))
    return None


# ---------- turning an answer into something the page can apply ----------
def match_option(answer: str, options: list[OptionIn]) -> Optional[OptionIn]:
    """Find the option that best matches an answer written by the model."""
    a = _key(answer)
    if not a:
        return None
    opts = [o for o in options if o.value != "" and (o.text.strip() or o.value.strip())]

    for o in opts:
        if _key(o.text) == a or _key(o.value) == a:
            return o
    for o in opts:
        t = _key(o.text)
        if len(t) >= 3 and (t in a or a in t):
            return o
    for word in ("yes", "no"):
        if re.match(rf"^{word}\b", a):
            return next((o for o in opts if re.match(rf"^{word}\b", _key(o.text))), None)
    return None


def fit(text: str, max_len: Optional[int]) -> str:
    """Cut text to the field's character limit, ending on a sentence when possible."""
    if not max_len or len(text) <= max_len:
        return text
    cut = text[:max_len]
    i = cut.rfind(".")
    return cut[: i + 1] if i > max_len * 0.6 else cut.rstrip()


def to_fill(f: FieldIn, answer, source: str) -> Optional[FieldResult]:
    if answer is None or answer == "":
        return None
    if f.kind == "checkbox":
        checked = answer is True or str(answer).lower() in ("true", "yes")
        return FieldResult(id=f.id, source=source, checked=checked, shown="Checked" if checked else "Unchecked")
    if f.kind in ("select", "radio"):
        opt = match_option(str(answer), f.options or [])
        if not opt:
            return None
        return FieldResult(
            id=f.id,
            source=source,
            value=opt.value,
            optionId=opt.id if f.kind == "radio" else None,
            shown=opt.text or opt.value,
        )
    text = fit(str(answer), f.maxLength)
    return FieldResult(id=f.id, source=source, value=text, shown=text)


def skipped(f: FieldIn, note: str) -> FieldResult:
    return FieldResult(id=f.id, source="skipped", note=note)


# ---------- the whole pipeline ----------
def _llm_field(f: FieldIn) -> LlmField:
    options = None
    if f.options:
        options = [o.text for o in f.options if o.value != "" and o.text.strip()][:250]
    return LlmField(
        id=f.id, question=f.label, type=f.kind, required=f.required, maxChars=f.maxLength, options=options
    )


def run(req: AutofillRequest) -> AutofillResponse:
    saved = {_key(a.label): a.answer for a in req.saved_answers if a.answer.strip()}
    results: dict[str, FieldResult] = {}
    need_ai: list[FieldIn] = []

    for f in req.fields:
        if f.kind == "date":
            results[f.id] = skipped(f, "Fill dates yourself")
            continue
        if f.kind == "checkbox" and UNCLEAR_CHECKBOX.match(f.label.strip()):
            results[f.id] = skipped(f, "Unclear label, left for you")
            continue
        if f.kind == "checkbox" and CONSENT.search(f.label):
            results[f.id] = skipped(f, "Left for you to confirm")
            continue

        if not req.ai_only:
            rule = rule_answer(f, req.profile)
            r = to_fill(f, rule, "profile") if rule else None
            if r:
                results[f.id] = r
                continue
            hit = saved.get(_key(f.label))
            r = to_fill(f, hit, "saved") if hit else None
            if r:
                results[f.id] = r
                continue

        need_ai.append(f)

    batch = need_ai[:MAX_AI_FIELDS]
    for f in need_ai[MAX_AI_FIELDS:]:
        results[f.id] = skipped(f, "Too many fields for one run")

    ai_error: Optional[str] = None
    retrieved: dict[str, list[str]] = {}
    answers: dict = {}

    # Short fields and long free-text answers need different instructions, so two requests.
    groups = [
        ([f for f in batch if f.kind != "textarea"], False),
        ([f for f in batch if f.kind == "textarea"], True),
    ]
    tried = ok = 0
    for group, long_form in groups:
        if not group:
            continue
        tried += 1
        try:
            a, r = chain.generate_answers(
                AnswerRequest(
                    profile=req.profile,
                    page=req.page,
                    fields=[_llm_field(f) for f in group],
                    style=req.style,
                    long_form=long_form,
                    avoid=req.avoid,
                )
            )
            answers.update(a)
            retrieved.update(r)
            ok += 1
        except Exception as e:
            ai_error = str(e)[:300]

    for f in batch:
        if tried > 0 and ok == 0:
            results[f.id] = skipped(f, "AI request failed")
            continue
        ans = answers.get(f.id)
        if ans is None or ans == "":
            results[f.id] = skipped(
                f, "No AI answer (a request failed)" if ai_error else "Not enough info in your profile"
            )
            continue
        r = to_fill(f, ans, "ai")
        results[f.id] = r or skipped(f, "Couldn't match one of the options")

    return AutofillResponse(
        results=[results[f.id] for f in req.fields if f.id in results],
        ai_error=ai_error,
        retrieved=retrieved,
    )
