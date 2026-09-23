// The mark shipped with nothing watching it, and two defects got through in one evening.
//
// `logo.svg` went out with a double hyphen inside an XML comment. XML forbids that, so a
// browser refuses the whole file — in silence. On a favicon a refused file looks like no
// icon rather than a broken one, which is indistinguishable from not having shipped yet.
//
// And `favicon.ico` stayed at a blue placeholder no palette entry accounts for, behind a
// `sizes` attribute nothing held to the file's real contents. A browser trusts `sizes` to
// choose an entry without parsing the file, so an attribute that lies costs a request and
// returns nothing usable.
//
// Each check therefore watches the channel the bug travels on: the SVG goes through a real
// XML parser, and the ICO through a byte reader that knows only the format. That reader is
// written here rather than imported from `scripts/make-favicon.ts` on purpose — a shared
// one would agree with the writer about a bug as readily as about the format.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(packageRoot, rel), 'utf8')

/** The palette, off the file that defines it — so a token moving is what fails, not a copy of it. */
const tokens = new Map<string, string>()
for (const line of read('src/styles.css').split('\n')) {
  const found = /^\s*--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/.exec(line)
  if (found) tokens.set(found[1]!, found[2]!.toUpperCase())
}
const token = (name: string) => {
  const hex = tokens.get(name)
  if (!hex) throw new Error(`src/styles.css no longer defines --color-${name}`)
  return hex
}

interface Entry {
  readonly width: number
  readonly height: number
  readonly bpp: number
  /** Top-down RGBA, so a pixel lookup here reads the way the image looks. */
  readonly rgba: Buffer
}

function readIco(bytes: Buffer): Entry[] {
  expect(bytes.readUInt16LE(0), 'ICONDIR reserved field').toBe(0)
  expect(bytes.readUInt16LE(2), 'ICONDIR type (1 = icon)').toBe(1)
  const count = bytes.readUInt16LE(4)
  expect(count).toBeGreaterThan(0)
  const entries: Entry[] = []
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16
    const width = bytes[at] || 256
    const height = bytes[at + 1] || 256
    const size = bytes.readUInt32LE(at + 8)
    const offset = bytes.readUInt32LE(at + 12)
    expect(offset + size, `entry ${i} runs past the end of the file`).toBeLessThanOrEqual(bytes.length)
    const bpp = bytes.readUInt16LE(offset + 14)
    expect(bytes.readInt32LE(offset + 8), `entry ${i} biHeight carries the AND mask`).toBe(height * 2)
    const rgba = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = offset + 40 + ((height - 1 - y) * width + x) * 4
        const to = (y * width + x) * 4
        rgba[to] = bytes[from + 2]!
        rgba[to + 1] = bytes[from + 1]!
        rgba[to + 2] = bytes[from]!
        rgba[to + 3] = bytes[from + 3]!
      }
    }
    entries.push({ width, height, bpp, rgba })
  }
  return entries
}

/** Opaque pixels of exactly this colour. Antialiased edges are blends, so an exact count
 *  above zero means the raster carries the token itself, not something near it. */
const countExact = (entry: Entry, hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  let n = 0
  for (let i = 0; i < entry.rgba.length; i += 4) {
    if (entry.rgba[i] === r && entry.rgba[i + 1] === g && entry.rgba[i + 2] === b && entry.rgba[i + 3] === 255) n++
  }
  return n
}

const shell = new DOMParser().parseFromString(read('index.html'), 'text/html')
const icons = [...shell.querySelectorAll('link[rel="icon"]')]
const ico = readIco(readFileSync(resolve(packageRoot, 'public/favicon.ico')))
const largest = ico.reduce((a, b) => (b.width > a.width ? b : a))

describe('the mark as a vector', () => {
  it('is XML a browser will accept', () => {
    const doc = new DOMParser().parseFromString(read('public/logo.svg'), 'image/svg+xml')
    // A parse failure is not an exception here; it is a document whose root says so, which
    // is exactly how the browser reports it and exactly why the bad file looked like nothing.
    expect(doc.querySelector('parsererror')?.textContent ?? null).toBeNull()
    expect(doc.documentElement.nodeName).toBe('svg')
  })

  it('is drawn in the palette, not near it', () => {
    const svg = read('public/logo.svg').toUpperCase()
    for (const name of ['ink-950', 'ink-400', 'signal-300']) {
      expect(svg, `logo.svg does not use --color-${name}`).toContain(token(name))
    }
  })
})

describe('the mark as an icon', () => {
  it('offers every size index.html promises, and no others', () => {
    const declared = icons
      .flatMap((l) => (l.getAttribute('sizes') ?? '').split(/\s+/))
      .filter(Boolean)
      .map((s) => Number(s.split('x')[0]))
    expect(declared.length, 'no rel=icon link declares any size').toBeGreaterThan(0)
    expect(ico.map((e) => e.width).sort((a, b) => a - b)).toEqual([...declared].sort((a, b) => a - b))
  })

  it('is square, 32bpp, and every entry lies inside the file', () => {
    for (const entry of ico) {
      expect(entry.width).toBe(entry.height)
      expect(entry.bpp, `${entry.width}px entry`).toBe(32)
    }
  })

  it('is the same drawing as the vector, in the same three tones', () => {
    for (const name of ['ink-950', 'ink-400', 'signal-300']) {
      expect(countExact(largest, token(name)), `${largest.width}px entry has no ${name} pixel`).toBeGreaterThan(0)
    }
    // The tile is rounded, so its corner is outside the shape. This is what separates the
    // mark from any square placeholder that happens to use the right colours.
    expect(largest.rgba[3], 'the top-left corner is opaque, so the tile is not rounded').toBe(0)
  })

  it('offers the SVG after the .ico, so a browser that takes it sees it last', () => {
    const svgLink = icons.findIndex((l) => l.getAttribute('type') === 'image/svg+xml')
    const icoLink = icons.findIndex((l) => (l.getAttribute('href') ?? '').endsWith('.ico'))
    expect(icoLink, 'no .ico link').toBeGreaterThanOrEqual(0)
    expect(svgLink, 'no SVG link').toBeGreaterThanOrEqual(0)
    expect(svgLink, 'the SVG link is declared before the .ico').toBeGreaterThan(icoLink)
  })
})
