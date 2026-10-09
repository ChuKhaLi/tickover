import { describe, it, expect } from 'vitest'
import { COUNTRY_ALIASES, COUNTRY_CODES, isCountryCode } from '../src/countries.js'

const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })

describe('COUNTRY_CODES', () => {
  it('is 249 ISO codes plus XK, sorted and unique', () => {
    expect(COUNTRY_CODES).toHaveLength(250)
    expect(new Set(COUNTRY_CODES).size).toBe(250)
    expect([...COUNTRY_CODES].sort()).toEqual([...COUNTRY_CODES])
    expect(Object.isFrozen(COUNTRY_CODES)).toBe(true)
    for (const c of COUNTRY_CODES) expect(c).toMatch(/^[A-Z]{2}$/)
  })

  // Every code has a real English name. ICU's fallback for an unknown code is
  // undefined with fallback 'none', and "Unknown Region" for ZZ.
  it('names every code', () => {
    for (const c of COUNTRY_CODES) {
      const n = names.of(c)
      expect(n, c).toBeTruthy()
      expect(n, c).not.toBe('Unknown Region')
    }
  })

  // UK is the reason this list exists: it is not what cf-ipcountry sends, yet ICU
  // names it, so "has a name" alone would let it in.
  it('leaves out codes no developer can carry', () => {
    for (const c of ['UK', 'EU', 'ZZ', 'XX', 'T1', 'YU', 'DY', 'RH', 'AN']) expect(COUNTRY_CODES, c).not.toContain(c)
    expect(COUNTRY_CODES).toContain('GB')
    expect(COUNTRY_CODES).toContain('XK')
  })

  it('answers membership', () => {
    expect(isCountryCode('GB')).toBe(true)
    expect(isCountryCode('UK')).toBe(false)
    expect(isCountryCode('gb')).toBe(false)
  })
})

describe('COUNTRY_ALIASES', () => {
  it('maps common non-ISO spellings to real codes, keyed lower-case', () => {
    expect(COUNTRY_ALIASES['uk']).toBe('GB')
    expect(COUNTRY_ALIASES['britain']).toBe('GB')
    expect(COUNTRY_ALIASES['usa']).toBe('US')
    for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
      expect(alias).toBe(alias.toLowerCase())
      expect(isCountryCode(code), `${alias} -> ${code}`).toBe(true)
    }
  })
})
