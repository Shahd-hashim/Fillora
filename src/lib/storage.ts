import { emptyProfile, type Profile } from '../types'

export interface WritingStyle {
  tone: 'professional' | 'friendly' | 'confident' | 'enthusiastic' | 'concise'
  length: 'short' | 'medium' | 'long'
  extra: string
}

export const DEFAULT_STYLE: WritingStyle = { tone: 'professional', length: 'medium', extra: '' }

export interface Settings {
  style: WritingStyle
  /** Keep filling the next steps of a multi-step form automatically. */
  autoContinue: boolean
  /** Python backend (FastAPI), usually the ngrok https URL. All AI work happens there. */
  backendUrl: string
  backendSecret: string
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings')
  return {
    style: { ...DEFAULT_STYLE, ...(settings?.style ?? {}) },
    autoContinue: settings?.autoContinue ?? true,
    backendUrl: settings?.backendUrl ?? '',
    backendSecret: settings?.backendSecret ?? '',
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings })
}

export async function getProfile(): Promise<Profile> {
  const { profile } = await chrome.storage.local.get('profile')
  const base = emptyProfile()
  return profile ? { ...base, ...profile, extra: { ...base.extra, ...profile.extra } } : base
}

export async function saveProfile(profile: Profile): Promise<void> {
  await chrome.storage.local.set({ profile })
}

export interface StoredCv {
  name: string
  type: string
  size: number
  data: string // base64
}

export async function getCv(): Promise<StoredCv | null> {
  const { cv } = await chrome.storage.local.get('cv')
  return cv ?? null
}

export async function saveCv(cv: StoredCv): Promise<void> {
  await chrome.storage.local.set({ cv })
}

export async function removeCv(): Promise<void> {
  await chrome.storage.local.remove('cv')
}

export interface SavedAnswer {
  label: string
  answer: string
  updatedAt: number
}

/** Same question written slightly differently should give the same key. */
export const answerKey = (label: string) =>
  label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export async function getSavedAnswers(): Promise<Record<string, SavedAnswer>> {
  const { savedAnswers } = await chrome.storage.local.get('savedAnswers')
  return savedAnswers ?? {}
}

export async function setSavedAnswers(map: Record<string, SavedAnswer>): Promise<void> {
  await chrome.storage.local.set({ savedAnswers: map })
}

export async function saveAnswer(label: string, answer: string): Promise<void> {
  const key = answerKey(label)
  if (!key) return
  const map = await getSavedAnswers()
  map[key] = { label: label.trim(), answer, updatedAt: Date.now() }
  await setSavedAnswers(map)
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
}

/** Package the uploaded CV so the extension can attach it to file fields on job pages later. */
export async function fileToStoredCv(file: File): Promise<StoredCv> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('The file is over 5 MB, so it was not stored for automatic upload.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return {
    name: file.name,
    type: file.type || MIME[ext] || 'application/octet-stream',
    size: file.size,
    data: btoa(bin),
  }
}
