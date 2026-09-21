import '@angular/platform-server/init'
import { render } from '@analogjs/router/server'

import { App } from './app/app'
import { config } from './app/app.config.server'

// Not an SSR runtime: `ssr: false` keeps the server bundle out of production.
// Analog still builds this environment because prerendering renders each route
// once at build time (`vite-plugin-nitro.js:342` — the ssr environment is built
// when `ssr` OR `prerender.routes` is set).
export default render(App, config)
