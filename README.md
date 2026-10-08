# Job Autofill AI

1. Detect form fields on the page.
2. Profile page: upload a CV, parsed via OpenRouter.
3. Autofill: obvious fields come from your profile, the rest are answered by the AI. Your stored CV is attached to resume fields, and forms inside iframes are supported.

## Run
```bash
npm install
npm run build        # outputs to dist/
```
Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> select `dist`.
After rebuilding, press the reload icon on the extension, then reload the job page.
