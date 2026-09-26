import '@angular/platform-server/init'
import { render } from '@analogjs/router/server'

import { App } from './app/app'
import { config } from './app/app.config.server'

// The prerender renderer, not an SSR runtime (R400, which supersedes R42 (plan 2)).
// Each public route is rendered once at build time and shipped as a plain file;
// no server bundle runs in production. (This file is in Tailwind's scan, so its
// comments avoid words that name a utility.)
export default render(App, config)
