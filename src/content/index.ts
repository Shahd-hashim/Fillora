import type { Message, PageContext, ScanResponse } from '../types'
import { readCustomOptions } from './dropdown'
import { highlightField, scanFields } from './detector'
import { applyFills, showToast } from './filler'

function pageContext(): PageContext {
  return {
    title: document.title,
    url: location.href,
    text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 2500),
  }
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === 'SCAN_FIELDS') {
    const res: ScanResponse = { fields: scanFields(), page: pageContext() }
    sendResponse(res)
    return false
  }
  if (msg.type === 'HIGHLIGHT_FIELD') {
    sendResponse({ ok: highlightField(msg.id) })
    return false
  }
  if (msg.type === 'READ_OPTIONS') {
    const el = document.querySelector<HTMLElement>(`[data-af-id="${CSS.escape(msg.id)}"]`)
    if (!el) { sendResponse({ options: [] }); return false }
    readCustomOptions(el)
      .then((options) => sendResponse({ options }))
      .catch(() => sendResponse({ options: [] }))
    return true
  }
  if (msg.type === 'FILL_FIELDS') {
    applyFills(msg.fills).then(({ filled, failed }) => {
      const missed = failed.length
      showToast(msg.summary + (missed > 0 ? ` ${missed} could not be applied, so do those yourself.` : ''))
      sendResponse({ filled, failed })
    })
    return true
  }
  return false
})
