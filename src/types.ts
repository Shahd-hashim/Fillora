export type FieldKind =
  | 'text' | 'email' | 'tel' | 'url' | 'number' | 'date'
  | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file'

export interface FieldOption {
  id: string
  value: string
  text: string
}

export interface DetectedField {
  id: string            // stable id stored on the element as data-af-id
  kind: FieldKind
  label: string         // best human-readable question for this field
  name: string
  placeholder: string
  autocomplete: string
  required: boolean
  hasValue: boolean     // already filled in by the page or the user
  options?: FieldOption[]  // select / radio group
  custom?: boolean      // dropdown built from divs/inputs, not a real <select>
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
  source: 'profile' | 'ai'
}

export type FillSource = 'profile' | 'ai' | 'skipped'

export interface FillResult {
  id: string
  label: string
  answer: string
  source: FillSource
  note?: string
}

export type Message =
  | { type: 'SCAN_FIELDS' }
  | { type: 'HIGHLIGHT_FIELD'; id: string }
  | { type: 'FILL_FIELDS'; fills: FillInstruction[]; summary: string }
  | { type: 'SCAN_ALL'; tabId: number }
  | { type: 'READ_OPTIONS'; id: string }
  | { type: 'AUTOFILL'; tabId: number }

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
