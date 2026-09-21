import type { Preview } from '@storybook/angular'

/**
 * The one stylesheet the application ships, imported rather than reproduced.
 *
 * This is the whole of the workshop's styling setup, and deliberately so: a story
 * that reached for a hex, or a `.storybook` stylesheet of its own, would make the
 * workshop a second source of truth for the tokens and let it drift from the
 * product silently — the failure this repository has had three times in other
 * shapes. Everything a story can see is what a page can see.
 */
import '../src/styles.css'

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    // No `backgrounds` addon. The page ground is a token — `ink-50` on paper,
    // `ink-900` in the dark theme — so letting the toolbar paint an arbitrary
    // colour behind a component would show it on a surface that does not exist.
    backgrounds: { disable: true },
    options: { storySort: { order: ['Primitives'] } },
  },
}

/**
 * **Seeing the dark theme.** `dark:` follows `prefers-color-scheme` and nothing
 * else, so there is no toolbar toggle: emulate the media query in devtools
 * (Rendering → Emulate CSS prefers-color-scheme). That is not an omission. Making
 * the variant accept an explicit override as well was measured at **+8,005 bytes,
 * a 31% increase** on the shipped stylesheet, for a capability the product does not
 * yet have — and `stack.md` is explicit that the workshop must not drive the
 * product's CSS. `src/styles.css` carries the number.
 *
 * The dark theme's actual guard is in `e2e/`, where Playwright emulates the same
 * media query against the built artifact.
 */
export default preview
