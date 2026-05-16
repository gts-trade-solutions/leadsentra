"use client";
import Link from "next/link";
import { BarChart3, Lock, ShieldCheck, Cookie, Globe2, Gavel } from "lucide-react";

export default function Page() {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      {/* Top Nav */}
      <nav className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/80 backdrop-blur supports-[backdrop-filter]:bg-gray-950/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-semibold text-white">LeadSentra</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="text-sm text-gray-300 hover:text-white">
              Privacy
            </Link>
            <Link
              href="/#pricing"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="border-b border-gray-800 bg-gradient-to-b from-gray-950 via-gray-950 to-gray-900">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-700/40 bg-emerald-900/20 px-3 py-1">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-300">Legal (India)</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">Terms of Service</h1>

          {/* At-a-glance */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Lock className="h-4 w-4 text-emerald-400" />} title="Agreement">
              By using LeadSentra you accept these Terms and our Privacy Policy.
            </StatCard>
            <StatCard icon={<Gavel className="h-4 w-4 text-emerald-400" />} title="India‑specific">
              Complies with DPDP Act, IT/SPDI Rules, TRAI UCC norms.
            </StatCard>
            <StatCard icon={<Globe2 className="h-4 w-4 text-emerald-400" />} title="Acceptable Use">
              No unlawful scraping, spam, or abuse; honour DND/consent.
            </StatCard>
            <StatCard icon={<Cookie className="h-4 w-4 text-emerald-400" />} title="Billing">
              Credit‑based plans; taxes as applicable in India.
            </StatCard>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-12">
          {/* Main */}
          <section className="space-y-8 lg:col-span-8">
            <Section id="accept" title="1) Acceptance & Scope">
              <p>These Terms are a binding agreement between you and LeadSentra. If you use the Services on behalf of a company, you represent you are authorised to bind it.</p>
            </Section>

            <Section id="account" title="2) Eligibility & Accounts">
              <ul className="list-disc space-y-2 pl-6">
                <li>You must be 18+ and capable of entering into a contract.</li>
                <li>Keep credentials confidential; you are responsible for activity on your account.</li>
                <li>Provide accurate registration and billing information.</li>
              </ul>
            </Section>

            <Section id="billing" title="3) Plans, Credits & Billing">
              <ul className="list-disc space-y-2 pl-6">
                <li>Usage is credit‑based as shown in product. Plan prices/taxes are displayed at checkout.</li>
                <li>Payments are processed by our provider; we do not store card numbers.</li>
                <li>Except where required by Indian law or stated otherwise, purchases are non‑refundable.</li>
              </ul>
            </Section>

            <Section id="use" title="4) Acceptable Use (incl. marketing)">
              <ul className="list-disc space-y-2 pl-6">
                <li>No illegal, infringing, deceptive, or harmful activity; no security probing or bypassing limits.</li>
                <li>No unsolicited communications in violation of TRAI UCC/DND rules; honour opt‑outs.</li>
                <li>Only upload/share data you have rights to and required notices/consents for (incl. personal data under DPDP Act).</li>
              </ul>
            </Section>

            <Section id="privacy" title="5) Data & Privacy">
              <p>We process account, usage, and B2B data as described in our <Link href="/privacy" className="text-emerald-400 hover:underline">Privacy Policy</Link>. You are responsible for your lawful basis when syncing contacts or triggering outreach via integrations.</p>
            </Section>

            <Section id="third" title="6) Integrations & Third‑Party Services">
              <p>Optional integrations (e.g., CRM, email) are provided by third parties and subject to their terms; we are not responsible for third‑party services.</p>
            </Section>

            <Section id="ip" title="7) Intellectual Property">
              <p>We (and our licensors) retain all rights to the Services. Subject to these Terms, we grant a limited, non‑transferable, revocable licence to use the Services.</p>
            </Section>

            <Section id="conf" title="8) Confidentiality">
              <p>Non‑public information disclosed by either party must be protected with at least reasonable care and used only as permitted.</p>
            </Section>

            <Section id="warranty" title="9) Warranties & Disclaimers">
              <p>The Services are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; to the fullest extent permitted by law.</p>
            </Section>

            <Section id="liability" title="10) Limitation of Liability">
              <p>To the maximum extent permitted, we are not liable for indirect or consequential damages. Our aggregate liability is capped at fees paid in the preceding 12 months.</p>
            </Section>

            <Section id="suspension" title="11) Suspension & Termination">
              <p>We may suspend or terminate for violations, security risk, non‑payment, or legal requirement. Certain clauses survive termination (IP, confidentiality, liability limits).</p>
            </Section>


            <Section id="notices" title="13) Notices & Grievances">
              <p>Legal notices and grievances: <a href="mailto:enquiry@raceinnovations.in" className="text-emerald-400 hover:underline">enquiry@raceinnovations.in</a>. For privacy complaints, contact our Grievance Officer listed in the Privacy Policy first.</p>
              <p className="mt-4 rounded-lg border border-amber-700/40 bg-amber-900/10 p-4 text-amber-200 text-sm">This page is general information and not legal advice. Please consult your counsel.</p>
            </Section>

            <Section id="changes" title="14) Changes">
              <p>We may update these Terms; material changes will be notified in product or by email. Continued use means acceptance.</p>
            </Section>
          </section>

          {/* Right rail */}
          <aside className="lg:col-span-4">
            <div className="sticky top-24 space-y-6">
              <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
                <h3 className="mb-3 text-sm font-semibold text-white">Table of contents</h3>
                <nav className="text-sm">
                  <ul className="space-y-2">
                    {[
                      ["accept", "Acceptance & Scope"],
                      ["account", "Eligibility & Accounts"],
                      ["billing", "Plans & Billing"],
                      ["use", "Acceptable Use"],
                      ["privacy", "Data & Privacy"],
                      ["third", "Integrations"],
                      ["ip", "Intellectual Property"],
                      ["conf", "Confidentiality"],
                      ["warranty", "Warranties"],
                      ["liability", "Liability"],
                      ["suspension", "Suspension & Termination"],
                     
                      ["notices", "Notices & Grievances"],
                      ["changes", "Changes"],
                    ].map(([id, label]) => (
                      <li key={id as string}>
                        <a href={`#${id}`} className="inline-block rounded-md px-2 py-1 text-gray-300 hover:bg-gray-800 hover:text-white">
                          {label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 bg-gray-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-semibold text-white">LeadSentra</span>
          </div>
          <div className="text-sm text-gray-400">© {year} LeadSentra. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}

/* ---------- helpers ---------- */
function StatCard({ icon, title, children }: any) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-200">
        {icon} {title}
      </div>
      <p className="text-sm text-gray-400">{children}</p>
    </div>
  );
}

function Section({ id, title, children }: any) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6">
        <h2 className="mb-3 text-2xl font-semibold text-white">{title}</h2>
        <div className="space-y-3 leading-relaxed text-gray-300">{children}</div>
      </div>
    </section>
  );
}
