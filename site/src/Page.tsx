import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Footer, Nav, Rise } from "./Sections";
import "./styles.css";
import "./pages.css";

/** A page other than the home page: the nav and a title on a block of colour, the content, then the footer. */
export function Page({ color, title, lead, children }: { color: string; title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div id="top">
      <a className="skip" href="#content">Skip to the content</a>
      <div className="page-head" style={{ background: color }}>
        <Nav />
        <div className="page-title">
          <Rise><h1>{title}</h1></Rise>
          {lead && <Rise i={1}><p className="lead">{lead}</p></Rise>}
        </div>
      </div>
      <main id="content" className="page-body">{children}</main>
      <Footer />
    </div>
  );
}

/** Mounts a page into #root. */
export function mount(node: React.ReactNode) {
  createRoot(document.getElementById("root")!).render(<StrictMode>{node}</StrictMode>);
}
