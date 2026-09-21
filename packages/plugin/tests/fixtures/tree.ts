/** A rendered tree's text as it reads: its string children and each Button's label, in order. */
export function textOf(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (typeof tree !== 'object' || tree === null) return ''
  const props = Reflect.get(tree, 'props') as Record<string, unknown> | undefined
  const label = typeof props?.label === 'string' ? props.label : ''
  return `${label}${textOf(Reflect.get(tree, 'children') ?? [])}`
}

/** The first Button in a rendered tree whose key is `key`, as a plain record, or undefined. */
export function buttonIn(tree: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof tree !== 'object' || tree === null) return undefined
  if (Array.isArray(tree)) return tree.map((t) => buttonIn(t, key)).find((b) => b !== undefined)
  const props = Reflect.get(tree, 'props') as Record<string, unknown> | undefined
  if (Reflect.get(tree, 'type') === 'Button' && props?.key === key) return props
  return buttonIn(Reflect.get(tree, 'children') ?? [], key)
}
