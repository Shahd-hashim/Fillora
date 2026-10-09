// The only file that talks to the Python backend. No AI or answer logic lives in the extension.
import type { AutofillReply, DetectedField, PageContext, Profile } from '../types'
import type { SavedAnswer, Settings } from './storage'

export const backendEnabled = (s: Settings) => s.backendUrl.trim() !== ''

async function call(settings: Settings, path: string, init: RequestInit): Promise<any> {
  const res = await fetch(settings.backendUrl.trim().replace(/\/+$/, '') + path, {
    method: 'POST',
    ...init,
    headers: {
      ...init.headers,
      'X-Api-Secret': settings.backendSecret,
      'ngrok-skip-browser-warning': '1', // skips ngrok's HTML warning page
    },
  })
  if (!res.ok) {
    const text = await res.text()
    let detail = text
    try { detail = JSON.parse(text).detail ?? text } catch { /* not JSON */ }
    throw new Error(`Backend error ${res.status}: ${String(detail).slice(0, 300)}`)
  }
  return res.json()
}

/** Ask the backend what to put in each field (rules, saved answers, then the AI). */
export function autofill(
  settings: Settings,
  body: {
    profile: Profile
    page: PageContext
    fields: DetectedField[]
    saved?: Record<string, SavedAnswer>
    aiOnly?: boolean
    avoid?: Record<string, string>
  },
): Promise<AutofillReply> {
  return call(settings, '/autofill', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: body.profile,
      page: body.page,
      fields: body.fields,
      saved_answers: Object.values(body.saved ?? {}).map(({ label, answer }) => ({ label, answer })),
      style: settings.style,
      ai_only: body.aiOnly ?? false,
      avoid: body.avoid ?? {},
    }),
  })
}

/** Upload the CV file. The backend reads it, extracts the profile and stores it for RAG. */
export function parseCv(settings: Settings, file: File): Promise<Partial<Profile>> {
  const form = new FormData()
  form.append('file', file)
  return call(settings, '/parse-cv', { body: form })
}
