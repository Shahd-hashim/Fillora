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
  rawCvText: string
}

export const emptyEducation = (): Education => ({ school: '', degree: '', field: '', start: '', end: '' })
export const emptyExperience = (): Experience => ({ company: '', title: '', start: '', end: '', description: '' })

export const emptyProfile = (): Profile => ({
  fullName: '', email: '', phone: '', location: '',
  linkedin: '', github: '', website: '', summary: '',
  skills: '', languages: '',
  education: [], experience: [],
  extra: { salaryExpectation: '', noticePeriod: '', workAuthorization: '', willingToRelocate: '', notes: '' },
  rawCvText: '',
})
