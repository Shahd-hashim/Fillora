"""Request / response models (Pydantic)."""
from typing import Optional

from pydantic import BaseModel, Field


# ---------- what the extension sends to /autofill ----------
class OptionIn(BaseModel):
    id: str = ""
    value: str = ""
    text: str = ""


class FieldIn(BaseModel):
    """A form field detected on the page (the extension sends it as is)."""
    id: str
    kind: str                       # text, email, tel, url, number, textarea, select, radio, checkbox, date
    label: str = ""
    name: str = ""
    placeholder: str = ""
    autocomplete: str = ""
    required: bool = False
    options: Optional[list[OptionIn]] = None
    maxLength: Optional[int] = None


class SavedAnswerIn(BaseModel):
    label: str
    answer: str


class PageIn(BaseModel):
    title: str = ""
    url: str = ""
    text: str = ""


class StyleIn(BaseModel):
    tone: str = "professional"
    length: str = "medium"
    extra: str = ""


class AutofillRequest(BaseModel):
    profile: dict = Field(default_factory=dict)
    page: PageIn = Field(default_factory=PageIn)
    fields: list[FieldIn]
    saved_answers: list[SavedAnswerIn] = Field(default_factory=list)
    style: StyleIn = Field(default_factory=StyleIn)
    ai_only: bool = False                                  # "Redo": skip rules and saved answers
    avoid: dict[str, str] = Field(default_factory=dict)    # field id -> answer the user rejected


# ---------- what /autofill returns ----------
class FieldResult(BaseModel):
    id: str
    source: str                     # "profile" | "saved" | "ai" | "skipped"
    value: str = ""                 # text to type, or the option value to select
    optionId: Optional[str] = None  # radio: which option to click
    checked: Optional[bool] = None  # checkbox
    shown: str = ""                 # what the popup displays
    note: str = ""                  # why a field was skipped


class AutofillResponse(BaseModel):
    results: list[FieldResult]
    ai_error: Optional[str] = None
    # Which CV chunks were retrieved for each AI-answered field (handy for demos and debugging).
    retrieved: dict[str, list[str]] = Field(default_factory=dict)


# ---------- internal: what the LangChain step receives ----------
class LlmField(BaseModel):
    id: str
    question: str
    type: str
    required: bool = False
    maxChars: Optional[int] = None
    options: Optional[list[str]] = None


class AnswerRequest(BaseModel):
    profile: dict = Field(default_factory=dict)
    page: PageIn = Field(default_factory=PageIn)
    fields: list[LlmField]
    style: StyleIn = Field(default_factory=StyleIn)
    long_form: bool = False
    avoid: dict[str, str] = Field(default_factory=dict)


# ---------- /parse-cv ----------
# (the endpoint takes a file upload and returns the profile as a plain dict)
