import type { AnchorHTMLAttributes } from "react";
// This isolated fixture tests popup interactions, not Next.js navigation.
export default function FixtureLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement>,
) {
  return <a {...props} />;
}
