/// <reference types="vitest" />
import angular from '@analogjs/vite-plugin-angular'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The Angular plugin is added only under vitest: @analogjs/storybook-angular adds its own, and two
// instances of it compile every component twice.
export default defineConfig(() => ({
  plugins: [...(process.env['VITEST'] ? [angular({ tsconfig: 'tsconfig.spec.json' })] : []), tailwindcss()],
  test: { globals: true, environment: 'jsdom', setupFiles: ['test/setup.ts'], include: ['test/**/*.spec.ts'] },
}))
