import type {
  AutofillItem, AutofillResponse, DetectedField, FillInstruction, FillResult, Message, PageContext, ScanResponse,
} from '../types'
import { getCv, getProfile, getSavedAnswers, getSettings } from '../lib/storage'
import { autofill, backendEnabled } from '../lib/api'

const CV_FIELD = /\b(resume|résumé|cv|curriculum)\b/i
const OTHER_FILE = /(cover|letter|transcript|portfolio|photo|certificate|reference|id card|passport)/i

const frameOf = new Map<string, number>() // field id -> frame id (ids are unique across frames)
const running = new Set<number>()         // tabs with an autofill in progress

interface LastRun {
  fields: DetectedField[]
  results: FillResult[]
  page: PageContext
  aiError?: string
}

const lastKey = (tabId: number) => `lastRun:${tabId}`
const saveLastRun = (tabId: number, run: LastRun) => chrome.storage.session.set({ [lastKey(tabId)]: run })
async function loadLastRun(tabId: number): Promise<LastRun | null> {
  const o = await chrome.storage.session.get(lastKey(tabId))
  return o[lastKey(tabId)] ?? null
}

async function watchedTabs(): Promise<number[]> {
  const { watchTabs } = await chrome.storage.session.get('watchTabs')
  return watchTabs ?? []
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  switch (msg.type) {
    case 'AUTOFILL':
      guarded(msg.tabId, () => runAutofill(msg.tabId))
        .then(sendResponse)
        .catch((e) => sendResponse({ results: [], error: errText(e) }))
      return true
    case 'SCAN_ALL':
      scanAll(msg.tabId)
        .then(sendResponse)
        .catch((e) => sendResponse({ fields: [], page: { title: '', url: '', text: '' }, error: errText(e) }))
      return true
    case 'REGENERATE':
      regenerate(msg.tabId, msg.id).then(sendResponse).catch((e) => sendResponse({ error: errText(e) }))
      return true
    case 'SET_AUTO_CONTINUE':
      setAutoContinue(msg.tabId, msg.on).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }))
      return true
    case 'IS_WATCHING': {
      const tabId = sender.tab?.id
      if (tabId === undefined) { sendResponse({ watching: false }); return false }
      Promise.all([watchedTabs(), getSettings()])
        .then(([tabs, s]) => sendResponse({ watching: s.autoContinue && tabs.includes(tabId) }))
        .catch(() => sendResponse({ watching: false }))
      return true
    }
    case 'AUTO_RESCAN': {
      const tabId = sender.tab?.id
      if (tabId === undefined) return false
      Promise.all([watchedTabs(), getSettings()]).then(([tabs, s]) => {
        if (!s.autoContinue || !tabs.includes(tabId) || running.has(tabId)) return
        guarded(tabId, () => runAutofill(tabId, { auto: true })).catch(() => {})
      })
      return false
    }
    default:
      return false
  }
})

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabs = await watchedTabs()
  await chrome.storage.session.set({ watchTabs: tabs.filter((t) => t !== tabId) })
  await chrome.storage.session.remove(lastKey(tabId))
})

async function guarded<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  if (running.has(tabId)) throw new Error('Already filling this page. Wait a moment.')
  running.add(tabId)
  try {
    return await fn()
  } finally {
    running.delete(tabId)
  }
}

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

// ---------- multi-step watching ----------

async function startWatch(tabId: number, fields: DetectedField[]) {
  const tabs = await watchedTabs()
  if (!tabs.includes(tabId)) await chrome.storage.session.set({ watchTabs: [...tabs, tabId] })

  const idsByFrame = new Map<number, string[]>()
  for (const f of fields) {
    const fid = f.frameId ?? 0
    idsByFrame.set(fid, [...(idsByFrame.get(fid) ?? []), f.id])
  }
  for (const frameId of await frameIds(tabId)) {
    const msg: Message = { type: 'WATCH_START', handledIds: idsByFrame.get(frameId) ?? [] }
    try { await chrome.tabs.sendMessage(tabId, msg, { frameId }) } catch { /* frame has no script */ }
  }
}

async function stopWatch(tabId: number) {
  const tabs = await watchedTabs()
  await chrome.storage.session.set({ watchTabs: tabs.filter((t) => t !== tabId) })
  for (const frameId of await frameIds(tabId)) {
    const msg: Message = { type: 'WATCH_STOP' }
    try { await chrome.tabs.sendMessage(tabId, msg, { frameId }) } catch { /* ignore */ }
  }
}

