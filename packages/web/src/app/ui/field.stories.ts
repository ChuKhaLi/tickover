import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Field } from './field'
import { Input } from './input'

const meta: Meta = {
  title: 'Primitives/Field',
  decorators: [moduleMetadata({ imports: [Field, Input] })],
  argTypes: { label: { control: 'text' }, hint: { control: 'text' }, error: { control: 'text' } },
  args: {
    label: 'Work email',
    hint: 'The address your team already uses. We never sell it on.',
    error: '',
  },
  render: (args) => ({
    props: args,
    template: `
      <tk-field [label]="label" [hint]="hint" [error]="error" style="max-width:24rem">
        <input tk-input type="email" placeholder="you@company.com" />
      </tk-field>`,
  }),
}
export default meta
type Story = StoryObj

export const WithHint: Story = {}

/**
 * The error replaces the hint rather than stacking with it: two descriptions on one
 * control is two things read out before the person can type, and while an error is
 * showing it is the one that matters.
 *
 * This is also the assertion that was vacuous until mutation caught it (R322) — the
 * stacked version passed, because both messages carried the same id and the check
 * only ever read the first.
 */
export const WithError: Story = {
  args: { error: 'That address is not an email.' },
}

/**
 * The label is the point. Eleven inputs across this application are
 * placeholder-only, which is a control with no accessible name at all once it has
 * text in it — the placeholder disappears the moment someone starts typing. The
 * placeholder is `ink-500`, the token R304 reserved for marks that must never be
 * the only label.
 */
export const WhatAPlaceholderCannotDo: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:20px; max-width:24rem">
        <tk-field label="Sponsor name shown to developers" hint="Shown with every paid question.">
          <input tk-input type="text" value="Raycast" />
        </tk-field>
        <tk-field label="Rejection note" hint="The buyer reads this.">
          <textarea tk-input rows="3"></textarea>
        </tk-field>
      </div>`,
  }),
}

/** The dense size, for admin rows where a mouse is the input. */
export const Small: Story = {
  render: () => ({
    template: `
      <tk-field label="Countries" hint="ISO codes, comma separated." style="max-width:20rem">
        <input tk-input size="sm" type="text" placeholder="US, GB" />
      </tk-field>`,
  }),
}
