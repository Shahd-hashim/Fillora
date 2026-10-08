import { emptyProfile, type Profile } from './profile'

export interface Settings {
  apiKey: string
  /** OpenRouter model ids in priority order (max 3 are sent). */
  models: string[]
}

export const DEFAULT_MODELS = [
  'openai/gpt-oss-120b:free',
  'qwen/qwen3-235b-a22b:free',
  'openrouter/free',
]

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings')
  return {
    apiKey: settings?.apiKey ?? '',
    models: settings?.models?.length ? settings.models : DEFAULT_MODELS,
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
