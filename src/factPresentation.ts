const FACT_CATEGORY_ALIASES: Record<string, string> = {
  personal: '个人信息',
  personal_info: '个人信息',
  job_search: '求职意向',
  preference: '偏好',
  preferences: '偏好',
  education: '教育经历',
  skill: '技能',
  skills: '技能',
  project: '项目经历',
  experience: '工作经历',
}

const FACT_LABEL_ALIASES: Record<string, string> = {
  'personal information': '个人信息',
  'personal info': '个人信息',
  'job search intent': '求职意向',
  'work experience': '工作经历',
  'project experience': '项目经历',
  education: '教育经历',
  skill: '技能',
  skills: '技能',
  'professional skills': '专业技能',
  'internship responsibility': '实习职责',
}

export function displayFactCategory(category: string) {
  const trimmed = category.trim()
  return FACT_CATEGORY_ALIASES[trimmed.toLowerCase()] ?? trimmed
}

export function displayFactLabel(label: string) {
  const trimmed = label.trim()
  const normalized = trimmed.toLowerCase()
  const exact = FACT_LABEL_ALIASES[normalized]
  if (exact) return exact
  if (normalized.startsWith('project:')) return `项目：${trimmed.slice(trimmed.indexOf(':') + 1).trim()}`
  if (normalized.startsWith('internship:')) return `实习经历：${trimmed.slice(trimmed.indexOf(':') + 1).trim()}`
  return trimmed
}
