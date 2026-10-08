import { useCallback, useEffect, useState } from 'react'
import type {
  AutofillResponse, DetectedField, FillResult, Message, ScanResponse,
} from '../types'

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
  ai: 'AI',
  skipped: 'Skipped',
}

export default function App() {
  const [scan, setScan] = useState<Scan>({ status: 'loading' })
  const [run, setRun] = useState<Run>({ status: 'idle' })

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

  const autofill = async () => {
    setRun({ status: 'running' })
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

  const highlight = async (f: DetectedField) => {
    const tabId = await activeTabId()
    const msg: Message = { type: 'HIGHLIGHT_FIELD', id: f.id }
    chrome.tabs.sendMessage(tabId, msg, { frameId: f.frameId ?? 0 })
  }

  const running = run.status === 'running'

  return (
    <main className="popup">
      <header className="top">
        <h1>Job Autofill AI</h1>
        <button className="btn" onClick={() => chrome.runtime.openOptionsPage()}>Profile</button>
      </header>

      <button className="btn primary wide" onClick={autofill} disabled={running}>
        {running ? 'Filling… this can take a minute' : 'Autofill this page'}
      </button>
      <p className="note small">
        Green outline: filled from your profile. Amber outline: written by the AI, so check it.
        Nothing is submitted for you.
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
                </div>
              </li>
            ))}
          </ul>
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
