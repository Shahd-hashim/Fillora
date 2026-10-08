import type { FieldOption } from '../types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const PLACEHOLDER = /^(select|choose|please select|--|-)/i

function visible(el: HTMLElement): boolean {
  const s = getComputedStyle(el)
  if (s.display === 'none' || s.visibility === 'hidden') return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** The element a person would click to open the dropdown. */
export function getTrigger(el: HTMLElement): HTMLElement {
  return (el.closest('[role="combobox"], [aria-haspopup="listbox"]') as HTMLElement) ?? el
}

/** True for dropdowns built from divs/inputs instead of a real <select>. */
export function isCustomDropdown(el: HTMLElement): boolean {
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return false
  if (el instanceof HTMLInputElement && !['text', 'search', ''].includes(el.type)) return false

  const popup = el.getAttribute('aria-haspopup')
  if (el.getAttribute('role') === 'combobox' || popup === 'listbox' || popup === 'true' || popup === 'menu') {
    return true
  }
  if (el.closest('[role="combobox"], [aria-haspopup="listbox"]')) return true
  if (
    el instanceof HTMLInputElement &&
    el.readOnly &&
    el.closest('[aria-haspopup], [aria-expanded], [class*="select" i], [class*="dropdown" i]')
  ) {
    return true
  }
  return false
}

export function customHasValue(el: HTMLElement): boolean {
  const t = getTrigger(el)
  const input = el instanceof HTMLInputElement ? el : t.querySelector('input')
  const txt = clean(input?.value || t.textContent)
  return txt !== '' && !PLACEHOLDER.test(txt)
}

function clickLike(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const base = {
    bubbles: true, cancelable: true, view: window, button: 0,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
  }
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ev = type.startsWith('pointer') ? PointerEvent : MouseEvent
    el.dispatchEvent(new Ev(type, { ...base, buttons: type === 'pointerdown' || type === 'mousedown' ? 1 : 0 }))
  }
}

const KEYCODES: Record<string, number> = { ArrowDown: 40, Enter: 13, Escape: 27 }

function key(el: HTMLElement, k: string) {
  for (const type of ['keydown', 'keyup']) {
    el.dispatchEvent(
      new KeyboardEvent(type, {
        key: k, code: k, keyCode: KEYCODES[k], which: KEYCODES[k], bubbles: true, cancelable: true,
      }),
    )
  }
}

/** Innermost child that holds the same text: many widgets only listen on that element. */
function deepest(el: HTMLElement): HTMLElement {
  let t = el
  while (t.firstElementChild && clean(t.firstElementChild.textContent) === clean(t.textContent)) {
    t = t.firstElementChild as HTMLElement
  }
  return t
}

/** Does the dropdown now show the wanted choice? */
function looksSelected(el: HTMLElement, wanted: string): boolean {
  const t = getTrigger(el)
  const input = el instanceof HTMLInputElement ? el : t.querySelector('input')
  const shown = norm(clean(input?.value || t.textContent))
  const w = norm(wanted)
  return shown !== '' && !PLACEHOLDER.test(shown) && (shown.includes(w) || w.includes(shown))
}

function findOptions(trigger: HTMLElement): HTMLElement[] {
  const inner = trigger.querySelector('input') ?? trigger
  const ids = [trigger, inner]
    .flatMap((e) => [e.getAttribute('aria-controls'), e.getAttribute('aria-owns')])
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)

  const usable = (nodes: Iterable<HTMLElement>) =>
    Array.from(nodes).filter((o) => visible(o) && clean(o.textContent) !== '')

  for (const id of ids) {
    const box = document.getElementById(id)
    if (box) {
      const found = usable(box.querySelectorAll<HTMLElement>('[role="option"], li, [data-value]'))
      if (found.length) return found
    }
  }

  const roleOpts = usable(document.querySelectorAll<HTMLElement>('[role="option"]'))
  if (roleOpts.length) return roleOpts

  for (const box of document.querySelectorAll<HTMLElement>(
    '[role="listbox"], [role="menu"], ul[class*="menu" i], ul[class*="dropdown" i], ul[class*="option" i]',
  )) {
    if (!visible(box)) continue
    const found = usable(box.querySelectorAll<HTMLElement>('[role="menuitem"], li, [data-value], div'))
    if (found.length) return found
  }
  return []
}

async function open(trigger: HTMLElement): Promise<HTMLElement[]> {
  trigger.focus?.()
  clickLike(trigger)
  await sleep(300)
  let opts = findOptions(trigger)
  if (!opts.length) {
    key((trigger.querySelector('input') as HTMLElement) ?? trigger, 'ArrowDown')
    await sleep(300)
    opts = findOptions(trigger)
  }
  return opts
}

async function close(trigger: HTMLElement) {
  key((trigger.querySelector('input') as HTMLElement) ?? trigger, 'Escape')
  await sleep(150)
  if (trigger.getAttribute('aria-expanded') === 'true') {
    clickLike(trigger)
    await sleep(150)
  }
}

/** Open the dropdown, read its choices, close it again. */
export async function readCustomOptions(el: HTMLElement): Promise<FieldOption[]> {
  const trigger = getTrigger(el)
  const opts = await open(trigger)
  const seen = new Set<string>()
  const out: FieldOption[] = []
  for (const o of opts) {
    const text = clean(o.textContent)
    if (!text || text.length > 120 || PLACEHOLDER.test(text) || seen.has(text)) continue
    seen.add(text)
    out.push({ id: '', value: text, text })
  }
  await close(trigger)
  return out
}

function matchIn(list: HTMLElement[], wanted: string): HTMLElement | undefined {
  const w = norm(wanted)
  return (
    list.find((o) => norm(clean(o.textContent)) === w) ??
    list.find((o) => {
      const t = norm(clean(o.textContent))
      return t.length >= 2 && (t.includes(w) || w.includes(t))
    })
  )
}

async function settle(trigger: HTMLElement) {
  if (trigger.getAttribute('aria-expanded') === 'true') await close(trigger)
}

/** Open the dropdown and choose the entry whose text matches. True only if the box really changed. */
export async function pickCustomOption(el: HTMLElement, wanted: string): Promise<boolean> {
  const trigger = getTrigger(el)
  const opts = await open(trigger)
  const target = matchIn(opts, wanted)
  console.debug('[Job Autofill] dropdown', {
    wanted,
    options: opts.map((o) => clean(o.textContent)),
    clicking: target ? target.outerHTML.slice(0, 200) : null,
  })
  if (!target) {
    await close(trigger)
    return false
  }

  // Attempt 1: click the innermost element of the option
  clickLike(deepest(target))
  await sleep(350)
  if (looksSelected(el, wanted)) {
    await settle(trigger)
    return true
  }

  // Attempt 2: keyboard (arrow down to the option, then Enter)
  let current = findOptions(trigger)
  if (!current.length) current = await open(trigger)
  const idx = current.findIndex((o) => o === matchIn(current, wanted))
  if (idx >= 0) {
    const input = (trigger.querySelector('input') as HTMLElement) ?? trigger
    input.focus?.()
    for (let i = 0; i <= idx; i++) {
      key(input, 'ArrowDown')
      await sleep(80)
    }
    key(input, 'Enter')
    await sleep(350)
    if (looksSelected(el, wanted)) {
      await settle(trigger)
      return true
    }
  }

  await close(trigger)
  return false
}
