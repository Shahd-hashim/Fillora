import type { DetectedField, FieldOption, PageContext } from '../types'
import type { Profile } from './profile'
import type { Settings } from './storage'
import { chatText, extractJson } from './llm'

export type AiAnswer = string | boolean | null

const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Find the option that best matches an answer written by the model. */
export function matchOption(answer: string, options: FieldOption[]): FieldOption | null {
  const a = n(answer)
  if (!a) return null
  const opts = options.filter((o) => o.value !== '' && (o.text.trim() || o.value.trim()))

  const exact = opts.find((o) => n(o.text) === a || n(o.value) === a)
  if (exact) return exact

  const loose = opts.find((o) => {
    const t = n(o.text)
    return t.length >= 3 && (t.includes(a) || a.includes(t))
  })
  if (loose) return loose

  if (/^yes\b/.test(a)) return opts.find((o) => /^yes\b/.test(n(o.text))) ?? null
  if (/^no\b/.test(a)) return opts.find((o) => /^no\b/.test(n(o.text))) ?? null
  return null
}

export async function aiAnswers(
  settings: Settings,
  profile: Profile,
  page: PageContext,
  fields: DetectedField[],
): Promise<Record<string, AiAnswer>> {
  const { rawCvText, ...structured } = profile

  const fieldList = fields.map((f) => ({
    id: f.id,
    question: f.label,
    type: f.kind,
    required: f.required,
    options: f.options
      ?.filter((o) => o.value !== '' && o.text.trim())
      .slice(0, 250)
      .map((o) => o.text),
  }))

  const prompt = `You fill in a job application form for a candidate. Use ONLY the candidate data below.

CANDIDATE PROFILE (JSON):
${JSON.stringify(structured)}

CANDIDATE CV TEXT:
"""
${rawCvText.slice(0, 6000)}
"""

JOB PAGE (title and start of the visible text):
Title: ${page.title}
URL: ${page.url}
"""
${page.text}
"""

FORM FIELDS (JSON):
${JSON.stringify(fieldList)}

Return ONLY one JSON object, with no explanation and no markdown: {"answers": {"<field id>": <answer>, ...}}

Rules:
- Include every field id. Use null when the candidate data does not contain the answer.
- Never guess salary, dates, ID numbers or other personal facts. Never invent employers, degrees, skills or years of experience.
- text, email, tel, url, number: a short value only, no explanation.
- textarea: 2 to 5 sentences, first person, professional tone. Mention the role or company from the job page when it is clear. Use only the candidate's real experience.
- select and radio: answer with exactly one of the listed options, copied word for word.
- checkbox: true or false.
- Gender, ethnicity, disability and veteran questions: choose the option meaning "prefer not to say" or "decline to answer" if one exists, otherwise null.
- Years of experience: work it out from the experience dates if possible (today is ${new Date().toDateString()}), otherwise null.`

  const raw = extractJson(await chatText(settings, prompt))
  const answers = raw?.answers && typeof raw.answers === 'object' ? raw.answers : raw
  const out: Record<string, AiAnswer> = {}
  for (const f of fields) {
    const v = answers?.[f.id]
    out[f.id] = typeof v === 'string' || typeof v === 'boolean' ? v : v == null ? null : String(v)
  }
  return out
}
