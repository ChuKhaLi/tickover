import type { StorybookConfig } from '@analogjs/storybook-angular'
// Same framework as packages/web (R307): stories compile through the Vite Angular plugin the apps use.
const config: StorybookConfig = { stories: ['../src/**/*.stories.ts'], addons: [], framework: { name: '@analogjs/storybook-angular', options: {} } }
export default config
