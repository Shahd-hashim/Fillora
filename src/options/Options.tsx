import { useEffect, useRef, useState } from 'react'
import {
  emptyEducation, emptyExperience, emptyProfile,
  type Profile,
} from '../types'
import {
  DEFAULT_STYLE, getCv, getProfile, getSavedAnswers, getSettings, removeCv, saveCv,
  saveProfile, saveSettings, setSavedAnswers,
  fileToStoredCv, type SavedAnswer, type Settings, type WritingStyle,
} from '../lib/storage'
import { parseCv } from '../lib/api'

type Status = { kind: 'idle' | 'ok' | 'error' | 'busy'; text: string }

function Field(props: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  type?: string
  hint?: string
}) {
  const { label, value, onChange, multiline, type = 'text', hint } = props
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline ? (
        <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export default function Options() {
  const [profile, setProfile] = useState<Profile>(emptyProfile())
  const [settings, setSettings] = useState<Settings>({
    style: DEFAULT_STYLE, autoContinue: true,
    backendUrl: '', backendSecret: '',
  })
  const [saved, setSaved] = useState<Array<[string, SavedAnswer]>>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' })
  const [cv, setCv] = useState<{ name: string; size: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ;(async () => {
      const [p, s] = await Promise.all([getProfile(), getSettings()])
      setProfile(p)
      setSettings(s)
      const c = await getCv()
      if (c) setCv({ name: c.name, size: c.size })
      setSaved(Object.entries(await getSavedAnswers()))
    })()
  }, [])

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) =>
    setProfile((p) => ({ ...p, [k]: v }))
  const setExtra = (k: keyof Profile['extra'], v: string) =>
    setProfile((p) => ({ ...p, extra: { ...p.extra, [k]: v } }))

  const currentSettings = (): Settings => ({
    ...settings,
    backendUrl: settings.backendUrl.trim(),
    backendSecret: settings.backendSecret.trim(),
  })

  const saveAll = async () => {
    const s = currentSettings()
    await saveSettings(s)
    await saveProfile(profile)
    await setSavedAnswers(Object.fromEntries(saved))
    setSettings(s)
    setStatus({ kind: 'ok', text: 'Saved.' })
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const s = currentSettings()
      await saveSettings(s)
      let warn = ''
      try {
        const stored = await fileToStoredCv(file)
        await saveCv(stored)
        setCv({ name: stored.name, size: stored.size })
      } catch (e) {
        warn = ' ' + (e instanceof Error ? e.message : String(e))
      }
      setStatus({ kind: 'busy', text: 'Reading your CV with the AI model. This can take up to a minute…' })
      const parsed = await parseCv(s, file)
      const next = { ...emptyProfile(), ...parsed, extra: profile.extra }
      setProfile(next)
      await saveProfile(next)
      setStatus({ kind: 'ok', text: 'CV parsed and saved. Check the fields below and fix anything that is wrong.' + warn })
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const busy = status.kind === 'busy'

  return (
    <div className="page">
      <h1>Your profile</h1>
      <p className="lead">
        Upload your CV once. The extension uses this profile to answer application forms.
      </p>

      {status.text && (
        <p className={`status ${status.kind}`} role="status">{status.text}</p>
      )}

      <section>
        <h2>AI connection</h2>
        <Field
          label="Backend URL"
          value={settings.backendUrl}
          onChange={(v) => setSettings((s) => ({ ...s, backendUrl: v }))}
          hint="Your Python server, for example the https URL from ngrok (run: ngrok http 8000)."
        />
        <Field
          label="Backend secret"
          type="password"
          value={settings.backendSecret}
          onChange={(v) => setSettings((s) => ({ ...s, backendSecret: v }))}
          hint="Must match BACKEND_SECRET in backend/.env."
        />
        <p className="hint">
          The OpenRouter API key and the models are configured in backend/.env, not in the browser.
          Privacy: your CV text is sent to your backend and from there to the company running the model.
          Free models may log prompts, so check your OpenRouter privacy settings if that matters to you.
        </p>
      </section>

      <section>
        <h2>Upload your CV</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt"
          disabled={busy}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <p className="hint">PDF, DOCX or TXT. Uploading again replaces the CV details below but keeps your extra info.</p>
        {cv ? (
          <p className="hint">
            Stored for automatic upload on applications: <b>{cv.name}</b> ({Math.max(1, Math.round(cv.size / 1024))} KB){' '}
            <button
              className="link danger"
              onClick={async () => { await removeCv(); setCv(null) }}
            >
              Remove
            </button>
          </p>
        ) : (
          <p className="hint">No CV file stored yet, so file upload fields on applications will be skipped. Upload your CV above.</p>
        )}
      </section>

      <section>
        <h2>Basics</h2>
        <div className="grid">
          <Field label="Full name" value={profile.fullName} onChange={(v) => set('fullName', v)} />
          <Field label="Email" type="email" value={profile.email} onChange={(v) => set('email', v)} />
          <Field label="Phone" type="tel" value={profile.phone} onChange={(v) => set('phone', v)} />
          <Field label="Location" value={profile.location} onChange={(v) => set('location', v)} />
          <Field label="LinkedIn" value={profile.linkedin} onChange={(v) => set('linkedin', v)} />
          <Field label="GitHub" value={profile.github} onChange={(v) => set('github', v)} />
          <Field label="Website / portfolio" value={profile.website} onChange={(v) => set('website', v)} />
        </div>
        <Field label="Summary" multiline value={profile.summary} onChange={(v) => set('summary', v)} />
        <Field label="Skills" value={profile.skills} onChange={(v) => set('skills', v)} hint="Separate with commas." />
        <Field label="Languages" value={profile.languages} onChange={(v) => set('languages', v)} hint="Separate with commas." />
      </section>

      <section>
        <h2>Experience</h2>
        {profile.experience.length === 0 && <p className="hint">Nothing here yet. Upload a CV or add a role.</p>}
        {profile.experience.map((x, i) => (
          <div className="item" key={i}>
            <div className="grid">
              <Field label="Job title" value={x.title}
                onChange={(v) => set('experience', profile.experience.map((e, j) => (j === i ? { ...e, title: v } : e)))} />
              <Field label="Company" value={x.company}
                onChange={(v) => set('experience', profile.experience.map((e, j) => (j === i ? { ...e, company: v } : e)))} />
              <Field label="Start" value={x.start}
                onChange={(v) => set('experience', profile.experience.map((e, j) => (j === i ? { ...e, start: v } : e)))} />
              <Field label="End" value={x.end}
                onChange={(v) => set('experience', profile.experience.map((e, j) => (j === i ? { ...e, end: v } : e)))} />
            </div>
            <Field label="What you did" multiline value={x.description}
              onChange={(v) => set('experience', profile.experience.map((e, j) => (j === i ? { ...e, description: v } : e)))} />
            <button className="link danger" onClick={() => set('experience', profile.experience.filter((_, j) => j !== i))}>
              Remove this role
            </button>
          </div>
        ))}
        <button className="btn" onClick={() => set('experience', [...profile.experience, emptyExperience()])}>Add a role</button>
      </section>

      <section>
        <h2>Education</h2>
        {profile.education.length === 0 && <p className="hint">Nothing here yet. Upload a CV or add a school.</p>}
        {profile.education.map((x, i) => (
          <div className="item" key={i}>
            <div className="grid">
              <Field label="School" value={x.school}
                onChange={(v) => set('education', profile.education.map((e, j) => (j === i ? { ...e, school: v } : e)))} />
              <Field label="Degree" value={x.degree}
                onChange={(v) => set('education', profile.education.map((e, j) => (j === i ? { ...e, degree: v } : e)))} />
              <Field label="Field of study" value={x.field}
                onChange={(v) => set('education', profile.education.map((e, j) => (j === i ? { ...e, field: v } : e)))} />
              <Field label="Start" value={x.start}
                onChange={(v) => set('education', profile.education.map((e, j) => (j === i ? { ...e, start: v } : e)))} />
              <Field label="End" value={x.end}
                onChange={(v) => set('education', profile.education.map((e, j) => (j === i ? { ...e, end: v } : e)))} />
            </div>
            <button className="link danger" onClick={() => set('education', profile.education.filter((_, j) => j !== i))}>
              Remove this school
            </button>
          </div>
        ))}
        <button className="btn" onClick={() => set('education', [...profile.education, emptyEducation()])}>Add a school</button>
      </section>

      <section>
        <h2>Extra info your CV does not cover</h2>
        <div className="grid">
          <Field label="Salary expectation" value={profile.extra.salaryExpectation} onChange={(v) => setExtra('salaryExpectation', v)} />
          <Field label="Notice period" value={profile.extra.noticePeriod} onChange={(v) => setExtra('noticePeriod', v)} />
          <Field label="Work authorization" value={profile.extra.workAuthorization} onChange={(v) => setExtra('workAuthorization', v)} hint="For example: Egyptian citizen, need visa sponsorship." />
          <Field label="Willing to relocate?" value={profile.extra.willingToRelocate} onChange={(v) => setExtra('willingToRelocate', v)} />
        </div>
        <Field label="Anything else the AI should know" multiline value={profile.extra.notes}
          onChange={(v) => setExtra('notes', v)}
          hint="Preferences, gaps in your CV, how you want to come across in written answers." />
      </section>

      <section>
        <h2>Writing style for long answers</h2>
        <div className="grid">
          <label className="field">
            <span className="field-label">Tone</span>
            <select
              value={settings.style.tone}
              onChange={(e) => setSettings((s) => ({ ...s, style: { ...s.style, tone: e.target.value as WritingStyle['tone'] } }))}
            >
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="confident">Confident and direct</option>
              <option value="enthusiastic">Enthusiastic</option>
              <option value="concise">Plain and concise</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Length</span>
            <select
              value={settings.style.length}
              onChange={(e) => setSettings((s) => ({ ...s, style: { ...s.style, length: e.target.value as WritingStyle['length'] } }))}
            >
              <option value="short">Short (2 to 3 sentences)</option>
              <option value="medium">Medium (4 to 6 sentences)</option>
              <option value="long">Long (two short paragraphs)</option>
            </select>
          </label>
        </div>
        <Field
          label="Extra instructions for the AI"
          multiline
          value={settings.style.extra}
          onChange={(v) => setSettings((s) => ({ ...s, style: { ...s.style, extra: v } }))}
          hint="For example: never say 'passionate', mention my open-source work when it fits."
        />
      </section>

      <section>
        <h2>Saved answers</h2>
        <p className="hint">
          Answers you saved from the popup. When the same question shows up again, the saved answer is used
          instead of asking the AI. Edit or delete them here. Do not save answers that mention one specific company.
        </p>
        {saved.length === 0 && (
          <p className="hint">Nothing saved yet. After an autofill, review the answers and click Save in the popup.</p>
        )}
        {saved.map(([key, a]) => (
          <div className="item" key={key}>
            <Field
              label={a.label}
              multiline
              value={a.answer}
              onChange={(v) =>
                setSaved((list) => list.map(([k, x]) => (k === key ? ([k, { ...x, answer: v }] as [string, SavedAnswer]) : [k, x] as [string, SavedAnswer])))
              }
            />
            <button className="link danger" onClick={() => setSaved((list) => list.filter(([k]) => k !== key))}>
              Delete this answer
            </button>
          </div>
        ))}
      </section>

      <div className="savebar">
        <button className="btn primary" onClick={saveAll} disabled={busy}>Save changes</button>
        {status.kind === 'ok' && <span className="saved">{status.text}</span>}
      </div>
    </div>
  )
}
