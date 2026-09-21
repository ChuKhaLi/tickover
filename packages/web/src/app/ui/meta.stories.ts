import { moduleMetadata, type Meta as StoryMeta, type StoryObj } from '@storybook/angular'
import { Meta } from './meta'
import { Money } from './money'
import { Range } from './input'

/**
 * The two treatments that six and two screens respectively had written out by hand.
 *
 * Neither adds an idea. `mw-meta` retires three different gaps, two type roles and a
 * middle dot that had grown back; `mw-range` retires the same nine classes typed
 * twice. Both cost **0 bytes** on the shipped stylesheet, because every class they
 * carry was already in it -- which is the clearest statement of this layer's
 * economics: a primitive that unifies what screens already do is free.
 */
const meta: StoryMeta = {
  title: 'Primitives/Meta and Range',
  decorators: [moduleMetadata({ imports: [Meta, Money, Range] })],
}
export default meta
type Story = StoryObj

/**
 * Facts under a heading, joined by the layout rather than by a mark.
 *
 * Every one of these lines is a place where a dotted chain is the obvious thing to
 * write, and the middle dot belongs to the one line this product sells (design
 * system 7). Each fact keeps its own commas, which is why a comma could not have
 * been the separator and why the mark looked necessary: the answer is a gap.
 */
export const MetaLine: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:20px; max-width:40rem">
        <p mw-meta>
          <span>Sponsor Raycast</span>
          <span><mw-money [cents]="100" /> per response</span>
          <span>your first study, at cost</span>
        </p>
        <p mw-meta>
          <span>languages typescript, go</span>
          <span>countries US, GB</span>
          <span>tiers heavy</span>
          <span>os linux</span>
        </p>
      </div>`,
  }),
}

/**
 * The native control, styled once. Keyboard behaviour, the announced value and the
 * touch target stay the platform's; width stays the caller's, because width is a
 * layout decision rather than a treatment.
 *
 * Tab to it. The focus edge is the half a hand-copied control loses, and the half
 * nobody notices missing.
 */
export const RangeControl: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:16px; max-width:30rem">
        <label style="display:flex; align-items:center; gap:12px">
          <span style="font-size:14px">Terminal width</span>
          <input type="range" mw-range min="68" max="120" value="80" class="w-56" />
        </label>
        <label style="display:flex; flex-direction:column; gap:8px">
          <span style="font-size:14px">Respondents</span>
          <input type="range" mw-range min="50" max="500" step="10" value="100" class="w-full" />
        </label>
      </div>`,
  }),
}
