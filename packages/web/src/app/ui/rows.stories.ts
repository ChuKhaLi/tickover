import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Button } from './button'
import { Empty } from './empty'
import { Money } from './money'
import { Figure, Rows } from './rows'

/**
 * The data grid, and the row a list has when it has no rows.
 *
 * Built as two directives on the real `table` and `td` rather than as one component
 * taking column definitions (R331). Seven specs already queried `tbody tr`,
 * `thead th` and `td:nth-child(n)`, so a component would have had to reproduce that
 * structure anyway -- the only thing it could add was a wrapper to break them on.
 *
 * Named `tk-rows`, not `tk-table`: `table` is a Tailwind utility this system has
 * minted out of English prose twice, and a primitive whose own name is a standing
 * hazard in every file that imports it is not worth matching the document.
 */
const meta: Meta = {
  title: 'Primitives/Rows',
  decorators: [moduleMetadata({ imports: [Rows, Figure, Empty, Money, Button] })],
}
export default meta
type Story = StoryObj

/**
 * Alignment is per cell, and `tk-figure` goes on the `<th>` as well as the `<td>`.
 * That is the half that is easy to forget: a right-aligned column under a
 * left-aligned head reads as a mistake rather than as a column.
 *
 * Body rows are divided by a single top hairline, one direction only, so no rule is
 * doubled where head meets body and none is orphaned under the last row.
 */
export const WithFigures: Story = {
  render: () => ({
    props: { rows: [
      { when: 'Sep 18, 7:00 PM', sponsor: 'Raycast', study: 'Which terminal?', cents: 50, status: 'pending' },
      { when: 'Sep 17, 11:00 AM', sponsor: 'Tickover', study: 'Panel profile (profile question)', cents: 0, status: 'unpaid' },
      { when: 'Sep 15, 9:12 AM', sponsor: 'Acme DB', study: 'Which tagline?', cents: 50, status: 'released' },
    ] },
    template: `
      <div style="max-width:40rem">
        <table tk-rows>
          <thead><tr><th>When</th><th>Sponsor</th><th>Study</th><th tk-figure>Amount</th><th>Status</th></tr></thead>
          <tbody>
            @for (r of rows; track r.when) {
              <tr>
                <td>{{ r.when }}</td><td>{{ r.sponsor }}</td><td>{{ r.study }}</td>
                <td tk-figure><tk-money voice="data" [cents]="r.cents" /></td>
                <td>{{ r.status }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>`,
  }),
}

/**
 * The empty row, which needs no prop for its horizontal space: its padding is
 * vertical and the cell supplies the rest. Left-aligned on purpose -- a centred
 * sentence in a data-dense product reads as a marketing moment, and this is a row of
 * a list that happens to have no rows.
 *
 * It is a direction, not a mood: it says what would fill the list and offers the
 * action that fills it.
 */
export const Empties: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:28px; max-width:40rem">
        <table tk-rows>
          <thead><tr><th>Study</th><th>State</th><th tk-figure>Responses</th></tr></thead>
          <tbody>
            <tr><td colspan="3"><tk-empty says="No studies yet. Your first one runs at cost."><button tk-button size="sm">Create a study</button></tk-empty></td></tr>
          </tbody>
        </table>
        <tk-empty says="No answers yet. Install the plugin and one will arrive while Claude works." />
      </div>`,
  }),
}
