import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Button } from './button'

/**
 * Rendered through `render` with a template rather than declared as a `component`,
 * because `tk-button` is a directive on a real `<button>` — which is the point of
 * it (R321), and the workshop should show what a caller actually writes.
 */
const meta: Meta = {
  title: 'Primitives/Button',
  decorators: [moduleMetadata({ imports: [Button] })],
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'danger', 'quiet'] },
    size: { control: 'inline-radio', options: ['md', 'sm'] },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
  },
  args: { variant: 'primary', size: 'md', disabled: false, label: 'Submit for review' },
  render: (args) => ({
    props: args,
    template: `<button tk-button [variant]="variant" [size]="size" [disabled]="disabled">{{ label }}</button>`,
  }),
}
export default meta
type Story = StoryObj

export const Primary: Story = {}

/**
 * A bright fill with near-black ink, not the dark fill with white text nearly every
 * product ships. The dark fill is what made the page tone heavy, and it was wasting
 * contrast it did not need: 8.06 here against 7.33 for the deep one, so the lighter
 * button is better on the one axis that can be measured (R316).
 */
export const EveryVariant: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center">
        <button tk-button variant="primary">Submit for review</button>
        <button tk-button variant="secondary">Save draft</button>
        <button tk-button variant="danger">Delete my account</button>
        <button tk-button variant="quiet">Load more</button>
      </div>`,
  }),
}

/** `md` meets the 44px floor. `sm` is 36px and is raised to 44 under a coarse pointer. */
export const BothSizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:12px; align-items:center">
        <button tk-button size="md">Create batch</button>
        <button tk-button size="sm">Mark paid</button>
        <button tk-button variant="danger" size="sm">Mark failed</button>
      </div>`,
  }),
}

/**
 * Every variant carries the disabled treatment, which two of the six shapes this
 * replaced did not — including an `<a>` styled as a primary button, which cannot be
 * disabled at all.
 */
export const Disabled: Story = { args: { disabled: true } }

/**
 * An irreversible action is a button, never an underlined text link. `/admin/developers`
 * renders "Ban" and `/admin/payouts` renders "Mark failed" as bare links today, while the
 * review queue renders the same class of action as a filled button.
 */
export const IrreversibleActionsAreButtons: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:12px; align-items:center">
        <button tk-button variant="secondary" size="sm">Reinstate</button>
        <button tk-button variant="danger" size="sm">Ban</button>
      </div>`,
  }),
}
