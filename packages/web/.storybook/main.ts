import type { StorybookConfig } from '@analogjs/storybook-angular'

/**
 * `@analogjs/storybook-angular` rather than `@storybook/angular` alone, and the
 * reason is specific (stack.md, R307): the plain Angular framework builds through
 * `@angular-devkit`, which would be a fourth build of these components — divergent
 * from the Vite build that ships, in a repository where source and `dist/` have
 * already drifted apart three times, each time invisibly. This compiles stories
 * with `@analogjs/vite-plugin-angular`, the same plugin the application and the
 * vitest suite use, so the workshop and the product agree by construction.
 *
 * Stories live beside the components they document. `src/styles.css` excludes them
 * from Tailwind's scan, so a class used only in a story is a class that never
 * ships — which is the rule, not an accident: stories are not a second source of
 * truth for styling.
 */
const config: StorybookConfig = {
  stories: ['../src/app/ui/**/*.stories.ts'],
  addons: [],
  framework: { name: '@analogjs/storybook-angular', options: {} },
}

export default config
