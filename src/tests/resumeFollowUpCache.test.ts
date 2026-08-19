// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  computeResumeFollowUpFingerprint,
  readCachedResumeFollowUps,
  writeCachedResumeFollowUps
} from '../resumeFollowUpCache'
import type { FollowUpQuestion } from '../workflowApi'
import type { ProfileFact } from '../types'

function buildFact(overrides: Partial<ProfileFact> = {}): ProfileFact {
  return {
    id: 'fact-1',
    category: '技能',
    label: 'React',
    value: '负责 React 组件开发',
    sourceType: 'resume',
    sourceRef: 'resume:test',
    status: 'confirmed',
    confidence: 0.9,
    groupId: null,
    summary: null,
    ...overrides
  }
}

function buildQuestions(): FollowUpQuestion[] {
  return [
    {
      id: 'followup-q-1',
      requirementId: 'resume-refine',
      kind: 'explore',
      question: '请补充 React 项目经历',
      rationale: '需要更多证据'
    }
  ]
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('resumeFollowUpCache', () => {
  it('writes and reads questions for the same fact fingerprint', () => {
    const facts = [buildFact()]
    expect(readCachedResumeFollowUps(facts)).toBeNull()

    writeCachedResumeFollowUps(facts, buildQuestions())

    expect(readCachedResumeFollowUps(facts)).toEqual(buildQuestions())
  })

  it('invalidates the cache when fact value or status changes', () => {
    const facts = [buildFact()]
    writeCachedResumeFollowUps(facts, buildQuestions())

    expect(readCachedResumeFollowUps([buildFact({ value: '主导 React 架构升级' })])).toBeNull()
    expect(readCachedResumeFollowUps([buildFact({ status: 'rejected' })])).toBeNull()
  })

  it('ignores malformed cache entries', () => {
    window.localStorage.setItem('boss-local-resume-followups:v1', JSON.stringify({ fingerprint: 'bad', questions: [{ id: 1 }] }))
    expect(readCachedResumeFollowUps([buildFact()])).toBeNull()
  })

  it('fingerprint ignores rejected facts', () => {
    const facts = [buildFact({ status: 'rejected', value: '已排除事实' })]
    expect(computeResumeFollowUpFingerprint(facts)).toBe('')
  })
})
