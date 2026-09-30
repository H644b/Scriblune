import { PasswordPanel } from "@/components/account-panel";
export const metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <PasswordPanel />;
}