async function setAutoContinue(tabId: number, on: boolean) {
  if (on) {
    const scan = await scanAll(tabId)
    await startWatch(tabId, scan.fields)
  } else {
    for (const t of await watchedTabs()) await stopWatch(t)
  }
}

// ---------- answers ----------

const skip = (f: DetectedField, note: string): FillResult => ({
  id: f.id, label: f.label, answer: '', source: 'skipped', note,
})

/** Turn the backend's answer for a field into an instruction the page can apply. */
function toInstruction(f: DetectedField, r: AutofillItem): FillInstruction {
  return {
    id: f.id,
    kind: f.kind,
    value: r.value,
    optionId: r.optionId ?? undefined,
    checked: r.checked ?? undefined,
    custom: f.custom,
    source: r.source as FillInstruction['source'],
  }
}

function summaryFor(fills: FillInstruction[]): string {
  const ai = fills.filter((x) => x.source === 'ai').length
  return (
    `Filled ${fills.length} field${fills.length === 1 ? '' : 's'}` +
    (ai ? `. ${ai} came from the AI (amber outline), so check them.` : '.') +
    ' Review everything before you submit.'
  )
}

async function runAutofill(tabId: number, opts: { auto?: boolean } = {}): Promise<AutofillResponse> {
  const [profile, settings, cv, saved] = await Promise.all([
    getProfile(), getSettings(), getCv(), getSavedAnswers(),
  ])
  if (!profile.fullName && !profile.email) {
    throw new Error('Your profile is empty. Open Profile and upload your CV first.')
  }

  const scan = await scanAll(tabId)

  const results: FillResult[] = []
  const fills: FillInstruction[] = []
  const toSend: DetectedField[] = [] // everything the backend should answer

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

    toSend.push(f)
  }

  let aiError: string | undefined
  if (toSend.length) {
    if (!backendEnabled(settings)) {
      aiError = 'No Backend URL set. Add it on the Profile page.'
      for (const f of toSend) results.push(skip(f, 'Needs the backend'))
    } else {
      try {
        const reply = await autofill(settings, { profile, page: scan.page, fields: toSend, saved })
        if (reply.ai_error) aiError = reply.ai_error
        const byId = new Map(toSend.map((f) => [f.id, f]))
        for (const r of reply.results) {
          const f = byId.get(r.id)
          if (!f) continue
          if (r.source === 'skipped') { results.push(skip(f, r.note)); continue }
          fills.push(toInstruction(f, r))
          results.push({ id: f.id, label: f.label, answer: r.shown, source: r.source })
        }
      } catch (e) {
        aiError = errText(e)
        for (const f of toSend) results.push(skip(f, 'Backend request failed'))
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

  for (const r of results) r.frameId = frameOf.get(r.id)
  await saveLastRun(tabId, { fields: scan.fields, results, page: scan.page, aiError })

  // Keep an eye out for the next step of a multi-step form
  if (!opts.auto && settings.autoContinue) await startWatch(tabId, scan.fields)

  return { results, aiError }
}

/** Write a new answer for one field, replacing what is on the page. */
async function regenerate(tabId: number, id: string): Promise<{ result?: FillResult; error?: string }> {
  const run = await loadLastRun(tabId)
  const field = run?.fields.find((f) => f.id === id)
  if (!run || !field) return { error: 'This field is no longer available. Run Autofill again.' }

  const [profile, settings] = await Promise.all([getProfile(), getSettings()])
  if (!backendEnabled(settings)) return { error: 'Set the Backend URL on the Profile page first.' }

  const prev = run.results.find((r) => r.id === id)
  const reply = await autofill(settings, {
    profile, page: run.page, fields: [field], aiOnly: true, avoid: { [id]: prev?.answer ?? '' },
  })
  const item = reply.results[0]
  if (!item || item.source === 'skipped') {
    return { error: item?.note || reply.ai_error || 'The AI had no answer for this field.' }
  }
  const r = { fill: toInstruction(field, item), shown: item.shown }

  const frameId = field.frameId ?? 0
  const msg: Message = { type: 'FILL_FIELDS', fills: [r.fill], summary: 'Wrote a new answer. Please review it.' }
  let res: { filled: number; failed: string[] } | undefined
  try {
    res = await chrome.tabs.sendMessage(tabId, msg, { frameId })
  } catch {
    return { error: "Can't reach the page. Reload it and run Autofill again." }
  }
  if (res?.failed?.length) return { error: "Couldn't apply the new answer on the page." }

  const result: FillResult = { id, label: field.label, answer: r.shown, source: 'ai', frameId }
  await saveLastRun(tabId, { ...run, results: run.results.map((x) => (x.id === id ? result : x)) })
  return { result }
}
