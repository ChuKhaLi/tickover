/**
 * Redraws `public/favicon.ico` from `public/logo.svg`.
 *
 *     pnpm --filter @tickover/web favicon
 *
 * The .ico is a raster of the vector, so a change to the mark or to the palette it draws
 * from leaves the two disagreeing — and nothing about a stale icon looks wrong, which is
 * how the blue placeholder this replaced survived to the eve of launch.
 * `test/unit/icon.spec.ts` fails when they drift; this is how they are made to agree again.
 *
 * Each size is rasterised AT that size rather than resampled from 64. Measured at 16px:
 * the chevron's stroke reaches 0xa0 against ink-400's own 0xa3, so it needs no hinting,
 * and widening the stroke to 8 only fattens it (22 pixels above half brightness against
 * 12) and blunts the point. So the SVG stays the single source and nothing is hand-tuned.
 *
 * 32bpp BMP entries rather than PNG-in-ICO: the only readers that still reach for this
 * file are the ones too old to take the SVG, and some of those predate PNG-in-ICO.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 16 and 32 are the tab and the bookmark row; 48 is what Windows asks for a shortcut. */
const SIZES = [16, 32, 48] as const

interface Raster {
  readonly size: number
  readonly rgba: Buffer
}

function icoFrom(rasters: readonly Raster[]): Buffer {
  const bodies = rasters.map(({ size, rgba }) => {
    // 1bpp AND mask, rows padded to 4 bytes. Left all-zero: a 32bpp entry carries its own
    // alpha, and every reader that understands 32bpp reads it there.
    const maskRow = Math.ceil(size / 32) * 4
    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0)
    header.writeInt32LE(size, 4)
    header.writeInt32LE(size * 2, 8) // XOR and AND stacked, so twice the height
    header.writeUInt16LE(1, 12)
    header.writeUInt16LE(32, 14)
    header.writeUInt32LE(size * size * 4 + maskRow * size, 20)
    const xor = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const from = ((size - 1 - y) * size + x) * 4 // bottom-up, as the format has it
        const to = (y * size + x) * 4
        xor[to] = rgba[from + 2]!
        xor[to + 1] = rgba[from + 1]!
        xor[to + 2] = rgba[from]!
        xor[to + 3] = rgba[from + 3]!
      }
    }
    return Buffer.concat([header, xor, Buffer.alloc(maskRow * size)])
  })

  const dir = Buffer.alloc(6 + rasters.length * 16)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(rasters.length, 4)
  let offset = dir.length
  rasters.forEach(({ size }, i) => {
    const at = 6 + i * 16
    dir[at] = size
    dir[at + 1] = size
    dir.writeUInt16LE(1, at + 4)
    dir.writeUInt16LE(32, at + 6)
    dir.writeUInt32LE(bodies[i]!.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += bodies[i]!.length
  })
  return Buffer.concat([dir, ...bodies])
}

const svg = readFileSync(resolve(packageRoot, 'public/logo.svg'), 'utf8')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent('<canvas id="c"></canvas>')
  const rasters: Raster[] = []
  for (const size of SIZES) {
    const sized = svg.replace('width="64" height="64"', `width="${size}" height="${size}"`)
    if (sized === svg) throw new Error('logo.svg no longer states width="64" height="64"')
    const pixels = await page.evaluate(
      async ({ markup, side }: { markup: string; side: number }) => {
        const img = new Image()
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
        await img.decode()
        const canvas = document.getElementById('c') as HTMLCanvasElement
        canvas.width = side
        canvas.height = side
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, side, side)
        ctx.drawImage(img, 0, 0, side, side)
        return Array.from(ctx.getImageData(0, 0, side, side).data)
      },
      { markup: sized, side: size },
    )
    rasters.push({ size, rgba: Buffer.from(pixels) })
  }
  const ico = icoFrom(rasters)
  writeFileSync(resolve(packageRoot, 'public/favicon.ico'), ico)
  console.log(`public/favicon.ico: ${SIZES.join('/')} px, ${ico.length} bytes`)
} finally {
  await browser.close()
}
