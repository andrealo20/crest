import { mount, Page } from "../Page";

function NotFound() {
  return (
    <Page color="#ff6b6b" title="Nothing here" lead={<>This page does not exist, or it moved. The <a href="/">home page</a> has the demo, and <a href="/whats-new/">What's new</a> the latest version.</>}>
      <span />
    </Page>
  );
}

mount(<NotFound />);
