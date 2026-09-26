/**
 * The study the hero replica composes. A plausible one rather than a clever one: the sponsor is a
 * name a buyer would type, which is the case spec 4.7 and the vietnamese font subsets both exist
 * for.
 *
 * **Here rather than on the component, and that is the whole reason this module exists.** The width
 * at which this question stops being shown is a function of its own length, and
 * `e2e/public.spec.ts` asserts the browser honours that width -- so the test has to compose the
 * same study the page holds. Importing it from `index.page.ts` pulls an Angular component into a
 * Node process, which fails at run time with `PlatformLocation needs to be compiled using the JIT
 * compiler`. A copy of these three values in the test would be a second thing to keep in step,
 * which is how the literal it replaced went stale (R383).
 */
export const HERO_STUDY = {
  sponsor: 'Raycast',
  question: 'Which terminal do you reach for first?',
  options: ['iTerm2', 'Ghostty', 'Warp'],
} as const
