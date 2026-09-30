import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { CONTROL, Field } from './field'

const meta: Meta = {
  title: 'Primitives/Field',
  decorators: [moduleMetadata({ imports: [Field] })],
  render: () => ({ props: { CONTROL }, template: `<div class="flex max-w-sm flex-col gap-4">
    <tk-field label="Sender name" hint="Shown in the From line."><input [class]="CONTROL"></tk-field>
    <tk-field label="Gmail app password" hint="16 letters" secretState="set"><input type="password" [class]="CONTROL"></tk-field>
    <tk-field label="Daily limit" error="Required"><input [class]="CONTROL"></tk-field></div>` }),
}
export default meta
export const Variants: StoryObj = {}
