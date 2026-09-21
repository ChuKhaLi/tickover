import http from 'node:http'

/**
 * A GET with the `Host` header set exactly as given.
 *
 * Node's built-in fetch() (undici) always overwrites a user-supplied `Host` with the real connection
 * host before sending, so it cannot exercise the daemon's Host-mismatch check at all. node:http's
 * client does send the caller's Host as given, which is why the 421 tests go through this and every
 * other request in those files goes through fetch().
 */
export function requestWithHost(url: string, host: string, headers: Record<string, string>): Promise<{ status: number }> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, headers: { ...headers, host } }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
    })
    req.on('error', reject)
    req.end()
  })
}
