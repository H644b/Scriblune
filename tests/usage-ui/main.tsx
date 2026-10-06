// Local synthetic UI fixture. No application route or authentication bypass.
import { createRoot } from "react-dom/client";
import { NetworkNotice } from "../../src/components/network-session-guard";
import { api } from "../../src/lib/client-api";
import { Providers } from "../../src/components/providers";
import { AccountManager } from "../../src/components/account-manager";
import { UsageIndicator } from "../../src/components/billing-usage";
import { NewQuiz } from "../../src/components/new-quiz";
import { QuizRoom } from "../../src/components/quiz-room";
import { PlanComparison } from "../../src/components/plan-comparison";
import { Desk } from "../../src/components/desk";
import { AccessActionDialog } from "../../src/components/access-action-dialog";
import { useState } from "react";
import "../../src/app/globals.css";

const fixture = new URL(location.href).searchParams.get("fixture");
function OwnerActionFixture() {
  const [open, setOpen] = useState(true),
    [result, setResult] = useState("");
  return (
    <>
      <h1>Action fixture</h1>
      <p role="status">{result}</p>
      {open && (
        <AccessActionDialog
          review={{
            kind: "password_recovery",
            target_id: "10000000-0000-4000-8000-000000000001",
            email: "student@example.test",
            title: "Send password recovery",
            description:
              "Send a recovery link to this account’s verified email.",
          }}
          onClose={() => {
            setOpen(false);
            setResult("Cancelled");
          }}
          onDone={(message) => {
            setOpen(false);
            setResult(message);
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <Providers>
    {fixture === "network" ? (
      <main>
        <h1>Private workspace fixture</h1>
        <button
          onClick={() => {
            void api("/api/fixture-protected").catch(() => {});
          }}
        >
          Protected action
        </button>
      </main>
    ) : fixture === "network-notice" ? (
      <NetworkNotice />
    ) : fixture === "new-quiz" ? (
      <NewQuiz
        open
        onClose={() => {}}
        sessions={[
          { id: "10000000-0000-4000-8000-000000000001", title: "Fractions" },
        ]}
      />
    ) : fixture === "quiz" ? (
      <QuizRoom id="10000000-0000-4000-8000-000000000005" />
    ) : fixture === "plans" ? (
      <PlanComparison />
    ) : fixture === "desk" ? (
      <Desk />
    ) : fixture === "action" ? (
      <OwnerActionFixture />
    ) : (
      <main className="staff-main">
        <h1>Usage UI fixture</h1>
        <AccountManager />
        <section
          style={{ marginTop: 100 }}
          aria-label="Workspace usage fixture"
        >
          <h2>Workspace chat</h2>
          <UsageIndicator demo />
        </section>
      </main>
    )}
  </Providers>,
);
