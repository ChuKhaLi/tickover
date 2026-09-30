import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Table } from './table'

const rows = Array.from({ length: 30 }, (_, i) => `<tr><td>prospect-${i + 1}@example.com</td><td>Queued</td></tr>`).join('')
const meta: Meta = {
  title: 'Primitives/Table',
  decorators: [moduleMetadata({ imports: [Table] })],
  render: () => ({ template: `<div style="height:300px;overflow:auto"><table tk-table><thead><tr><th>Recipient</th><th>State</th></tr></thead><tbody>${rows}</tbody></table></div>` }),
}
export default meta
export const StickyHeader: StoryObj = {}
