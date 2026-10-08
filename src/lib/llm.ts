import { emptyProfile, type Profile } from './profile'
import { DEFAULT_MODELS, type Settings } from './storage'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export async function chatText(settings: Settings, prompt: string): Promise<string> {
  if (!settings.apiKey) throw new Error('Add your OpenRouter API key first.')
  const models = (settings.models.length ? settings.models : DEFAULT_MODELS).slice(0, 3)

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Job Autofill AI',
    },
    body: JSON.stringify({
      models, // OpenRouter tries these in order if one is rate limited or down
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const text: string | undefined = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('The model returned an empty answer. Try again or change the models.')
  return text
}

export function extractJson(text: string): any {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not return JSON. Try again.')
  return JSON.parse(text.slice(start, end + 1))
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
const list = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const joined = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).join(', ') : str(v))

const SCHEMA = `{
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
}`

export async function parseCvWithLLM(settings: Settings, cvText: string): Promise<Profile> {
  const prompt = `You extract structured data from a CV.
Return ONLY one JSON object that follows this shape, with no explanation and no markdown:
${SCHEMA}

Rules:
- Use only information present in the CV. Use "" or [] when something is missing. Never invent values.
- Dates as written in the CV (for example "Jan 2022" or "Present").
- Keep experience in the order given in the CV.

CV TEXT:
"""
${cvText.slice(0, 12000)}
"""`

  const raw = extractJson(await chatText(settings, prompt))
  const p = emptyProfile()
  return {
    ...p,
    fullName: str(raw.fullName),
    email: str(raw.email),
    phone: str(raw.phone),
    location: str(raw.location),
    linkedin: str(raw.linkedin),
    github: str(raw.github),
    website: str(raw.website),
    summary: str(raw.summary),
    skills: joined(raw.skills),
    languages: joined(raw.languages),
    education: list(raw.education).map((e) => ({
      school: str(e?.school), degree: str(e?.degree), field: str(e?.field),
      start: str(e?.start), end: str(e?.end),
    })),
    experience: list(raw.experience).map((e) => ({
      company: str(e?.company), title: str(e?.title),
      start: str(e?.start), end: str(e?.end), description: str(e?.description),
    })),
    rawCvText: cvText,
  }
}
