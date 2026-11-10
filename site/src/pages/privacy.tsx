import policy from "../../../PRIVACY.md?raw";
import { markdown } from "../md";
import { mount, Page } from "../Page";
import { REPO, SUPPORT } from "../Sections";

// The repository's own file, so the page and GitHub never say different things. It holds the policy's H1, which the page header replaces.
const html = markdown(policy.replace(/^# [^\n]*\n/, ""));

function Privacy() {
  return (
    <Page color="#ffc75f" title="Privacy" lead="Crest has no account, no server of its own and no tracking. This page says what the website does, then what the app keeps and sends.">
      <section className="sec prose" aria-labelledby="site-title">
        <h2 id="site-title">This website</h2>
        <p>
          crestisland.app is served by Cloudflare Pages. Its fonts, scripts, images and the demo come from this address only. It sets no cookies, stores nothing in your browser (the demo keeps its settings and notes in memory, so a reload starts fresh) and runs no analytics.
        </p>
        <p>
          Cloudflare handles the requests on Andrea Loroni's behalf and, like any web host, sees your IP address and the pages you ask for. Its own privacy policy covers that.
        </p>
        <p>
          The <a href="/feedback/">Report a problem</a> form is the one place you send something. Before the form sends, Cloudflare Turnstile checks that a person is filling it in, which loads a script and a frame from challenges.cloudflare.com on that page only. What you write, your email address if you give one and the files you attach go by email to the developer and are used only to answer you and fix the problem. Nothing is kept on the website. To have a report deleted, write to <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.
        </p>
      </section>
      <section className="sec prose policy" aria-label="The app's privacy policy">
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <p className="source">
          The same text is in the repository: <a href={`${REPO}/blob/main/PRIVACY.md`}>PRIVACY.md</a>.
        </p>
      </section>
    </Page>
  );
}

mount(<Privacy />);
