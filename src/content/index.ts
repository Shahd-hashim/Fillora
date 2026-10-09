import type { Message, PageContext, ScanResponse } from '../types'
import { readCustomOptions } from './dropdown'
import { highlightField, readFieldValue, scanFields } from './detector'
import { applyFills, showToast } from './filler'
import { startWatching, stopWatching } from './watch'

function pageContext(): PageContext {
  return {
    title: document.title,
    url: location.href,
    text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 2500),
  }
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  switch (msg.type) {
    case 'SCAN_FIELDS': {
      const res: ScanResponse = { fields: scanFields(), page: pageContext() }
      sendResponse(res)
      return false
    }
    case 'HIGHLIGHT_FIELD':
      sendResponse({ ok: highlightField(msg.id) })
      return false
    case 'READ_VALUE':
      sendResponse({ value: readFieldValue(msg.id) })
      return false
    case 'READ_OPTIONS': {
      const el = document.querySelector<HTMLElement>(`[data-af-id="${CSS.escape(msg.id)}"]`)
      if (!el) { sendResponse({ options: [] }); return false }
      readCustomOptions(el)
        .then((options) => sendResponse({ options }))
        .catch(() => sendResponse({ options: [] }))
      return true
    }
    case 'FILL_FIELDS':
      applyFills(msg.fills).then(({ filled, failed }) => {
        const missed = failed.length
        showToast(msg.summary + (missed > 0 ? ` ${missed} could not be applied, so do those yourself.` : ''))
        sendResponse({ filled, failed })
      })
      return true
    case 'WATCH_START':
      startWatching(msg.handledIds)
      sendResponse({ ok: true })
      return false
    case 'WATCH_STOP':
      stopWatching()
      sendResponse({ ok: true })
      return false
    default:
      return false
  }
})

// After a full page load (next step as a new page), resume watching if this tab is in "keep going" mode.
try {
  const ask: Message = { type: 'IS_WATCHING' }
  chrome.runtime
    .sendMessage(ask)
    .then((r) => { if (r?.watching) startWatching(null) })
    .catch(() => {})
} catch {
  // ignore
}
