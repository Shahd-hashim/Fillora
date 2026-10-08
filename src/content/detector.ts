import type { DetectedField, FieldKind, FieldOption } from '../types'
import { customHasValue, getTrigger, isCustomDropdown } from './dropdown'

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password'])
const CONTROLS = 'input, select, textarea'
let counter = 0
const FRAME_TOKEN = Math.random().toString(36).slice(2, 6)

const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

function isVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function ensureId(el: HTMLElement): string {
  if (!el.dataset.afId) el.dataset.afId = `af-${FRAME_TOKEN}-${++counter}`
  return el.dataset.afId
}

/** Label that is directly tied to the control (aria, for=, or wrapping label). */
function ownLabel(el: HTMLElement): string {
  const aria = clean(el.getAttribute('aria-label'))
  if (aria && !/^(select|choose|please select)\b/i.test(aria)) return aria

  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => clean(document.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(' ')
    if (t) return t
  }

  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    const t = clean(l?.textContent)
    if (t) return t
  }

  const wrap = el.closest('label')
  if (wrap) {
    // Remove text contributed by nested controls (e.g. select options)
    const copy = wrap.cloneNode(true) as HTMLElement
    copy.querySelectorAll(CONTROLS).forEach((n) => n.remove())
    const t = clean(copy.textContent)
    if (t) return t
  }
  return ''
}

/** Label found by walking up the DOM: legend, label, or label-like element. */
function contextLabel(el: HTMLElement): string {
  let node: HTMLElement | null = el.parentElement
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const legend = node.tagName === 'FIELDSET' ? node.querySelector('legend') : null
    if (legend) {
      const t = clean(legend.textContent)
      if (t) return t
    }
    const candidates = node.querySelectorAll<HTMLElement>(
      'label, legend, [class*="label" i], [class*="question" i], [class*="title" i]',
    )
    for (const c of candidates) {
      if (c.contains(el) || c.querySelector(CONTROLS)) continue
      const t = clean(c.textContent)
      if (t && t.length < 300) return t
    }
  }
  return ''
}

function kindOf(el: HTMLElement): FieldKind | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea'
  if (el instanceof HTMLSelectElement) return 'select'
  if (el instanceof HTMLInputElement) {
    const t = el.type || 'text'
    if (SKIP_TYPES.has(t)) return null
    switch (t) {
      case 'email': case 'tel': case 'url': case 'number':
      case 'date': case 'radio': case 'checkbox': case 'file':
        return t
      default:
        return 'text'
    }
  }
  return null
}

function isRequired(el: HTMLElement): boolean {
  return (
    (el as HTMLInputElement).required ||
    el.getAttribute('aria-required') === 'true'
  )
}

function currentlyFilled(el: HTMLElement, kind: FieldKind): boolean {
  if (kind === 'checkbox') return (el as HTMLInputElement).checked
  if (kind === 'file') return ((el as HTMLInputElement).files?.length ?? 0) > 0
  if (el instanceof HTMLSelectElement) return el.selectedIndex > 0 && el.value !== ''
  return (el as HTMLInputElement).value.trim() !== ''
}

export function scanFields(root: Document = document): DetectedField[] {
  const fields: DetectedField[] = []
  const seenRadioGroups = new Set<string>()

  const selector = `${CONTROLS}, [role="combobox"], [aria-haspopup="listbox"]`
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const custom = isCustomDropdown(el)
    // A wrapper that contains the real input is handled through that input.
    if (custom && !(el instanceof HTMLInputElement) && el.querySelector(CONTROLS)) return
    const kind: FieldKind | null = custom ? 'select' : kindOf(el)
    if (!kind) return
    if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') return

    // Radios/checkboxes/files are often visually hidden by custom styling.
    const exempt = kind === 'radio' || kind === 'checkbox' || kind === 'file'
    if (!exempt && !isVisible(custom ? getTrigger(el) : el)) return

    const input = el as HTMLInputElement
    const placeholder = clean(input.placeholder)
    const name = input.name || input.id || ''

    if (kind === 'radio') {
      const groupKey = `${input.form?.id ?? ''}|${input.name}`
      if (input.name && seenRadioGroups.has(groupKey)) return
      seenRadioGroups.add(groupKey)

      const radios = input.name
        ? Array.from(
            (input.form ?? document).querySelectorAll<HTMLInputElement>(
              `input[type="radio"][name="${CSS.escape(input.name)}"]`,
            ),
          )
        : [input]
      const options: FieldOption[] = radios.map((r) => ({
        id: ensureId(r),
        value: r.value,
        text: ownLabel(r) || r.value,
      }))
      fields.push({
        id: ensureId(input),
        kind,
        label: contextLabel(input) || name,
        name,
        placeholder: '',
        required: radios.some(isRequired),
        autocomplete: '',
        hasValue: radios.some((r) => r.checked),
        options,
      })
      return
    }

    let options: FieldOption[] | undefined
    if (el instanceof HTMLSelectElement) {
      options = Array.from(el.options).map((o) => ({
        id: '',
        value: o.value,
        text: clean(o.textContent),
      }))
    }

    const label =
      ownLabel(el) || contextLabel(el) || placeholder || name || '(unlabeled field)'

    if (custom && !(el instanceof HTMLInputElement) && label === '(unlabeled field)') return

    fields.push({
      id: ensureId(el),
      kind,
      label,
      name,
      placeholder,
      required: isRequired(el),
      autocomplete: input.getAttribute('autocomplete') ?? '',
      hasValue: custom ? customHasValue(el) : currentlyFilled(el, kind),
      custom: custom || undefined,
      options,
    })
  })

  return fields
}

export function highlightField(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-af-id="${CSS.escape(id)}"]`)
  if (!el) return false
  const target =
    el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox' || el.type === 'file')
      ? (el.closest('label, fieldset, div') as HTMLElement) ?? el
      : el

  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const prevOutline = target.style.outline
  const prevOffset = target.style.outlineOffset
  target.style.outline = '3px solid #2f6fed'
  target.style.outlineOffset = '2px'
  setTimeout(() => {
    target.style.outline = prevOutline
    target.style.outlineOffset = prevOffset
  }, 1800)
  return true
}
