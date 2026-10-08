import type { DetectedField } from '../types'
import type { Profile } from './profile'

const TEXT_KINDS = new Set(['text', 'email', 'tel', 'url', 'number'])
const norm = (s: string) =>
  s.toLowerCase().replace(/[*:_\-]+/g, ' ').replace(/\s+/g, ' ').trim()

export function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

/**
 * Fast, free answers for obvious text fields. Returns null when the field
 * is not an obvious match or the profile has no value for it (the AI handles those).
 */
export function ruleAnswer(f: DetectedField, p: Profile): string | null {
  if (!TEXT_KINDS.has(f.kind)) return null

  const label = norm(f.label)
  const name = norm(f.name)
  const ac = f.autocomplete.toLowerCase()
  const hay = `${label} ${name} ${norm(f.placeholder)}`
  const { first, last } = splitName(p.fullName)
  const pick = (v: string) => (v.trim() ? v.trim() : null)

  if (ac.includes('given-name')) return pick(first)
  if (ac.includes('family-name')) return pick(last)
  if (ac === 'name') return pick(p.fullName)
  if (ac === 'email') return pick(p.email)
  if (ac.startsWith('tel')) return pick(p.phone)

  if (f.kind === 'email' || /e ?mail/.test(hay)) return pick(p.email)
  if (f.kind === 'tel' || /\b(phone|mobile|cell|telephone)\b/.test(hay)) return pick(p.phone)
  if (/linkedin/.test(hay)) return pick(p.linkedin)
  if (/github/.test(hay)) return pick(p.github)

  if (/(first|given|fore) ?name/.test(hay)) return pick(first)
  if (/(last|family|sur) ?name/.test(hay)) return pick(last)
  if (/^((your|legal|full|candidate) )*name$/.test(label) || ['name', 'fullname', 'full name'].includes(name)) {
    return pick(p.fullName)
  }

  if (/\b(website|portfolio|personal site|personal url|blog)\b/.test(hay)) return pick(p.website)
  if (/\b(salary|compensation|expected pay|pay expectation)\b/.test(hay)) return pick(p.extra.salaryExpectation)
  if (/(notice period|earliest start|start date|when can you start|availability)/.test(hay)) return pick(p.extra.noticePeriod)
  if (/\b(city|location|based|where do you live|residence)\b/.test(hay)) return pick(p.location)

  return null
}
