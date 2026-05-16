"use client";
import Link from "next/link";
import { BarChart3, Lock, ShieldCheck, Cookie, Globe2, UserCheck, Gavel } from "lucide-react";

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
            <Link href="/terms" className="text-sm text-gray-300 hover:text-white">
              Terms
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
            <Lock className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-300">Privacy (India)</span>
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">Privacy Policy</h1>

          {/* At-a-glance */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Gavel className="h-4 w-4 text-emerald-400" />} title="Laws we follow">
              DPDP Act 2023, IT Act/SPDI Rules, TRAI anti-UCC norms.
            </StatCard>
            <StatCard icon={<UserCheck className="h-4 w-4 text-emerald-400" />} title="Your rights">
              Access, correction, erasure, grievance redressal.
            </StatCard>
            <StatCard icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />} title="Security">
              Reasonable security practices; encryption in transit.
            </StatCard>
            <StatCard icon={<Cookie className="h-4 w-4 text-emerald-400" />} title="Cookies">
              Auth, preferences, analytics, fraud prevention.
            </StatCard>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-12">
          {/* Main */}
          <section className="space-y-8 lg:col-span-8">
            <Section id="scope" title="1) Scope & Who We Are">
              <p>
                This Policy explains how <span className="font-medium">LeadSentra</span> (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects and uses information when you use our website, platform, and APIs (the &ldquo;Services&rdquo;). By using the Services you also agree to our <Link href="/terms" className="text-emerald-400 hover:underline">Terms</Link>.
              </p>
            </Section>

            <Section id="data" title="2) Data We Collect (short)">
              <ul className="list-disc space-y-2 pl-6">
                <li><span className="font-medium">Identity & contact</span>: name, email, phone, company, role.</li>
                <li><span className="font-medium">Usage & device</span>: IP, logs, device/browser, support chats.</li>
                <li><span className="font-medium">Transactions</span>: billing metadata; payments handled by our provider (no card numbers stored by us).</li>
                <li><span className="font-medium">B2B data</span>: public/partner professional info to power prospecting.</li>
                <li><span className="font-medium">Cookies</span>: auth, preferences, analytics, performance, fraud prevention.</li>
              </ul>
            </Section>

            <Section id="use" title="3) Why We Use Data (lawful bases)">
              <ul className="list-disc space-y-2 pl-6">
                <li>Provide, secure, and improve the Services.</li>
                <li>Support, analytics, and prevention of fraud/abuse.</li>
                <li>Legal compliance and enforcement of our Terms.</li>
                <li>Marketing with consent/legitimate use; you can opt out anytime.</li>
              </ul>
              <p className="text-sm text-gray-400">Aligned to India’s DPDP Act, 2023 and applicable rules.</p>
            </Section>

            <Section id="rights" title="4) Your Rights (India)">
              <ul className="list-disc space-y-2 pl-6">
                <li>Request access to or a copy of your personal data.</li>
                <li>Ask us to correct or erase personal data that is inaccurate or no longer needed.</li>
                <li>Withdraw consent where processing is based on consent.</li>
                <li>Use our grievance process; if unresolved, you may escalate to the Data Protection Board of India.</li>
              </ul>
            </Section>

            <Section id="sharing" title="5) Sharing">
              <ul className="list-disc space-y-2 pl-6">
                <li><span className="font-medium">Vendors</span>: hosting, analytics, email, payments, support providers under contract.</li>
                <li><span className="font-medium">At your direction</span>: integrations you connect (e.g., CRM or email tools).</li>
                <li><span className="font-medium">Legal/safety</span>: to comply with law or protect rights.</li>
                <li><span className="font-medium">Business transfers</span>: merger, acquisition, or financing.</li>
              </ul>
              <p className="text-sm text-gray-400">We do not sell personal data.</p>
            </Section>

            <Section id="transfers" title="6) Storage & International Transfers">
              <p>We may process data in India and other countries. Where transferred, we apply contractual and technical safeguards.</p>
            </Section>

            <Section id="security" title="7) Security">
              <p>We maintain <span className="font-medium">reasonable security practices</span> including encryption in transit, access controls, and monitoring. No method is 100% secure.</p>
            </Section>

            <Section id="retention" title="8) Retention">
              <p>We keep personal data only as long as needed for the purposes above or as required by law. We may retain de‑identified or aggregated data.</p>
            </Section>

            <Section id="marketing" title="9) Marketing, Email & SMS (TRAI/DND)">
              <p>We send B2B emails/SMS only with consent or as allowed by preference settings. We honour Do‑Not‑Disturb and template/consent rules under TRAI’s UCC framework. You can opt out (e.g., reply &ldquo;STOP&rdquo; for SMS) or contact us.</p>
            </Section>

            <Section id="children" title="10) Children">
              <p>Our Services are intended for users 18+ and not for children.</p>
            </Section>

            <Section id="contact" title="11) Contact (India)">
              <div className="space-y-2">

                <p>
            
                  Email: <a href="mailto:info@raceinnovations.in" className="text-emerald-400 hover:underline">info@raceinnovations.in</a><br />
                </p>
                <p className="text-sm text-gray-400">If you are not satisfied with our response, you may escalate to the Data Protection Board of India as per law.</p>
              </div>
            </Section>

            <Section id="changes" title="12) Changes">
              <p>We may update this Policy. Material changes will be notified in product or by email. Continued use means you accept the updated Policy.</p>
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
                      ["scope", "Scope & Who We Are"],
                      ["data", "Data We Collect"],
                      ["use", "Why We Use Data"],
                      ["rights", "Your Rights"],
                      ["sharing", "Sharing"],
                      ["transfers", "Storage & Transfers"],
                      ["security", "Security"],
                      ["retention", "Retention"],
                      ["marketing", "Marketing & SMS"],
                      ["children", "Children"],
                      ["contact", "Grievance Officer"],
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

              <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                  <Globe2 className="h-4 w-4 text-emerald-400" /> Cross‑border transfers
                </div>
                <p className="text-sm text-gray-400">We use contractual and technical safeguards where data moves outside India.</p>
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
