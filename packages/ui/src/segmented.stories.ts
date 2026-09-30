import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Segmented } from './segmented'

const meta: Meta = {
  title: 'Primitives/Segmented',
  decorators: [moduleMetadata({ imports: [Segmented] })],
  render: () => ({
    props: { opts: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], v: 'system' },
    template: `<tk-segmented label="Theme" [options]="opts" [value]="v" (valueChange)="v = $event" />`,
  }),
}
export default meta
export const ThemeSwitch: StoryObj = {}
