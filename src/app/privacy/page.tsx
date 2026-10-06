import { ThemeToggle } from "@/components/theme";
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
        <ThemeToggle />
      </header>
      <main className="prose-page">
        <span className="eyebrow">YOUR WORK DESERVES CARE</span>
        <h1>Privacy, in plain words.</h1>
        <p>
          This page explains what Scriblune saves, how tutoring uses your work,
          and the controls available to you.
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
        <h2>Account security and email</h2>
        <p>
          Resend delivers one-time verification codes to your email address.
          Signup requires a code. You can also enable two-factor verification
          with email codes, an authenticator app, or passkeys in account
          settings. Email codes expire after ten minutes. Security records
          contain hashed codes and encrypted temporary sessions; expired code
          records are removed after one day. Email recovery can restore account
          access.
        </p>
        <h2>Payments and usage</h2>
        <p>
          Stripe handles payment details directly. Scriblune keeps Stripe
          customer and subscription identifiers, plan status, credit balances,
          and usage records to apply your allowances. Card numbers and security
          codes do not pass through our server. The Owner can look up verified
          accounts and grant plans or bonus credits; these changes are audited.
          Billing and usage records are not public forum data or tutor context.
        </p>
        <h2>Connection checks</h2>
        <p>
          When VPN protection is enabled, our server sends your current public
          IP address to Proxycheck to check whether it is a VPN connection. We
          request that address logging be disabled. No account ID, email, study
          content or browser identifier is sent with the lookup. We temporarily
          cache the result under a protected hash for up to five minutes; our
          application logs record only the outcome. The provider also maintains
          its own detection data and short-lived service cache.
        </p>
        <p>
          A recent, high-confidence VPN result can block sign-in and end the
          current login. Detection is imperfect and can be delayed or mistaken;
          it does not prove who is using a connection. Disconnect the VPN and
          check again, or contact support. Uncertain results or service outages
          keep normal account and usage checks in place. These checks never
          change saved work or reset usage allowances.
        </p>
        <h2>Fair use of the Free allowance</h2>
        <p>
          When the Free allowance guard is enabled, verified sign-ins and new
          usage may set a random, first-party browser cookie with a fixed 30-day
          life. We store a protected hash of that identifier, distinct verified
          sign-ins and a coarse browser family. On our trusted network edge we
          may also keep a daily-changing protected hash of a coarse network
          prefix for up to seven days. We do not store the raw IP address in
          this system or use network matches alone to associate accounts.
        </p>
        <p>
          Repeated browser continuity can suggest accounts for Administrator
          review. It cannot reliably identify a person or physical computer.
          Families, schools and shared devices can produce matches. A
          conservative multi-signal rule can automatically share the five daily
          Free tutor credits and one new workspace allowance. It requires
          repeated verified account switching on two browser identifiers with
          different browser families over at least three days and 48 hours, plus
          network support on three days. When provisional protection is enabled,
          an uncertain match can also temporarily share that allowance: both
          verified accounts must be at least 24 hours old and use one browser
          identifier for at least two sign-ins each over two UTC days spanning
          12 hours, with three account switches and matching daily
          coarse-network support on both days. A third account on that browser,
          multiple eligible partners, prior corrections, existing associations,
          or paid/privileged accounts block this provisional rule. Provisional
          sharing remains until Administrator review confirms it or lifts it;
          shared households and schools can be matched incorrectly.
          Administrators can override automatic matches. Paid plans, bonus
          credits, saved work and account contents remain separate. Account
          settings shows your shared-allowance status and lets you request a
          correction.
        </p>
        <p>
          We do not use canvas, audio, font or hardware fingerprinting,
          cross-site tracking, or local storage to restore a deleted identifier.
          Clearing this cookie starts unrelated browser continuity. Browser
          evidence expires within 30 days; stale unconfirmed candidates and
          resolved review requests are removed after 30 days. Provisional and
          confirmed associations and corrections remain until reviewed or
          account deletion, and staff decisions remain in the existing security
          audit. Expired evidence is excluded immediately and maintenance
          removes it at least hourly while the service is running. Collection
          and shared-allowance enforcement can be disabled separately; both are
          disabled by default.
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
        <h2>Public community profiles and forum</h2>
        <p>
          Your forum username, optional picture, discussions, replies,
          reactions, and published attachments are public. Your account email
          and private study sessions are not included in your forum profile.
          Only upload material you want to share publicly. Images are resized
          and stripped of metadata. PDFs are offered as downloads. Unpublished
          attachments expire after one day.
        </p>
        <p>
          You can edit or remove your posts. Moderators can review reports,
          edit, remove, or restore content and suspend forum participation. A
          forum suspension does not restrict your study account. Moderation
          records, including earlier versions of edited or removed content, are
          visible only to authorized moderators. Forum content is not included
          in the tutor’s private-session context. Use account settings to
          request a governed data export or account deletion.
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
        <h2>Families and schools</h2>
        <p>
          Parents, guardians, and schools should review how assignments and
          conversations are processed before a child uses Scriblune. Share only
          material needed for the lesson, and avoid names, addresses, or other
          sensitive details in uploads. Contact us for help with a child’s data.
          Email verification confirms control of an inbox; it does not verify
          age or parental consent.
        </p>
        <h2 id="contact">Contact</h2>
        <p>
          {process.env.SUPPORT_EMAIL ? (
            <a href={`mailto:${process.env.SUPPORT_EMAIL}`}>
              {process.env.SUPPORT_EMAIL}
            </a>
          ) : (
            "The operator must configure a support contact before launch. Signed-in users can submit a privacy request in account preferences."
          )}
        </p>
        <Link className="button secondary" href="/account">
          Manage your preferences
        </Link>
      </main>
    </>
  );
}
