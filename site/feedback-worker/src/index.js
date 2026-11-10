// The Worker on crestisland.app/api/feedback. The only file that touches Cloudflare; the report logic is in handle.js.
import { EmailMessage } from 'cloudflare:email';
import { handle, passed } from './handle.js';
import { buildMime } from './mime.js';

const FROM = 'feedback@crestisland.app';

const realDeps = (env) => ({
  async verifyTurnstile(token, ip) {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const result = await res.json();
    // Nothing else tells the developer that the secret is wrong
    if (!result.success) console.error('Turnstile refused the token:', result['error-codes']);
    else if (!passed(result)) console.error('Turnstile token from another host:', result.hostname);
    return passed(result);
  },
  async send(message) {
    try {
      await env.EMAIL.send(new EmailMessage(FROM, env.FEEDBACK_TO, buildMime({ from: FROM, to: env.FEEDBACK_TO, ...message })));
    } catch (e) {
      console.error('send_email failed:', e?.message);
      throw e;
    }
  },
});

export default {
  fetch: (request, env) => handle(request, env, realDeps(env)),
};
