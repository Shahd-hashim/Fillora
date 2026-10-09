export type FieldKind =
  | 'text' | 'email' | 'tel' | 'url' | 'number' | 'date'
  | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file'

export interface FieldOption {
  id: string
  value: string
  text: string
}

export interface DetectedField {
  id: string            // unique across frames, stored on the element as data-af-id
  kind: FieldKind
  label: string         // best human-readable question for this field
  name: string
  placeholder: string
  autocomplete: string
  required: boolean
  hasValue: boolean     // already filled in by the page or the user
  options?: FieldOption[]  // select / radio group
  custom?: boolean      // dropdown built from divs/inputs, not a real <select>
  maxLength?: number    // character limit set by the page
  frameId?: number      // which frame of the tab this field lives in
}

export interface PageContext {
  title: string
  url: string
  text: string
}

export interface FillInstruction {
  id: string
  kind: FieldKind
  value: string          // text to type, or option value for select
  optionId?: string      // radio: id of the option to click
  checked?: boolean      // checkbox
  custom?: boolean       // custom dropdown: click the option whose text equals value
  source: 'profile' | 'saved' | 'ai'
}

export type FillSource = 'profile' | 'saved' | 'ai' | 'skipped'

export interface FillResult {
  id: string
  label: string
  answer: string
  source: FillSource
  note?: string
  frameId?: number
}

export type Message =
  // popup -> background
  | { type: 'AUTOFILL'; tabId: number }
  | { type: 'SCAN_ALL'; tabId: number }
  | { type: 'REGENERATE'; tabId: number; id: string }
  | { type: 'SET_AUTO_CONTINUE'; tabId: number; on: boolean }
  // content -> background
  | { type: 'AUTO_RESCAN' }
  | { type: 'IS_WATCHING' }
  // background -> content
  | { type: 'SCAN_FIELDS' }
  | { type: 'HIGHLIGHT_FIELD'; id: string }
  | { type: 'READ_OPTIONS'; id: string }
  | { type: 'READ_VALUE'; id: string }
  | { type: 'FILL_FIELDS'; fills: FillInstruction[]; summary: string }
  | { type: 'WATCH_START'; handledIds: string[] | null }
  | { type: 'WATCH_STOP' }

export interface ScanResponse {
  fields: DetectedField[]
  page: PageContext
  error?: string
}

export interface AutofillResponse {
  results: FillResult[]
  aiError?: string
  error?: string
}

// ---------- the profile saved in the browser ----------

export interface Education {
  school: string
  degree: string
  field: string
  start: string
  end: string
}

export interface Experience {
  company: string
  title: string
  start: string
  end: string
  description: string
}

export interface ExtraInfo {
  salaryExpectation: string
  noticePeriod: string
  workAuthorization: string
  willingToRelocate: string
  notes: string // anything else the AI should know when answering
}

export interface Profile {
  fullName: string
  email: string
  phone: string
  location: string
  linkedin: string
  github: string
  website: string
  summary: string
  skills: string      // comma separated
  languages: string   // comma separated
  education: Education[]
  experience: Experience[]
  extra: ExtraInfo
}

export const emptyEducation = (): Education => ({ school: '', degree: '', field: '', start: '', end: '' })
export const emptyExperience = (): Experience => ({ company: '', title: '', start: '', end: '', description: '' })

export const emptyProfile = (): Profile => ({
  fullName: '', email: '', phone: '', location: '',
  linkedin: '', github: '', website: '', summary: '',
  skills: '', languages: '',
  education: [], experience: [],
  extra: { salaryExpectation: '', noticePeriod: '', workAuthorization: '', willingToRelocate: '', notes: '' },
})

// ---------- what the Python backend sends back from /autofill ----------

export interface AutofillItem {
  id: string
  source: FillSource      // 'skipped' when the backend left the field for the user
  value: string
  optionId?: string | null
  checked?: boolean | null
  shown: string
  note: string
}

export interface AutofillReply {
  results: AutofillItem[]
  ai_error?: string | null
}
