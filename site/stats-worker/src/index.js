// The Worker on crestisland.app/api/ping and /api/stats. The only file that touches Cloudflare; the rules are in handle.js.
import { handle, utcDay } from './handle.js';
import { d1Store } from './store.js';

export default {
  fetch: (request, env) => handle(request, d1Store(env.DB), { country: request.cf?.country }),
  scheduled: (_event, env, ctx) => ctx.waitUntil(d1Store(env.DB).prune(utcDay(new Date()))),
};
