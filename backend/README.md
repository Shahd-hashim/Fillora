# Job Autofill backend

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # then edit it
uvicorn main:app --port 8000
```
In a second terminal: `ngrok http 8000`, copy the https URL into the extension's Options page.

Check: open `<url>/health` -> {"status":"ok"}. Interactive API docs: `<url>/docs`.
