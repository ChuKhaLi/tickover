/**
 * Send via PayPal, driven in Chromium: the button only exists on a batch the
 * server calls sendable, and a completed send leaves Refresh from PayPal in
 * its place rather than the send button it replaced.
 */
import { expect, test } from '@playwright/test'
import { mockApi } from './mock-api'

test('an admin sends a payout batch via PayPal, then is offered Refresh from PayPal', async ({ page }) => {
  await mockApi(page, { adminSignedIn: true, sendableBatch: true })
  await page.goto('/admin/payouts')
  await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible()

  const sendButton = page.getByRole('button', { name: 'Send via PayPal' })
  await expect(sendButton).toBeVisible()
  await sendButton.click()

  // `exact: true`, next to the send button whose own name contains "Send": the
  // confirmation's go button is titled from `action="Send"` alone.
  await page.getByRole('button', { name: 'Send', exact: true }).click()

  await expect(page.getByRole('button', { name: 'Refresh from PayPal' })).toBeVisible()
  await expect(sendButton).toHaveCount(0)
})
