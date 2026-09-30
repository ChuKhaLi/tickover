import type { Preview } from '@storybook/angular'
import './preview.css'
// The toolbar theme switch sets data-theme on the preview root, the same mechanism the outreach app
// uses; see preview.css for why the workshop may do this and the web may not.
const preview: Preview = {
  parameters: { layout: 'padded', controls: { expanded: true }, backgrounds: { disable: true } },
  globalTypes: { theme: { description: 'Theme', toolbar: { icon: 'mirror', items: ['light', 'dark'] } } },
  initialGlobals: { theme: 'light' },
  decorators: [(story, ctx) => { document.documentElement.dataset['theme'] = ctx.globals['theme']; return story() }],
}
export default preview
