/**
 * The buyer path, driven in Chromium against the built artifact: sign-in gate,
 * wizard, submit, and the study page the money is committed on.
 *
 * The wizard is the screen this branch broke twice in ways only a browser showed —
 * an input Chromium refused all typing into because a probe bound `maxlength="0"`,
 * and a mark that pointed at the wrong option once blank rows were dropped. Both
 * suites were green.
 */
import { expect, test, type Page } from '@playwright/test'
import { quoteStudy } from '@tickover/contract'
import { formatCents } from '../src/app/lib/money'
import { STUDY_ID, mockApi } from './mock-api'

const atCost = quoteStudy({ targeted: false, atCost: true })

/**
 * The wizard steps both the covered and the uncovered submit share: open it from
 * the studies list, fill in one question of two options, tick the review policy,
 * and send it for review. What happens after `submit.click()` is where the two
 * paths diverge, so that stays in each test rather than in here.
 */
async function writeAndSubmitStudy(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Studies' })).toBeVisible()
  await expect(page.getByText('No studies yet.')).toBeVisible()

  // Scoped to `main`: the shell renders a "New study" nav link too, and clicking
  // the chrome would leave the page's own call to action untested.
  await page.getByRole('main').getByRole('link', { name: 'New study' }).click()
  await expect(page).toHaveURL('/app/studies/new')

  await page.getByLabel('Title (internal)').fill('Tagline test')
  await page.getByLabel('Sponsor name shown to developers').fill('Acme DB')
  await page.locator('input[name="q0"]').fill('Which tagline?')
  await page.locator('input[name="q0o0"]').fill('Postgres, but faster')
  await page.locator('input[name="q0o1"]').fill('Your DB, cached')

  // What the buyer typed has to be *in the inputs*, not only in the model. Under
  // zoneless change detection a write that repaints nothing leaves the two
  // disagreeing, and it is the DOM that gets posted.
  await expect(page.locator('input[name="q0o1"]')).toHaveValue('Your DB, cached')

  // The at-cost quote, from the contract. The panel is what the buyer commits
  // money against, and this study is untargeted and this buyer's first.
  const quote = page.getByRole('complementary')
  await expect(quote).toContainText(formatCents(atCost.priceCents))
  await expect(quote).toContainText('First study at cost')
  await expect(quote).toContainText(formatCents(atCost.priceCents * 100))

  // The policy tick is the claim the reviewer approves against, and the submit
  // button is disabled until it is made.
  const submit = page.getByRole('button', { name: 'Submit for review' })
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox').check()
  await expect(submit).toBeEnabled()

  await submit.click()
}

test('a signed-out visitor is sent to sign in rather than to the studies page', async ({ page }) => {
  await mockApi(page, { signedIn: false })
  await page.goto('/app')

  await expect(page).toHaveURL('/app/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  // The gate is the point: the studies table must not be behind the redirect.
  await expect(page.getByRole('heading', { name: 'Studies' })).toHaveCount(0)
})

test('a signed-in buyer writes a study in the wizard and sends it for review', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true })
  await page.goto('/app')

  await writeAndSubmitStudy(page)

  await expect(page).toHaveURL(`/app/studies/${STUDY_ID}`)
  await expect(page.getByRole('heading', { name: 'Tagline test', level: 1 })).toBeVisible()
  // The badge, not the page text: "in review" is the state the server sent back,
  // and reading it off the element that renders the state is what makes this a
  // test of the badge rather than of a sentence that happens to contain the words.
  await expect(page.locator('tk-study-badge')).toHaveText('in review')
  await expect(page.getByText('Sponsor Acme DB')).toBeVisible()
  await expect(page.getByText('Respondents 0 / 100')).toBeVisible()

  // One study, created once. The wizard's whole idempotency guarantee is that a
  // retry cannot mint a second paid study, and the count is where that shows.
  expect(api.studies).toHaveLength(1)
  expect(api.studies[0]?.state).toBe('in_review')
  expect(api.studies[0]?.title).toBe('Tagline test')
  expect(api.unhandled).toEqual([])
})

test('a submit the credit does not cover lands on the study page awaiting payment', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, uncovered: true })
  await page.goto('/app')

  await writeAndSubmitStudy(page)

  await expect(page).toHaveURL(`/app/studies/${STUDY_ID}`)
  await expect(page.locator('tk-study-badge')).toHaveText('awaiting payment')
  const panel = page.locator('[data-awaiting]')
  await expect(panel).toContainText('$28.00')
  await expect(panel).toContainText('TKO-TEST0001')
  await expect(page.locator('[data-instructions]')).toHaveText('Bank A\nAccount 123')
  expect(api.unhandled).toEqual([])
})

// R505: the button is a plain redirect (`location.href = approve_url`), so this is the
// one suite that can see it actually navigate -- `[id].page.spec.ts` mocks `go()` instead.
test('a buyer with PayPal available pays from the awaiting-payment panel, and the click redirects', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, uncovered: true, paypal: true })
  await page.goto('/app')

  await writeAndSubmitStudy(page)

  await expect(page).toHaveURL(`/app/studies/${STUDY_ID}`)
  const payButton = page.getByRole('button', { name: 'Pay with PayPal' })
  await expect(payButton).toBeVisible()

  // The approve page itself is out of scope for this suite -- a 200 stub proves the
  // redirect happened, not that PayPal's own page rendered.
  await page.route('https://www.sandbox.paypal.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ok</title>' }))

  await payButton.click()
  await expect(page).toHaveURL('https://www.sandbox.paypal.com/checkoutnow?token=ORDER-E2E')
  expect(api.unhandled).toEqual([])
})
