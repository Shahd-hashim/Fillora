# Fillora
Fillora is an AI-powered browser extension that understands job application forms and intelligently completes them using information from a user's CV and personal profile. It can identify what each field is asking, retrieve the most relevant information, and generate personalized responses for complex questions based on the user's experience.


1. Detect form fields on the page.
2. Profile page: upload a CV, parsed via OpenRouter.
3. Autofill: obvious fields come from your profile, the rest are answered by the AI. Your stored CV is attached to resume fields, and forms inside iframes are supported.

## Run
```bash
npm install
npm run build        # outputs to dist/
```
