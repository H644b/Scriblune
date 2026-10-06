import Link from "next/link";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
export default function NotFound() {
  return (
    <>
      <header className="desk-header">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="not-found-page">
        <span className="eyebrow">A SMALL DETOUR</span>
        <h1>This page wandered off.</h1>
        <p>
          The link may have changed. Your study desk is still here when you’re
          ready.
        </p>
        <Link className="button primary" href="/">
          Back to Scriblune
        </Link>
      </main>
    </>
  );
}
