// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../SettingsPage'
import type { WorkflowState } from '../workflowApi'

afterEach(cleanup)

describe('SettingsPage fact library disclosure', () => {
  it('keeps fact details collapsed until the user expands the section', async () => {
    const state = {
      factLibrary: [{
        id: 'fact-1',
        category: 'skill',
        label: 'professional skills',
        value: '熟悉 React 和 TypeScript',
        sourceType: 'resume',
        sourceRef: 'resume_text',
        status: 'confirmed',
        confidence: 0.9,
      }],
      factGroups: [],
      jobs: [],
    } as unknown as WorkflowState
    window.coreApi = {
      getState: vi.fn(async () => state),
      getLocalApiToken: vi.fn(async () => ({ token: 'fixture-local-token' })),
    } as unknown as typeof window.coreApi

    render(createElement(SettingsPage, { onOpenPreferences: vi.fn(), onOpenOnboarding: vi.fn() }))

    const expand = await screen.findByRole('button', { name: '展开事实库' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('熟悉 React 和 TypeScript')).toBeNull()

    fireEvent.click(expand)

    expect(screen.getByText('熟悉 React 和 TypeScript')).not.toBeNull()
    expect(screen.getByRole('button', { name: '收起事实库' }).getAttribute('aria-expanded')).toBe('true')
  })
})
