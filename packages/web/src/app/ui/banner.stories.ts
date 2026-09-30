import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular'
import { Banner } from './banner'

const meta: Meta = {
  title: 'Primitives/Banner',
  decorators: [moduleMetadata({ imports: [Banner] })],
  argTypes: { tone: { control: 'inline-radio', options: ['error', 'warn', 'done', 'info'] }, text: { control: 'text' } },
  args: { tone: 'done', text: 'Check your email for the sign-in link. It works once and expires in 30 minutes.' },
  render: (args) => ({ props: args, template: `<tk-banner [tone]="tone" style="max-width:36rem">{{ text }}</tk-banner>` }),
}
export default meta
type Story = StoryObj

export const Done: Story = {}

/**
 * Four tones replacing three red vocabularies, three amber owners and four
 * different "it worked" treatments.
 *
 * `done` is where green used to be. Design system 3.4 took green out of the palette
 * entirely: money is set in ink rather than coloured, and the ledger's five entry
 * types are types rather than sentiment, so a green that does not mean money in a
 * product about money is worse than no green.
 */
export const EveryTone: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:12px; max-width:36rem">
        <tk-banner tone="done">Credits added.</tk-banner>
        <tk-banner tone="warn">Payment received. Waiting for your credits to arrive.</tk-banner>
        <tk-banner tone="error">Couldn't send this study for review, and it is still a draft. Try again.</tk-banner>
        <tk-banner tone="info">Card payment is not configured on this deployment.</tk-banner>
      </div>`,
  }),
}

/**
 * The tone also picks the live-region role, which is not visible here and is the
 * more important half: `error` and `warn` are `alert` and interrupt; `done` and
 * `info` are `status` and wait for a pause. An error the person has just caused is
 * worth interrupting for. A confirmation read out over whatever they were listening
 * to is the announcement being louder than the news.
 */
export const WhatTheToneAlsoDecides: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:12px; max-width:36rem">
        <tk-banner tone="error">role="alert" — interrupts</tk-banner>
        <tk-banner tone="done">role="status" — waits</tk-banner>
      </div>`,
  }),
}
