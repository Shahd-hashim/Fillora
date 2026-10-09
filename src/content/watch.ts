import type { Message } from '../types'
import { scanFields } from './detector'

/**
 * Multi-step forms: after the first autofill, watch the page. When new empty
 * fields appear (the next step loaded), ask the background to fill them.
 * It never clicks Next or Submit.
 */
let observer: MutationObserver | null = null
let timer: number | undefined
let cooldownUntil = 0
const handled = new Set<string>()

function check() {
  const wait = cooldownUntil - Date.now()
  if (wait > 0) {
    timer = window.setTimeout(check, wait + 100)
    return
  }
  const all = scanFields()
  const fresh = all.filter((f) => !handled.has(f.id) && !f.hasValue)
  all.forEach((f) => handled.add(f.id)) // a field that fails once must not retrigger forever
  if (!fresh.length) return

  cooldownUntil = Date.now() + 4000
  try {
    const msg: Message = { type: 'AUTO_RESCAN' }
    chrome.runtime.sendMessage(msg).catch(() => {})
  } catch {
    // extension was reloaded; this page needs a refresh
  }
}

export function stopWatching() {
  observer?.disconnect()
  observer = null
  window.clearTimeout(timer)
}

/** handledIds = fields already dealt with. null = treat everything on the page as new. */
export function startWatching(handledIds: string[] | null) {
  stopWatching()
  handled.clear()
  handledIds?.forEach((id) => handled.add(id))

  observer = new MutationObserver(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(check, 1200)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  if (handledIds === null) timer = window.setTimeout(check, 1500)
}
