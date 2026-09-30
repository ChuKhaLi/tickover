import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { NavItem } from './nav-item'

const meta: Meta = {
  title: 'Primitives/NavItem',
  decorators: [moduleMetadata({ imports: [NavItem] })],
  render: () => ({ template: `<nav style="width:220px" class="flex flex-col gap-0.5">
    <a tk-nav-item href="#" class="is-active" [count]="31">Today</a>
    <a tk-nav-item href="#" [count]="4" countTone="attention">Queue</a>
    <a tk-nav-item href="#" [count]="120">Sent</a>
    <a tk-nav-item href="#" alert>Settings</a></nav>` }),
}
export default meta
export const WithCountsAndAlert: StoryObj = {}
