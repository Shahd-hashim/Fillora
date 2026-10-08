import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth/mammoth.browser'
import type { StoredCv } from './storage'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** Turn an uploaded CV (PDF, DOCX or TXT) into plain text. */
export async function extractCvText(file: File): Promise<string> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.pdf')) {
    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjsLib.getDocument({ data }).promise
    let out = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      for (const item of content.items as any[]) {
        if ('str' in item) out += item.str + (item.hasEOL ? '\n' : ' ')
      }
      out += '\n'
    }
    return out.trim()
  }

  if (name.endsWith('.docx')) {
    const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return res.value.trim()
  }

  if (name.endsWith('.txt')) return (await file.text()).trim()

  throw new Error('Unsupported file type. Upload a PDF, DOCX or TXT file.')
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
}

/** Package the uploaded CV so the extension can attach it to file fields later. */
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
