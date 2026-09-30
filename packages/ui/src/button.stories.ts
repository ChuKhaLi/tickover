import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Button } from './button'

const meta: Meta = {
  title: 'Primitives/Button',
  decorators: [moduleMetadata({ imports: [Button] })],
  argTypes: { variant: { control: 'inline-radio', options: ['primary', 'secondary', 'danger', 'quiet'] }, size: { control: 'inline-radio', options: ['md', 'sm'] }, busy: { control: 'boolean' } },
  args: { variant: 'primary', size: 'md', busy: false, label: 'Approve 12 and queue' },
  render: (args) => ({ props: args, template: `<button tk-button [variant]="variant" [size]="size" [busy]="busy">{{ label }}</button>` }),
}
export default meta
export const Primary: StoryObj = {}
export const Danger: StoryObj = { args: { variant: 'danger', label: 'Pause sending' } }
export const Busy: StoryObj = { args: { busy: true, label: 'Sending…' } }
