import { useCallback, useEffect, useState } from 'react'
import type {
  AutofillResponse, DetectedField, FillResult, Message, ScanResponse,
} from '../types'
import { getSettings, saveAnswer, saveSettings } from '../lib/storage'

type Scan =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; fields: DetectedField[] }

type Run =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; results: FillResult[]; aiError?: string }
  | { status: 'error'; message: string }

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab found.')
  return tab.id
}

const BADGE: Record<FillResult['source'], string> = {
  profile: 'Profile',
  saved: 'Saved',
  ai: 'AI',
  skipped: 'Skipped',
}

export default function App() {
  const [scan, setScan] = useState<Scan>({ status: 'loading' })
  const [run, setRun] = useState<Run>({ status: 'idle' })
  const [auto, setAuto] = useState(true)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [footer, setFooter] = useState('')

  const note = (id: string, text: string) => setNotes((n) => ({ ...n, [id]: text }))

  const rescan = useCallback(async () => {
    setScan({ status: 'loading' })
    try {
      const tabId = await activeTabId()
      const msg: Message = { type: 'SCAN_ALL', tabId }
      const res: ScanResponse = await chrome.runtime.sendMessage(msg)
      if (res.error) throw new Error(res.error)
      setScan({ status: 'ready', fields: res.fields })
    } catch {
      setScan({
        status: 'error',
        message:
          "Can't reach this page. Reload the tab, or open a normal web page (extensions can't run on chrome:// pages or the Web Store).",
      })
    }
  }, [])

  useEffect(() => {
    rescan()
  }, [rescan])

  // Settings and the results of the last run on this tab
  useEffect(() => {
    ;(async () => {
      setAuto((await getSettings()).autoContinue)
      try {
        const tabId = await activeTabId()
        const key = `lastRun:${tabId}`
        const o = await chrome.storage.session.get(key)
        if (o[key]) setRun({ status: 'done', results: o[key].results, aiError: o[key].aiError })
      } catch {
        // no earlier run
      }
    })()
  }, [])

  const autofill = async () => {
    setRun({ status: 'running' })
    setNotes({})
    setFooter('')
    try {
      const tabId = await activeTabId()
      const msg: Message = { type: 'AUTOFILL', tabId }
      const res: AutofillResponse = await chrome.runtime.sendMessage(msg)
      if (res.error) setRun({ status: 'error', message: res.error })
      else setRun({ status: 'done', results: res.results, aiError: res.aiError })
    } catch (e) {
      setRun({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const toggleAuto = async (on: boolean) => {
    setAuto(on)
    const s = await getSettings()
    await saveSettings({ ...s, autoContinue: on })
    try {
      const tabId = await activeTabId()
      const msg: Message = { type: 'SET_AUTO_CONTINUE', tabId, on }
      await chrome.runtime.sendMessage(msg)
    } catch {
      // not on a normal page
    }
  }

  const highlight = async (f: DetectedField) => {
    const tabId = await activeTabId()
    const msg: Message = { type: 'HIGHLIGHT_FIELD', id: f.id }
    chrome.tabs.sendMessage(tabId, msg, { frameId: f.frameId ?? 0 })
  }

  const readValue = async (r: FillResult): Promise<string | null> => {
    const tabId = await activeTabId()
    const msg: Message = { type: 'READ_VALUE', id: r.id }
    const res = await chrome.tabs.sendMessage(tabId, msg, { frameId: r.frameId ?? 0 })
    return (res?.value ?? null) as string | null
  }

  const redo = async (r: FillResult) => {
    note(r.id, 'Writing a new answer…')
    try {
      const tabId = await activeTabId()
      const msg: Message = { type: 'REGENERATE', tabId, id: r.id }
      const res: { result?: FillResult; error?: string } = await chrome.runtime.sendMessage(msg)
      if (res.error || !res.result) { note(r.id, res.error ?? 'Could not write a new answer.'); return }
      const next = res.result
      setRun((cur) =>
        cur.status === 'done' ? { ...cur, results: cur.results.map((x) => (x.id === r.id ? next : x)) } : cur,
      )
      note(r.id, 'New answer applied. Check it on the page.')
    } catch (e) {
      note(r.id, e instanceof Error ? e.message : String(e))
    }
  }

  const save = async (r: FillResult) => {
    try {
      const v = await readValue(r)
      if (!v) { note(r.id, 'Nothing to save: the field is empty or gone.'); return }
      await saveAnswer(r.label, v)
      note(r.id, 'Saved for next time.')
    } catch {
      note(r.id, "Couldn't read the field on the page.")
    }
  }

  const saveAll = async () => {
    if (run.status !== 'done') return
    let n = 0
    for (const r of run.results) {
      if (r.source !== 'ai' && r.source !== 'saved') continue
      try {
        const v = await readValue(r)
        if (v) { await saveAnswer(r.label, v); n++ }
      } catch {
        // skip fields that are gone
      }
    }
    setFooter(`Saved ${n} answer${n === 1 ? '' : 's'}.`)
  }

  const running = run.status === 'running'
  const hasAnswers = run.status === 'done' && run.results.some((r) => r.source === 'ai' || r.source === 'saved')

  return (
    <main className="popup">
      <header className="top">
        <h1>Job Autofill AI</h1>
        <button className="btn" onClick={() => chrome.runtime.openOptionsPage()}>Profile</button>
      </header>

      <button className="btn primary wide" onClick={autofill} disabled={running}>
        {running ? 'Filling… this can take a minute' : 'Autofill this page'}
      </button>

      <label className="toggle">
        <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
        <span>Fill the next steps automatically when they appear</span>
      </label>
      <p className="note small">
        Green outline: from your profile or a saved answer. Amber outline: written by the AI, so check it.
        Nothing is ever submitted or clicked for you.
      </p>

      {run.status === 'error' && <p className="note error">{run.message}</p>}

      {run.status === 'done' && (
        <>
          {run.aiError && <p className="note error">AI problem: {run.aiError}</p>}
          <p className="count">
            Filled {run.results.filter((r) => r.source !== 'skipped').length}, skipped{' '}
            {run.results.filter((r) => r.source === 'skipped').length}.
          </p>
          <ul className="fields results">
            {run.results.map((r) => (
              <li key={r.id}>
                <div className="result">
                  <div className="r-top">
                    <span className="label">{r.label}</span>
                    <span className={`badge ${r.source}`}>{BADGE[r.source]}</span>
                  </div>
                  <span className="answer">{r.source === 'skipped' ? r.note : r.answer}</span>
                  {(r.source === 'ai' || r.source === 'saved') && (
                    <div className="row-actions">
                      <button className="mini" onClick={() => redo(r)}>Redo</button>
                      <button className="mini" onClick={() => save(r)}>Save</button>
                      {notes[r.id] && <span className="row-note">{notes[r.id]}</span>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {hasAnswers && (
            <>
              <button className="btn small-btn" onClick={saveAll}>Save all reviewed answers</button>
              {footer && <span className="row-note"> {footer}</span>}
              <p className="note small">
                Saved answers are reused on future applications. Do not save answers that name one specific company.
              </p>
            </>
          )}
        </>
      )}

      <details className="detected">
        <summary>
          Detected fields{scan.status === 'ready' ? ` (${scan.fields.length})` : ''}
        </summary>
        <button className="btn small-btn" onClick={rescan}>Rescan page</button>
        {scan.status === 'loading' && <p className="note">Scanning the page…</p>}
        {scan.status === 'error' && <p className="note error">{scan.message}</p>}
        {scan.status === 'ready' && scan.fields.length === 0 && (
          <p className="note">No form fields found. Open the application form, then rescan.</p>
        )}
        {scan.status === 'ready' && scan.fields.length > 0 && (
          <ul className="fields">
            {scan.fields.map((f) => (
              <li key={f.id}>
                <button className="field" onClick={() => highlight(f)}>
                  <span className="label">
                    {f.label}
                    {f.required && <b className="req" title="Required"> *</b>}
                  </span>
                  <span className="meta">
                    {f.custom ? 'dropdown' : f.kind}
                    {f.options ? `, ${f.options.length} options` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </main>
  )
}
