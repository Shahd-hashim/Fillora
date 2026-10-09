# Fillora
Fillora is an AI-powered browser extension that understands job application forms and intelligently completes them using information from a user's CV and personal profile. It can identify what each field is asking, retrieve the most relevant information, and generate personalized responses for complex questions based on the user's experience.


Fillora is an AI-powered browser extension that understands job application forms and intelligently completes them using information from a user's CV and personal profile. It can identify what each field is asking, retrieve the most relevant information, and generate personalized responses for complex questions based on the user's experience.

Chrome extension (TypeScript) + Python backend (FastAPI, RAG, LangChain).

1. Detect form fields on the page.
2. Profile page: upload a CV.
3. Autofill: obvious fields come from your profile, the rest are answered by the AI. Your stored CV is attached to resume fields, and forms inside iframes are supported.

**The extension has no AI or answer logic.** It only detects form fields, fills them, and shows the UI.
Everything else happens in the Python backend:

**The extension has no AI or answer logic.** It only detects form fields, fills them, and shows the UI.
Everything else happens in the Python backend:

- `POST /parse-cv`  - upload a CV file; the backend reads it, extracts the profile with LangChain,
  and stores the CV chunks in Chroma for RAG.
- `POST /autofill`  - the extension sends the form fields; for each one the backend decides the answer:
  profile rules -> answers you saved -> the AI (retrieves the relevant CV chunks, then LangChain + LLM).

```
job-autofill/
├── src/                     extension
│   ├── background/index.ts  orchestrates a run (scan page, call backend, apply fills)
│   ├── content/             detect and fill fields on the page (DOM only)
│   ├── popup/  options/     UI
│   ├── types.ts             shared types (profile, fields, messages)
│   └── lib/
│       ├── storage.ts       chrome.storage (settings, profile, saved answers, stored CV file)
│       └── api.ts           the only code that talks to the backend
└── backend/                 all the intelligence (Python)
    ├── main.py              FastAPI endpoints
    ├── autofill.py          decision logic: rules, saved answers, AI, option matching
    ├── chain.py             LangChain prompts, LLM calls, model fallbacks
    ├── rag.py               chunking, embeddings, Chroma, retrieval
    ├── cv.py                read PDF / DOCX / TXT, clean the extracted profile
    └── schemas.py           request / response models
```

## Run the backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # Windows: copy .env.example .env  (then edit it)
uvicorn main:app --port 8000
```
In a second terminal: `ngrok http 8000` and copy the https URL.

## Run the extension
```bash
npm install
npm run build        # outputs to dist/
```
Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> select `dist`.
Open the extension's Options page, paste the ngrok URL and your BACKEND_SECRET, save,
then upload your CV. After rebuilding, press the reload icon on the extension and reload the job page.
