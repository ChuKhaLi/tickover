import { Directive, computed, input } from '@angular/core'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet'
export type ButtonSize = 'md' | 'sm'

/**
 * Full class strings, never composed. Tailwind reads this file as text, so a name
 * assembled at runtime is a name it never sees and never emits — `study-badge.ts`
 * keys a `Record` over its union for the same reason, and a `Record` over the union
 * also fails to compile when a variant is added without its classes.
 *
 * `primary` is a bright fill with near-black ink rather than the dark fill with
 * white text almost every product ships (R316): the dark fill is what set the page
 * tone heavy, and it was wasting contrast headroom -- 8.06 against the deep fill's
 * 7.33, so the lighter button is better on the one axis that can be measured. It is
 * the same fill in both themes, which is why none of these carries a `dark:` twin.
 *
 * `secondary` has no fill at all, so its edge is the entire affordance -- the only
 * thing on the page saying a control is here. WCAG 1.4.11 asks 3.0 of that, and the
 * step this system first reached for measured 1.41. It is `ink-500` light and
 * `ink-400` dark for that reason and no other; `tokens.spec.ts` reads this string and
 * measures it against both grounds, so a lighter one goes red rather than shipping.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-signal-400 text-ink-950 hover:bg-signal-300',
  secondary: 'border border-ink-500 text-ink-800 hover:bg-ink-100 dark:border-ink-400 dark:text-ink-100 dark:hover:bg-ink-800',
  danger: 'bg-rejected-fg text-white hover:bg-rejected-fg-hover',
  quiet: 'text-signal-600 underline hover:text-signal-700 dark:text-signal-300 dark:hover:text-signal-200',
}

/**
 * A link inside a sentence, which `quiet` cannot be. `quiet` is a standalone text
 * action and carries this file's layout classes, and `inline-flex` mid-paragraph
 * gives the link text a line box of its own -- so a long link stops wrapping with
 * the prose around it and runs past the measure. Two anchors in the app are this
 * rather than an action, and naming the role is what stops a third being invented.
 */
@Directive({
  selector: 'a[tk-link]',
  host: { class: 'underline text-signal-600 hover:text-signal-700 dark:text-signal-300 dark:hover:text-signal-200' },
})
export class Link {}

/** 44px is the floor; `sm` is bumped to it by a pointer query in `styles.css`. */
const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-11 rounded-control px-4 py-2 text-small font-medium',
  sm: 'min-h-9 rounded-control px-3 py-1.5 text-small font-medium',
}

const ALWAYS =
  'inline-flex cursor-pointer items-center justify-center gap-2 no-underline transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 dark:focus-visible:outline-signal-400'

/**
 * A directive on a real `<button>` or `<a>`, not a component that wraps one.
 *
 * That is the load-bearing choice here. A wrapper puts an element between the
 * caller and the control, and this application depends on the control being the
 * element: `/app/login` reads its address off a template reference on the input's
 * sibling and submits a native `<form>`, and its spec queries
 * `button[type=submit]` and reads `.disabled` off what it finds. With a directive,
 * `type`, `disabled`, form submission, focus and the accessibility tree are the
 * platform's, and every one of those specs keeps working unchanged. Angular
 * Material's `mat-button` is the same shape for the same reason.
 *
 * Retires six primary-blue shapes, three secondary edge shades and four
 * destructive shapes (design system 6.2), and the `/app` anchor styled as a
 * primary button with no disabled state -- an `<a>` cannot be disabled, which is
 * itself the reason that page's "New study" should be a link that looks like one
 * or a button that behaves like one.
 */
@Directive({
  selector: 'button[tk-button], a[tk-button]',
  host: {
    '[class]': 'classes()',
    '[attr.data-tk-control]': '""',
  },
})
export class Button {
  variant = input<ButtonVariant>('primary')
  size = input<ButtonSize>('md')
  classes = computed(() => `${ALWAYS} ${SIZE[this.size()]} ${VARIANT[this.variant()]}`)
}
