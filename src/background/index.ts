import type {
  AutofillResponse, DetectedField, FillInstruction, FillResult, Message, ScanResponse,
} from '../types'
import { getCv, getProfile, getSettings } from '../lib/storage'
import { ruleAnswer } from '../lib/rules'
import { aiAnswers, matchOption, type AiAnswer } from '../lib/answer'

const CONSENT = /(agree|terms|privacy|consent|acknowledg|certify|gdpr|policy|accept)/i
const CV_FIELD = /\b(resume|résumé|cv|curriculum)\b/i
const OTHER_FILE = /(cover|letter|transcript|portfolio|photo|certificate|reference|id card|passport)/i
const MAX_AI_FIELDS = 40

const frameOf = new Map<string, number>() // field id -> frame id (ids are unique across frames)

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === 'AUTOFILL') {
    runAutofill(msg.tabId)
      .then(sendResponse)
      .catch((e) => sendResponse({ results: [], error: e instanceof Error ? e.message : String(e) }))
    return true // keep the channel open for the async answer
  }
  if (msg.type === 'SCAN_ALL') {
    scanAll(msg.tabId)
      .then(sendResponse)
      .catch((e) => sendResponse({ fields: [], page: { title: '', url: '', text: '' }, error: e instanceof Error ? e.message : String(e) }))
    return true
  }
  return false
})

async function frameIds(tabId: number): Promise<number[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId })
    const ids = (frames ?? []).map((f) => f.frameId)
    return ids.length ? ids : [0]
  } catch {
    return [0]
  }
}

/** Scan the top page and every iframe, and merge the fields. */
async function scanAll(tabId: number): Promise<ScanResponse> {
  const ids = await frameIds(tabId)
  const scans = await Promise.all(
    ids.map(async (frameId) => {
      try {
        const msg: Message = { type: 'SCAN_FIELDS' }
        const res: ScanResponse = await chrome.tabs.sendMessage(tabId, msg, { frameId })
        return { frameId, res }
      } catch {
        return null // no content script in this frame
      }
    }),
  )
  const ok = scans.filter((s): s is { frameId: number; res: ScanResponse } => s !== null)
  if (!ok.length) throw new Error("Can't reach this page. Reload the tab and try again.")

  frameOf.clear()
  const fields: DetectedField[] = []
  for (const s of ok) {
    for (const f of s.res.fields) {
      f.frameId = s.frameId
      frameOf.set(f.id, s.frameId)
      fields.push(f)
    }
  }
  const top = ok.find((s) => s.frameId === 0) ?? ok[0]
  return { fields, page: top.res.page }
}

const skip = (f: DetectedField, note: string): FillResult => ({
  id: f.id, label: f.label, answer: '', source: 'skipped', note,
})

/** Turn an answer into something the page can apply. Returns null if it cannot be applied. */
function toFill(
  f: DetectedField, answer: AiAnswer, source: 'profile' | 'ai',
): { fill: FillInstruction; shown: string } | null {
  if (answer === null || answer === '') return null

  if (f.kind === 'checkbox') {
    const checked = answer === true || /^(true|yes)$/i.test(String(answer))
    return { fill: { id: f.id, kind: f.kind, value: '', checked, source }, shown: checked ? 'Checked' : 'Unchecked' }
  }
  if (f.kind === 'select' || f.kind === 'radio') {
    const opt = matchOption(String(answer), f.options ?? [])
    if (!opt) return null
    return {
      fill: {
        id: f.id, kind: f.kind, value: opt.value,
        optionId: f.kind === 'radio' ? opt.id : undefined,
        custom: f.custom, source,
      },
      shown: opt.text || opt.value,
    }
  }
  const text = String(answer)
  return { fill: { id: f.id, kind: f.kind, value: text, source }, shown: text }
}

function summaryFor(fills: FillInstruction[]): string {
  const ai = fills.filter((x) => x.source === 'ai').length
  return (
    `Filled ${fills.length} field${fills.length === 1 ? '' : 's'}` +
    (ai ? `. ${ai} came from the AI (amber outline), so check them.` : '.') +
    ' Review everything before you submit.'
  )
}

