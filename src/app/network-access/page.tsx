import { NetworkNotice } from "@/components/network-session-guard";
export const metadata = {
  title: "Check your connection",
  robots: { index: false, follow: false },
};
export default function NetworkAccess() {
  return <NetworkNotice />;
}
