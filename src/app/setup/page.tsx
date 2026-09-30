import Link from "next/link";
import { Check, Minus, ArrowUpRight } from "lucide-react";
import { setupState } from "@/lib/server/config";
import { Logo } from "@/components/brand";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Connection status",
  robots: { index: false, follow: false },
};
export default function Page() {
  const s = setupState();
  return (
    <>
      <header className="desk-header">
        <Logo />
        <Link href="/demo">Explore sample workspace</Link>
      </header>
      <main className="prose-page">
        <span className="eyebrow">HONESTLY, HERE’S WHERE THINGS STAND</span>
        <h1>
          A desk ready
          <br />
          to be connected.
        </h1>
        <p>
          The sample workspace works without credentials. Private sessions and
          AI tutoring need the services below. A configured value does not prove
          that a service or migration is working.
        </p>
        <ul className="setup-list">
          {[
            { name: "Supabase authentication", ready: s.auth },
            { name: "Private database connection", ready: s.database },
            { name: "Private file storage", ready: s.storage },
            { name: "AI tutor model and API key", ready: s.tutor },
            { name: "AI review model and API key", ready: s.review },
            { name: "Adult pilot enabled", ready: s.pilot },
          ].map((i) => (
            <li key={i.name}>
              {i.ready ? <Check size={18} /> : <Minus size={18} />}
              <span>{i.name}</span>
              <small>{i.ready ? "Configured" : "Setup required"}</small>
            </li>
          ))}
        </ul>
        <h2>For the site owner</h2>
        <p>
          Follow the repository README to inspect the existing Supabase schema,
          apply additive migrations, provision a restricted database login,
          connect the AI provider, and run the document worker. Secrets belong
          in the server environment, never in browser variables or chat.
        </p>
        <p>
          The default pilot is limited to adults 18 and older. It remains closed
          until the operator reviews privacy, retention, age eligibility,
          support, and launch checks.
        </p>
        <Link className="button primary" href="/demo">
          Explore the workspace
        </Link>
      </main>
    </>
  );
}
