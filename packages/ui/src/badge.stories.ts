import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Badge } from './badge'

const meta: Meta = {
  title: 'Primitives/Badge',
  decorators: [moduleMetadata({ imports: [Badge] })],
  render: () => ({ template: `<div class="flex flex-wrap gap-2">
    <tk-badge tone="neutral">new</tk-badge><tk-badge tone="accent">queued</tk-badge><tk-badge tone="info">sent</tk-badge>
    <tk-badge tone="attention">replied</tk-badge><tk-badge tone="positive">yes</tk-badge><tk-badge tone="negative">bounced</tk-badge></div>` }),
}
export default meta
export const AllTones: StoryObj = {}
