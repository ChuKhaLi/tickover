import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Button } from './button'
import { Card } from './card'

const meta: Meta = {
  title: 'Primitives/Card',
  decorators: [moduleMetadata({ imports: [Card, Button] })],
  render: () => ({ template: `<tk-card heading="Gmail">
    <button tk-button size="sm" card-actions>Test</button>
    <p class="text-small">Sender account and daily limit.</p></tk-card>` }),
}
export default meta
export const WithActions: StoryObj = {}
