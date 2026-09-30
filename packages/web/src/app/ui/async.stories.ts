import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Async } from './async'
import { Button } from './button'

/**
 * The four-rung ladder, and the workshop is where the rungs can be seen together.
 *
 * Seven screens hand-rolled this ladder before the primitive existed, and each one
 * got the order right separately. The eighth is the one that would not have: the
 * order is a correctness rule rather than a presentation one, because a rejected
 * request leaves the rows signal at `[]`, so **every caller that fails is also
 * empty**. A ladder testing `empty` first reports the wrong thing on every failure,
 * not in an edge case -- on `/dev` that reads "No answers yet" to a developer asking
 * what they are owed, and on `/admin` it shows an empty review queue while a study
 * waits in it.
 */
const meta: Meta = {
  title: 'Primitives/Async',
  decorators: [moduleMetadata({ imports: [Async, Button] })],
  argTypes: {
    failed: { control: 'boolean' },
    loading: { control: 'boolean' },
    empty: { control: 'boolean' },
  },
  args: { failed: false, loading: false, empty: false },
  render: (args) => ({
    props: args,
    template: `
      <div style="max-width:36rem">
        <tk-async
          [failed]="failed"
          [loading]="loading"
          [empty]="empty"
          failedSays="Couldn't load your studies. Reload the page to try again."
          emptySays="No studies yet. Your first one runs at cost."
        >
          <button tk-empty-action tk-button size="sm">Create a study</button>
          <p>The data rung: whatever the caller projects.</p>
        </tk-async>
      </div>`,
  }),
}
export default meta
type Story = StoryObj

export const Data: Story = {}

/**
 * All eight combinations of the three flags, in one view, which is the thing a
 * screen cannot show you: reaching the eighth on a live server means a request in
 * flight over a previous failure, and that is a retry. The ladder must still show
 * the failure there, because the retry has not answered yet and the old one did.
 *
 * Read the left column. `failed` wins over everything, then `loading`, then `empty`.
 */
export const EveryCombination: Story = {
  render: () => ({
    props: {
      rows: [
        { failed: false, loading: false, empty: false, note: 'data' },
        { failed: false, loading: false, empty: true, note: 'empty' },
        { failed: false, loading: true, empty: false, note: 'first load' },
        { failed: false, loading: true, empty: true, note: 'first load, nothing yet' },
        { failed: true, loading: false, empty: false, note: 'failed, rows held' },
        { failed: true, loading: false, empty: true, note: 'failed and empty — the dangerous pair' },
        { failed: true, loading: true, empty: false, note: 'retry over a failure' },
        { failed: true, loading: true, empty: true, note: 'retry over a failure, nothing held' },
      ],
    },
    template: `
      <div style="display:flex; flex-direction:column; gap:20px; max-width:44rem">
        @for (r of rows; track r.note) {
          <div>
            <p style="font:500 12px/1.4 ui-monospace,monospace; opacity:.6; margin:0 0 6px">
              failed={{ r.failed }} loading={{ r.loading }} empty={{ r.empty }} — {{ r.note }}
            </p>
            <tk-async
              [failed]="r.failed" [loading]="r.loading" [empty]="r.empty"
              failedSays="Couldn't load your studies. Reload the page to try again."
              emptySays="No studies yet. Your first one runs at cost."
            >
              <button tk-empty-action tk-button size="sm">Create a study</button>
              <p>Three studies.</p>
            </tk-async>
          </div>
        }
      </div>`,
  }),
}
