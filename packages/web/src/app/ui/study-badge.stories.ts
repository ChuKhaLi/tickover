import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { StateTrack, StudyBadge } from './study-badge'

/**
 * Where a study is, said two ways: the chip says *which* state, the track says *how
 * far along*. They are on the same page together and neither is the other's label.
 */
const meta: Meta = {
  title: 'Primitives/Study state',
  decorators: [moduleMetadata({ imports: [StudyBadge, StateTrack] })],
  argTypes: {
    state: { control: 'inline-radio', options: ['draft', 'in_review', 'live', 'closed', 'settled', 'rejected'] },
  },
  args: { state: 'live' },
  render: (args) => ({
    props: args,
    template: `
      <div style="display:flex; flex-direction:column; gap:20px; max-width:28rem">
        <mw-study-badge [state]="state" />
        <mw-state-track [state]="state" />
      </div>`,
  }),
}
export default meta
type Story = StoryObj

export const Live: Story = {}

/**
 * Every state, chip beside track.
 *
 * Two things to look at. `draft` and `closed` share a neutral chip -- they are both
 * "not in the field" -- and it is the track beside them that says which end of the
 * lifecycle they are at. That sentence was in the badge's source for four commits
 * before the track existed, which is what building this finally fixed.
 *
 * And `rejected` **draws no track at all**. A rejected study left the sequence
 * rather than stopping inside it; wedging it in as a sixth step would invent a
 * position to keep the picture tidy, on the one indicator design system 1 allows
 * *because* the thing it draws really is a sequence.
 */
export const EveryState: Story = {
  render: () => ({
    props: { states: ['draft', 'in_review', 'live', 'closed', 'settled', 'rejected'] },
    template: `
      <div style="display:grid; grid-template-columns:7rem 1fr; gap:20px 24px; align-items:center; max-width:34rem">
        @for (s of states; track s) {
          <mw-study-badge [state]="s" />
          <mw-state-track [state]="s" />
        }
      </div>`,
  }),
}

/**
 * The step reached is the only label at raised weight, so the position survives a
 * reader who cannot separate the two bar colours at all. Measured on the page
 * ground: a bar reached is `signal-600` at 7.01 and 4.97 against an unreached one;
 * on the dark ground `signal-400` at 7.19 and 3.06 against `ink-600`. The bars
 * reinforce a distinction that is already readable without them.
 */
export const NotColourAlone: Story = {
  render: () => ({
    props: { states: ['draft', 'live', 'settled'] },
    template: `
      <div style="display:flex; flex-direction:column; gap:24px; max-width:28rem; filter:grayscale(1)">
        @for (s of states; track s) { <mw-state-track [state]="s" /> }
      </div>`,
  }),
}
