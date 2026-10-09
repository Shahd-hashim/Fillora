import type { FillInstruction } from '../types'
import { getCv } from '../lib/storage'
import { getTrigger, pickCustomOption } from './dropdown'

const COLOR = { profile: '#17794a', saved: '#17794a', ai: '#d98a00' }
const TITLE = {
  profile: 'Filled by Job Autofill AI from your profile.',
  saved: 'Filled by Job Autofill AI from an answer you saved.',
  ai: 'Filled by Job Autofill AI from an AI answer. Please review.',
}

function findEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-af-id="${CSS.escape(id)}"]`)
}

/** Set a value the way React/Vue controlled inputs expect. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
}

function fire(el: HTMLElement) {
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

function mark(el: HTMLElement, source: FillInstruction['source']) {
  const isChoice =
    el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox' || el.type === 'file')
  const target = isChoice ? ((el.closest('fieldset, label, div') as HTMLElement) ?? el) : el
  target.style.outline = `2px solid ${COLOR[source]}`
  target.style.outlineOffset = '2px'
  target.title = TITLE[source]
}

function acceptsFile(accept: string, name: string, type: string): boolean {
  const tokens = accept.toLowerCase().split(',').map((t) => t.trim()).filter(Boolean)
  if (!tokens.length) return true
  const ext = '.' + (name.split('.').pop() ?? '').toLowerCase()
  const mime = type.toLowerCase()
  return tokens.some((t) => t === ext || t === mime || (t.endsWith('/*') && mime.startsWith(t.slice(0, -1))))
}

async function attachCv(input: HTMLInputElement): Promise<boolean> {
  const cv = await getCv()
  if (!cv) return false
  if (!acceptsFile(input.accept, cv.name, cv.type)) return false
  const bytes = Uint8Array.from(atob(cv.data), (c) => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], cv.name, { type: cv.type }))
  input.files = dt.files
  fire(input)
  return input.files.length > 0
}

async function fillOne(f: FillInstruction): Promise<boolean> {
  const el = findEl(f.optionId ?? f.id)
  if (!el) return false

  if (f.kind === 'radio') {
    const radio = el as HTMLInputElement
    radio.click()
    if (!radio.checked) { radio.checked = true; fire(radio) }
    mark(findEl(f.id) ?? radio, f.source)
    return true
  }

  if (f.kind === 'checkbox') {
    const box = el as HTMLInputElement
    if (box.checked !== !!f.checked) box.click()
    mark(box, f.source)
    return true
  }

  if (f.kind === 'file') {
    const ok = await attachCv(el as HTMLInputElement)
    if (ok) mark(el, f.source)
    return ok
  }

  if (f.custom) {
    const ok = await pickCustomOption(el, f.value)
    if (ok) mark(getTrigger(el), f.source)
    return ok
  }

  const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  input.focus()
  setNativeValue(input, f.value)
  fire(input)
  mark(input, f.source)
  return true
}

export async function applyFills(fills: FillInstruction[]): Promise<{ filled: number; failed: string[] }> {
  let filled = 0
  const failed: string[] = []
  for (const f of fills) {
    try {
      if (await fillOne(f)) filled++
      else failed.push(f.id)
    } catch {
      failed.push(f.id) // one broken field should not stop the rest
    }
  }
  return { filled, failed }
}

export function showToast(text: string) {
  document.getElementById('af-toast')?.remove()
  const d = document.createElement('div')
  d.id = 'af-toast'
  d.textContent = text
  Object.assign(d.style, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
    maxWidth: '320px', padding: '10px 14px', background: '#16202e', color: '#fff',
    font: '14px/1.4 system-ui, sans-serif', borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)', cursor: 'pointer',
  })
  d.onclick = () => d.remove()
  document.body.appendChild(d)
  setTimeout(() => d.remove(), 10000)
}
