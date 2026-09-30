import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Banner } from './banner'

const meta: Meta = {
  title: 'Primitives/Banner',
  decorators: [moduleMetadata({ imports: [Banner] })],
  render: () => ({ template: `<div class="flex flex-col gap-2">
    <tk-banner kind="info">Moved 44 prospects to the queue.</tk-banner>
    <tk-banner kind="warning">Gmail sends 3 of 5 today.</tk-banner>
    <tk-banner kind="error">SMTP is down. Nothing will send.</tk-banner>
    <tk-banner dismissible>Dismissible note.</tk-banner></div>` }),
}
export default meta
export const AllKinds: StoryObj = {}
