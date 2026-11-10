import changelog from "../../../src/changelog.json";
import { ArrowUpRight } from "../icons";
import { Highlights } from "../News";
import { FIXES, RELEASE } from "../release";
import { mount, Page } from "../Page";
import { REPO, Rise } from "../Sections";

const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function WhatsNew() {
  return (
    <Page color="#ff48b0" title="What's new" lead={<>What Crest {RELEASE} brings, then every version since the first one, as the app's own What's new page lists them.</>}>
      <section className="sec news news-page" aria-labelledby="release-title">
        <Rise><h2 id="release-title">Crest {RELEASE}</h2></Rise>
        <Highlights base="/" />
        <Rise className="fixes">
          <h3>Also fixed</h3>
          <ul>
            {FIXES.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </Rise>
      </section>

      <section className="sec history" aria-labelledby="history-title">
        <Rise><h2 id="history-title">Every version</h2></Rise>
        <ol className="versions">
          {changelog.map((v) => (
            <li key={v.version} className="version">
              <div className="version-head">
                <h3>{v.version}</h3>
                <p><time dateTime={v.date}>{date(v.date)}</time></p>
                <a className="textlink" href={`${REPO}/releases/tag/v${v.version}`}>Release notes <ArrowUpRight size={16} weight="bold" aria-hidden="true" /></a>
              </div>
              <ul>
                {v.items.map((it) => <li key={it.en}>{it.en}</li>)}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </Page>
  );
}

mount(<WhatsNew />);
