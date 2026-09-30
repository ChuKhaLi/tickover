/**
 * What `tickover status` prints: /v1/health and /v1/question merged under the port.
 *
 * /v1/question repeats health's `loggedIn` as `logged_in`, and merging both printed the same fact
 * twice under two spellings. `loggedIn` is the one kept, because the setup skill tells the model to
 * confirm `loggedIn: true`.
 */
export function statusReport(port: number, health: Record<string, unknown>, question: Record<string, unknown>): Record<string, unknown> {
  const { logged_in: _loggedIn, ...rest } = question
  return { port, ...health, ...rest }
}
