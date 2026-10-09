import { describe, it, expect } from 'vitest'
import { COUNTRY_CODES } from '@tickover/contract'
import { countryName, filterCountries } from '../../src/app/lib/countries'

describe('countries', () => {
  it('names a code in English', () => {
    expect(countryName('GB')).toBe('United Kingdom')
    expect(countryName('VN')).toBe('Vietnam')
  })
  it('finds the United Kingdom by code, alias and name', () => {
    for (const q of ['gb', 'GB', 'uk', 'britain', 'united k']) expect(filterCountries(q)[0], q).toBe('GB')
  })
  it('matches without accents and by any word of the name', () => {
    expect(filterCountries('cote')).toContain('CI')
    expect(filterCountries('zealand')).toContain('NZ')
  })
  it('only ever offers real codes', () => {
    for (const q of ['', 'u', 'qq', 'uk', 'xx']) for (const c of filterCountries(q)) expect(COUNTRY_CODES).toContain(c)
    expect(filterCountries('qq')).toEqual([])
  })
  it('lists everything, by name, for an empty query', () => {
    const all = filterCountries('')
    expect(all).toHaveLength(COUNTRY_CODES.length)
    expect(all[0]).toBe('AF') // Afghanistan
  })
})