async function runAutofill(tabId: number): Promise<AutofillResponse> {
  const [profile, settings, cv] = await Promise.all([getProfile(), getSettings(), getCv()])
  if (!profile.fullName && !profile.email) {
    throw new Error('Your profile is empty. Open Profile and upload your CV first.')
  }

  const scan = await scanAll(tabId)

  const results: FillResult[] = []
  const fills: FillInstruction[] = []
  const needAi: DetectedField[] = []

  const emptyFileFields = scan.fields.filter((x) => x.kind === 'file' && !x.hasValue)
  const soleFile = emptyFileFields.length === 1

  for (const f of scan.fields) {
    if (f.hasValue) continue

    if (f.kind === 'file') {
      const text = `${f.label} ${f.name}`
      const cvLike = CV_FIELD.test(text) || (soleFile && !OTHER_FILE.test(text))
      if (cvLike && cv) {
        fills.push({ id: f.id, kind: 'file', value: '', source: 'profile' })
        results.push({ id: f.id, label: f.label, answer: cv.name, source: 'profile' })
      } else {
        results.push(skip(f, cv ? 'Not a CV field, upload it yourself' : 'No CV stored. Upload one on the Profile page'))
      }
      continue
    }

    if (f.kind === 'date') { results.push(skip(f, 'Fill dates yourself')); continue }

    if (f.custom && !f.options?.length) {
      try {
        const m: Message = { type: 'READ_OPTIONS', id: f.id }
        const res: { options?: DetectedField['options'] } =
          await chrome.tabs.sendMessage(tabId, m, { frameId: f.frameId ?? 0 })
        f.options = res?.options ?? []
      } catch {
        f.options = []
      }
      if (!f.options.length) {
        results.push(skip(f, "Custom dropdown: couldn't read its choices"))
        continue
      }
    }

    if (f.kind === 'checkbox' && /^(check ?box( label)?|label)$/i.test(f.label.trim())) {
      results.push(skip(f, 'Unclear label, left for you')); continue
    }
    if (f.kind === 'checkbox' && CONSENT.test(f.label)) {
      results.push(skip(f, 'Left for you to confirm')); continue
    }

    const rule = ruleAnswer(f, profile)
    if (rule) {
      const r = toFill(f, rule, 'profile')
      if (r) {
        fills.push(r.fill)
        results.push({ id: f.id, label: f.label, answer: r.shown, source: 'profile' })
        continue
      }
    }
    needAi.push(f)
  }

  let aiError: string | undefined
  const batch = needAi.slice(0, MAX_AI_FIELDS)
  for (const f of needAi.slice(MAX_AI_FIELDS)) results.push(skip(f, 'Too many fields for one run'))

  if (batch.length) {
    if (!settings.apiKey) {
      aiError = 'No API key set, so the open questions were skipped.'
      for (const f of batch) results.push(skip(f, 'Needs the AI'))
    } else {
      try {
        const answers = await aiAnswers(settings, profile, scan.page, batch)
        for (const f of batch) {
          const ans = answers[f.id]
          if (ans === null || ans === '') { results.push(skip(f, 'Not enough info in your profile')); continue }
          const r = toFill(f, ans, 'ai')
          if (!r) { results.push(skip(f, "Couldn't match one of the options")); continue }
          fills.push(r.fill)
          results.push({ id: f.id, label: f.label, answer: r.shown, source: 'ai' })
        }
      } catch (e) {
        aiError = e instanceof Error ? e.message : String(e)
        for (const f of batch) results.push(skip(f, 'AI request failed'))
      }
    }
  }

  // Apply the answers frame by frame
  const byFrame = new Map<number, FillInstruction[]>()
  for (const fill of fills) {
    const frameId = frameOf.get(fill.id) ?? 0
    byFrame.set(frameId, [...(byFrame.get(frameId) ?? []), fill])
  }
  for (const [frameId, group] of byFrame) {
    const msg: Message = { type: 'FILL_FIELDS', fills: group, summary: summaryFor(group) }
    let res: { filled: number; failed: string[] } | undefined
    try {
      res = await chrome.tabs.sendMessage(tabId, msg, { frameId })
    } catch {
      res = { filled: 0, failed: group.map((g) => g.id) }
    }
    for (const id of res?.failed ?? []) {
      const r = results.find((x) => x.id === id)
      if (r) {
        r.source = 'skipped'
        r.answer = ''
        r.note = "Couldn't apply it on the page, do it yourself"
      }
    }
  }

  return { results, aiError }
}
