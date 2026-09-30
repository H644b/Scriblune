import Link from "next/link";
import { Logo } from "@/components/brand";
export const metadata = {
  title: "Privacy and your work",
  alternates: { canonical: "/privacy" },
};
export default function Page() {
  return (
    <>
      <header className="desk-header">
        <Logo />
        <Link href="/">Back home</Link>
      </header>
      <main className="prose-page">
        <span className="eyebrow">YOUR WORK DESERVES CARE</span>
        <h1>Privacy, in plain words.</h1>
        <p>
          This policy describes the current adult pilot implementation. The
          operator must confirm retention, support ownership, provider
          agreements, and applicable requirements before opening the pilot.
        </p>
        <h2>Your assignments and conversation</h2>
        <p>
          Private sessions require an account. Originals, rendered pages,
          annotations, messages, rubrics, reviews, and final versions are stored
          in private Supabase resources. Uploaded files are preserved unchanged.
          The app uses ownership checks and database row policies to restrict
          access.
        </p>
        <h2>AI processing</h2>
        <p>
          After the upload disclosure, relevant document text, page images,
          selected crops, annotations, conversation, and enabled learning
          preferences may be sent to the configured OpenAI API for tutoring,
          visual indexing, or review. API requests use store:false. That setting
          does not override the provider’s applicable processing or
          abuse-monitoring retention terms. No privileged credentials are
          included in tutor context.
        </p>
        <h2>Private session feedback</h2>
        <p>
          Your feedback is private to the Scriblune team and linked to your
          account. It will not appear in your session history. Authorized staff
          may review feedback and internal issue tags; access is audited. After
          you send it, stored feedback is not available through student APIs,
          Realtime, search, normal exports, or the tutor. Your browser can see
          the answers while you type and transmit them.
        </p>
        <h2>Local storage and microphones</h2>
        <p>
          The sample workspace saves only sample work on this device. Optional
          recovery for a private session temporarily stores unsaved drawing
          actions in the current browser tab, with a visible opt-in. Recovery
          data is cleared on save or sign-out. Browser dictation starts only
          when you activate it and may use the browser or device vendor’s speech
          service.
        </p>
        <h2>Retention and privacy requests</h2>
        <p>
          The default implementation retains saved sessions and feedback until a
          governed deletion request is completed; it does not silently expire
          your work. Request access, correction, or account deletion from your
          account preferences. Authorized staff must verify the request, address
          applicable obligations, remove storage objects and database records as
          appropriate, and record completion. Backups and provider retention
          follow the configured services’ policies.
        </p>
        <h2>Age eligibility</h2>
        <p>
          The pilot is restricted to adults 18 and older. It does not offer a
          guardian-consent workflow or access for minors. The app does not claim
          educational, privacy, or accessibility certification.
        </p>
        <h2>Contact</h2>
        <p>
          {process.env.SUPPORT_EMAIL ? (
            <a href={`mailto:${process.env.SUPPORT_EMAIL}`}>
              {process.env.SUPPORT_EMAIL}
            </a>
          ) : (
            "The operator must configure a support contact before launch. Signed-in pilot users can submit a privacy request in account preferences."
          )}
        </p>
        <Link className="button secondary" href="/account">
          Manage your preferences
        </Link>
      </main>
    </>
  );
}
