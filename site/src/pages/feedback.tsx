import { useEffect, useRef, useState } from "react";
import { ENDPOINT, FIELDS, type Field, TURNSTILE_SITE_KEY, validate } from "../feedback";
import { mount, Page } from "../Page";
import { REPO, SUPPORT } from "../Sections";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void };
  }
}

/** Turnstile's script, loaded on this page only (the site's CSP allows challenges.cloudflare.com for it). */
function useTurnstile(box: React.RefObject<HTMLDivElement | null>) {
  const id = useRef<string | undefined>(undefined);
  useEffect(() => {
    const render = () => {
      if (box.current && window.turnstile && id.current === undefined) id.current = window.turnstile.render(box.current, { sitekey: TURNSTILE_SITE_KEY, theme: "light" });
    };
    if (window.turnstile) return render();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = render;
    document.head.append(s);
  }, [box]);
  return () => window.turnstile?.reset(id.current);
}

function Feedback() {
  const form = useRef<HTMLFormElement>(null);
  const widget = useRef<HTMLDivElement>(null);
  const reset = useTurnstile(widget);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const el = e.currentTarget.elements as unknown as Record<Field, HTMLInputElement & HTMLTextAreaElement>;
    const found = validate({
      message: el.message.value,
      email: el.email.value,
      version: el.version.value,
      system: el.system.value,
      files: [...(el.attachments.files ?? [])],
    });
    setErrors(found);
    const first = FIELDS.find((f) => found[f]);
    if (first) return el[first].focus();

    setState("sending");
    let sent = false;
    try {
      sent = (await fetch(ENDPOINT, { method: "POST", body: new FormData(e.currentTarget) })).status === 200;
    } catch {
      // offline or blocked: the same answer as a refusal
    }
    setState(sent ? "sent" : "failed");
    if (!sent) reset(); // a token works once
  };

  const field = (name: Field, label: string, input: React.ReactNode, hint?: string) => (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {hint && <p className="hint" id={`${name}-hint`}>{hint}</p>}
      {input}
      {errors[name] && <p className="error" id={`${name}-error`}>{errors[name]}</p>}
    </div>
  );
  const described = (name: Field, hint = false) => [hint && `${name}-hint`, errors[name] && `${name}-error`].filter(Boolean).join(" ") || undefined;

  return (
    <Page color="#00b38f" title="Report a problem" lead={<>Something broke, or does not behave as it should? Tell the developer here. If you have a GitHub account, an <a href={`${REPO}/issues/new/choose`}>issue</a> lets others follow it too.</>}>
      <section className="sec form-sec" aria-label="The report">
        {state === "sent" ? (
          <p className="lead" role="status">Thanks, your report reached the developer. If you left an address, the answer comes from {SUPPORT}.</p>
        ) : (
          <form ref={form} className="report" onSubmit={submit} noValidate>
            {field("message", "What happened?", <textarea id="message" name="message" rows={8} maxLength={5000} required aria-invalid={!!errors.message} aria-describedby={described("message", true)} />, "What you did, what you expected and what Crest did instead. Copy diagnostics, in Settings, General, Updates, gives the version, the system and your settings with no personal data, ready to paste here.")}
            {field("email", "Your email, for an answer (optional)", <input id="email" name="email" type="email" autoComplete="email" maxLength={254} aria-invalid={!!errors.email} aria-describedby={described("email")} />)}
            {field("attachments", "Screenshots or logs (optional)", <input id="attachments" name="attachments" type="file" multiple accept=".log,.txt,.png,.jpg" aria-invalid={!!errors.attachments} aria-describedby={described("attachments", true)} />, "Up to 10 files, 3 MB in all: .png, .jpg, .txt or .log. The crash log is crash.log in the logs folder of Crest's data folder.")}
            <div className="field-row">
              {field("version", "Crest version (optional)", <input id="version" name="version" maxLength={32} placeholder="1.1.0" aria-invalid={!!errors.version} aria-describedby={described("version", true)} />, "Settings, General, Updates.")}
              {field("system", "System (optional)", <input id="system" name="system" maxLength={32} placeholder="Windows 11 24H2" aria-invalid={!!errors.system} aria-describedby={described("system")} />)}
            </div>
            <div ref={widget} className="turnstile" />
            <button className="btn" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send the report"}</button>
            <p role="status" className="status">
              {state === "failed" && <>The report could not be sent. Please try again later, or write to <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.</>}
            </p>
            <p className="small">The report goes by email to the developer and is used only to answer you and fix the problem. See the <a href="/privacy/">privacy policy</a>.</p>
          </form>
        )}
      </section>
    </Page>
  );
}

mount(<Feedback />);
