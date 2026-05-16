"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";

export default function CheckoutPage() {
  // ---- Pricing config ----
  const USD_PER_CREDIT = 0.1;
  const FX_INR_PER_USD = 88;
  const PRO_QTY = 3000;
  const PREMIUM_QTY = 7200;
  const PRO_DISCOUNT = 0.15;
  const PREMIUM_DISCOUNT = 0.25;

  const router = useRouter();
  const qp = useSearchParams();

  // ---- Auth / session ----
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ---- Form state ----
  const initialCredits = useMemo(() => {
    const c = Number(qp.get("credits") || PRO_QTY);
    return Math.max(100, Math.min(10000, Math.round(c / 100) * 100));
  }, [qp]);

  const [plan, setPlan] = useState<"custom" | "3000" | "7200">(
    initialCredits === PRO_QTY
      ? "3000"
      : initialCredits === PREMIUM_QTY
      ? "7200"
      : "custom"
  );
  const [credits, setCredits] = useState(initialCredits);

  // Billing details (card is handled by Razorpay popup)
  const [full_name, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(""); // optional
  const [company, setCompany] = useState(""); // optional
  const [gstin, setGstin] = useState(""); // optional (only when shown)
  const [showGstin, setShowGstin] = useState(false);

  const [addr1, setAddr1] = useState("");
  const [addr2, setAddr2] = useState(""); // optional
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("India");
  const [state, setState] = useState("");

  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---- “touched” flags to show live feedback while typing ----
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const markTouched = (key: string) =>
    setTouched((t) => (t[key] ? t : { ...t, [key]: true }));

  // ---- Auth gate ----
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (!data?.user) {
          router.replace(`/auth/signin?next=/checkout?credits=${initialCredits}`);
          return;
        }
        setSession({ user: data.user });
        setEmail(data.user.email || "");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, initialCredits]);

  // ---- Helpers ----
  const clamp100 = (v: any) => {
    const n = Math.max(100, Math.min(10000, Number(v) || 0));
    return Math.round(n / 100) * 100;
  };

  // Sync credits with plan selector
  useEffect(() => {
    if (plan === "custom") return;
    setCredits(plan === "3000" ? PRO_QTY : PREMIUM_QTY);
  }, [plan]);

  const discount =
    credits === PREMIUM_QTY
      ? PREMIUM_DISCOUNT
      : credits === PRO_QTY
      ? PRO_DISCOUNT
      : 0;

  const baseINR = credits * USD_PER_CREDIT * FX_INR_PER_USD;
  const discountINR = baseINR * discount;
  const subTotalINR = baseINR - discountINR;
  const taxINR = 0; // hook in GST here if needed
  const totalINR = subTotalINR + taxINR;

  const fmtINR = useCallback(
    (v: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(v),
    []
  );

  // ---- Validation (live as you type) ----
  const emailOk = /^\S+@\S+\.\S+$/.test(email);
  const zipOk =
    country === "India" ? /^\d{6}$/.test(zip.trim()) : zip.trim().length >= 3;
  const gstOk =
    !showGstin ||
    gstin.trim() === "" ||
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(gstin.trim());

  // REQUIRED (non-optional) fields before checkout:
  const requiredOk =
    full_name.trim().length > 1 &&
    emailOk &&
    addr1.trim().length > 2 &&
    city.trim().length > 1 &&
    state.trim().length > 1 &&
    zipOk &&
    country.trim().length > 1;

  const canSubmit = requiredOk && gstOk && credits >= 100 && credits <= 10000;

  function FieldLabel({
    children,
    required = false,
  }: {
    children: any;
    required?: boolean;
  }) {
    return (
      <label className="text-sm text-gray-300">
        {children} {required && <span className="text-red-400">*</span>}
      </label>
    );
  }

  function FieldError({
    show,
    id,
    children,
  }: {
    show: boolean;
    id?: string;
    children: any;
  }) {
    if (!show) return null;
    return (
      <p id={id} className="mt-1 text-xs text-red-400">
        {children}
      </p>
    );
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!session) return;

    // Trigger native tooltips as well
    const formEl = document.getElementById(
      "checkout-form"
    ) as HTMLFormElement | null;
    if (formEl && !formEl.reportValidity()) return;
    if (!canSubmit) return;

    setCreating(true);

    const address = {
      line1: addr1 || undefined,
      line2: addr2 || undefined,
      city: city || undefined,
      state: state || undefined,
      postal_code: zip || undefined,
      country: country || undefined,
    };

    const res = await fetch("/api/payments/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        credits,
        profile: {
          full_name,
          email,
          phone,
          company,
          gstin: showGstin ? gstin || undefined : undefined,
          address,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    setCreating(false);

    if (!res.ok || !data?.order_id) {
      console.error(data);
      setErrorMsg("Could not start checkout. Please try again.");
      return;
    }

    const options = {
      key: data.key_id,
      order_id: data.order_id,
      amount: String(data.amount),
      currency: data.currency || "INR",
      name: "LeadSentra",
      description: `${credits} credits`,
      prefill: { name: full_name, email, contact: phone },
      notes: { credits: String(credits) },
      theme: { color: "#10b981" },
      handler: function (resp: any) {
        const qs = new URLSearchParams(resp).toString();
        router.push(`/checkout/success?${qs}`);
      },
      modal: {
        ondismiss: function () {
          router.push("/checkout/failed");
        },
      },
    };

    // @ts-ignore
    const rzp = new window.Razorpay(options);
    // @ts-ignore
    rzp.open();
  }

  if (loading) return null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Razorpay Checkout JS */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
      />

      {/* Top bar */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg" />
            <span className="font-semibold">LeadSentra</span>
          </div>
          <div className="text-sm text-gray-400">
            Secure checkout <span className="text-gray-600">•</span> Powered by
            Razorpay
          </div>
        </div>
      </header>

      {/* Progress indicator */}
      <div className="max-w-6xl mx-auto px-4 mt-6">
        <ol className="flex items-center gap-4 text-xs text-gray-400">
          <li className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white grid place-items-center">
              1
            </span>
            Credits
          </li>
          <li className="flex items-center gap-2">
            <span
              className={`w-5 h-5 rounded-full grid place-items-center ${
                canSubmit
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-700 text-gray-300"
              }`}
            >
              2
            </span>
            Billing
          </li>
          <li className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-gray-700 text-gray-300 grid place-items-center">
              3
            </span>
            Pay
          </li>
        </ol>
      </div>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8 items-start">
          {/* Left column: Form */}
          <form
            id="checkout-form"
            onSubmit={handlePay}
            className="lg:col-span-2 space-y-8"
            noValidate
          >
            {/* Plan & credits */}
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Choose credits</h2>
                {discount > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-emerald-600/20 text-emerald-300 border border-emerald-600/30">
                    Saving {Math.round(discount * 100)}%
                  </span>
                )}
              </div>

              {/* Segmented plan control */}
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {(["3000", "7200", "custom"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlan(p)}
                    className={`w-full rounded-xl px-3 py-2 text-sm border transition
                    ${
                      plan === p
                        ? "bg-emerald-600 text-white border-emerald-500"
                        : "bg-gray-950 text-gray-200 border-gray-700 hover:border-gray-600"
                    }`}
                  >
                    {p === "3000"
                      ? "Pro · 3,000"
                      : p === "7200"
                      ? "Premium · 7,200"
                      : "Custom amount"}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid md:grid-cols-3 gap-4">
                <div className="md:col-span-3">
                  <FieldLabel required>Credits (100–10,000)</FieldLabel>
                  <input
                    type="range"
                    min={100}
                    max={10000}
                    step={100}
                    value={credits}
                    onChange={(e) => {
                      setPlan("custom");
                      setCredits(clamp100(e.target.value));
                      markTouched("credits");
                    }}
                    className="mt-2 w-full accent-emerald-500"
                    aria-label="Credits slider"
                    aria-valuetext={`${credits} credits`}
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="number"
                      min={100}
                      max={10000}
                      step={100}
                      value={credits}
                      onChange={(e) => {
                        setPlan("custom");
                        setCredits(clamp100(e.target.value));
                        markTouched("credits");
                      }}
                      onBlur={() => markTouched("credits")}
                      className={`w-32 rounded-lg bg-gray-950 border px-3 py-2 ${
                        touched.credits && (credits < 100 || credits > 10000)
                          ? "border-red-600"
                          : "border-gray-700"
                      }`}
                      autoComplete="off"
                      required
                      aria-invalid={
                        touched.credits && (credits < 100 || credits > 10000)
                      }
                      aria-describedby="err-credits"
                    />
                    <span className="text-gray-400 text-sm">credits</span>
                  </div>
                  <FieldError
                    id="err-credits"
                    show={touched.credits && (credits < 100 || credits > 10000)}
                  >
                    Enter between 100 and 10,000 credits (steps of 100).
                  </FieldError>
                </div>

                {/* ⛔ Removed the small “Base/Discount/Total” card here as requested */}
              </div>
            </section>

            {/* Billing details */}
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <h2 className="text-lg font-semibold">Billing details</h2>

              {errorMsg && (
                <div className="mt-3 text-sm text-red-300 rounded-lg border border-red-700 bg-red-950/40 p-3">
                  {errorMsg}
                </div>
              )}

              <div className="mt-4 grid md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel required>Full name</FieldLabel>
                  <input
                    required
                    value={full_name}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      markTouched("full_name");
                    }}
                    onBlur={() => markTouched("full_name")}
                    className={`w-full mt-1 rounded-lg bg-gray-950 border px-3 py-2 ${
                      touched.full_name && full_name.trim().length <= 1
                        ? "border-red-600"
                        : "border-gray-700"
                    }`}
                    autoComplete="name"
                    aria-invalid={
                      touched.full_name && full_name.trim().length <= 1
                    }
                    aria-describedby="err-name"
                  />
                  <FieldError
                    id="err-name"
                    show={touched.full_name && full_name.trim().length <= 1}
                  >
                    Enter your full name.
                  </FieldError>
                </div>

                <div>
                  <FieldLabel required>Billing email</FieldLabel>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      markTouched("email");
                    }}
                    onBlur={() => markTouched("email")}
                    className={`w-full mt-1 rounded-lg bg-gray-950 border px-3 py-2 ${
                      touched.email && !emailOk
                        ? "border-red-600"
                        : "border-gray-700"
                    }`}
                    autoComplete="email"
                    aria-invalid={touched.email && !emailOk}
                    aria-describedby="err-email"
                  />
                  <FieldError id="err-email" show={touched.email && !emailOk}>
                    Enter a valid email.
                  </FieldError>
                </div>

                <div>
                  <FieldLabel>Phone (optional)</FieldLabel>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full mt-1 rounded-lg bg-gray-950 border border-gray-700 px-3 py-2"
                    autoComplete="tel"
                  />
                </div>

                <div>
                  <FieldLabel>Company (optional)</FieldLabel>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full mt-1 rounded-lg bg-gray-950 border border-gray-700 px-3 py-2"
                    autoComplete="organization"
                  />
                </div>

                <div className="md:col-span-2">
                  <FieldLabel required>Billing address</FieldLabel>
                  <input
                    required
                    value={addr1}
                    onChange={(e) => {
                      setAddr1(e.target.value);
                      markTouched("addr1");
                    }}
                    onBlur={() => markTouched("addr1")}
                    className={`w-full mt-1 rounded-lg bg-gray-950 border px-3 py-2 ${
                      touched.addr1 && addr1.trim().length <= 2
                        ? "border-red-600"
                        : "border-gray-700"
                    }`}
                    placeholder="Address line 1"
                    autoComplete="address-line1"
                    aria-invalid={touched.addr1 && addr1.trim().length <= 2}
                    aria-describedby="err-addr1"
                  />
                  <input
                    value={addr2}
                    onChange={(e) => setAddr2(e.target.value)}
                    className="w-full mt-2 rounded-lg bg-gray-950 border border-gray-700 px-3 py-2"
                    placeholder="Address line 2 (optional)"
                    autoComplete="address-line2"
                  />
                  <FieldError
                    id="err-addr1"
                    show={touched.addr1 && addr1.trim().length <= 2}
                  >
                    Enter your street address.
                  </FieldError>
                </div>

                <div>
                  <FieldLabel required>City</FieldLabel>
                  <input
                    required
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      markTouched("city");
                    }}
                    onBlur={() => markTouched("city")}
                    className={`w-full mt-1 rounded-lg bg-gray-950 border px-3 py-2 ${
                      touched.city && city.trim().length <= 1
                        ? "border-red-600"
                        : "border-gray-700"
                    }`}
                    autoComplete="address-level2"
                    aria-invalid={touched.city && city.trim().length <= 1}
                    aria-describedby="err-city"
                  />
                  <FieldError
                    id="err-city"
                    show={touched.city && city.trim().length <= 1}
                  >
                    Enter your city.
                  </FieldError>
                </div>

                <div>
                  <FieldLabel required>State / Province</FieldLabel>
                  <input
                    required
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value);
                      markTouched("state");
                    }}
                    onBlur={() => markTouched("state")}
                    className={`w-full mt-1 rounded-lg bg-gray-950 border px-3 py-2 ${
                      touched.state && state.trim().length <= 1
                        ? "border-red-600"
                        : "border-gray-700"
                    }`}
                    autoComplete="address-level1"
                    aria-invalid={touched.state && state.trim().length <= 1}
                    aria-describedby="err-state"
                  />
                  <FieldError
                    id="err-state"
                    show={touched.state && state.trim().length <= 1}
                  >
                    Enter your state.
                  </FieldError>
                </div>

                <div>
                  <FieldLabel required>Zip / Postal code</FieldLabel>
                  <input
                    required
                    value={zip}
                    onChange={(e) => {
                      setZip(e.target.value);
                      markTouched("zip");
                    }}
                    onBlur={() => markTouched("zip")}
                    className={`w-full mt-1 rounded-lg bg-gray-950 border px-3 py-2 ${
                      touched.zip && !zipOk
                        ? "border-red-600"
                        : "border-gray-700"
                    }`}
                    autoComplete="postal-code"
                    placeholder={country === "India" ? "6-digit PIN" : ""}
                    aria-invalid={touched.zip && !zipOk}
                    aria-describedby="err-zip"
                  />
                  <FieldError id="err-zip" show={touched.zip && !zipOk}>
                    {country === "India"
                      ? "Enter a 6-digit PIN code."
                      : "Enter a valid postal code."}
                  </FieldError>
                </div>

                <div>
                  <FieldLabel required>Country</FieldLabel>
                  <select
                    required
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full mt-1 rounded-lg bg-gray-950 border border-gray-700 px-3 py-2"
                    autoComplete="country"
                  >
                    <option>India</option>
                    <option>United States</option>
                    <option>United Kingdom</option>
                    <option>Singapore</option>
                    <option>Australia</option>
                    <option>Canada</option>
                  </select>
                </div>
              </div>

              {/* GSTIN toggle */}
              <div className="mt-4">
                {!showGstin ? (
                  <button
                    type="button"
                    onClick={() => setShowGstin(true)}
                    className="text-xs text-emerald-300 underline underline-offset-4"
                  >
                    Add Tax ID (GSTIN)
                  </button>
                ) : (
                  <div className="mt-2">
                    <FieldLabel>GSTIN (optional)</FieldLabel>
                    <input
                      value={gstin}
                      onChange={(e) => {
                        setGstin(e.target.value.toUpperCase());
                        markTouched("gst");
                      }}
                      onBlur={() => markTouched("gst")}
                      className={`w-full mt-1 rounded-lg bg-gray-950 border px-3 py-2 ${
                        touched.gst && !gstOk
                          ? "border-red-600"
                          : "border-gray-700"
                      }`}
                      placeholder="15-character GSTIN"
                      title="Example format: 22AAAAA0000A1Z5"
                      autoCapitalize="characters"
                      aria-invalid={touched.gst && !gstOk}
                      aria-describedby="err-gst"
                    />
                    <FieldError id="err-gst" show={touched.gst && !gstOk}>
                      Enter a valid GSTIN or leave blank.
                    </FieldError>
                  </div>
                )}
              </div>

              {/* Mobile CTA (only one checkout button on mobile) */}
              <div className="lg:hidden mt-6">
                <button
                  disabled={!canSubmit || creating}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg px-4 py-3 font-medium"
                >
                  {creating ? "Preparing…" : "Confirm & Pay"}
                </button>
                <p className="text-[11px] text-gray-500 mt-2">
                  SSL Secure Payment · Razorpay · VISA · Mastercard · AmEx ·
                  RuPay · UPI
                </p>
              </div>
            </section>
          </form>

          {/* Right column: Order summary */}
          <aside className="lg:sticky lg:top-8">
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <h2 className="text-lg font-semibold">Order summary</h2>

              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Credits</span>
                  <span className="text-gray-200">
                    {credits.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Price per credit</span>
                  <span className="text-gray-200">
                    {fmtINR(USD_PER_CREDIT * FX_INR_PER_USD)}
                  </span>
                </div>

                <div className="border-t border-gray-800 my-2" />

                <div className="flex justify-between">
                  <span className="text-gray-300">Subtotal</span>
                  <span className="text-gray-100">{fmtINR(baseINR)}</span>
                </div>

                {discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-emerald-300">
                      Discount {Math.round(discount * 100)}%
                    </span>
                    <span className="text-emerald-300">
                      −{fmtINR(discountINR)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className="text-gray-400">Estimated tax</span>
                  <span className="text-gray-400">{fmtINR(taxINR)}</span>
                </div>

                <div className="border-t border-gray-800 my-2" />

                <div className="flex justify-between text-base font-semibold">
                  <span>Total (charged today)</span>
                  <span>{fmtINR(totalINR)}</span>
                </div>
              </div>

              {/* Hide this button on mobile to avoid duplicate CTAs */}
              <button
                onClick={() => {
                  const form = document.getElementById(
                    "checkout-form"
                  ) as HTMLFormElement | null;
                  if (!form) return;
                  if (form.reportValidity() && canSubmit && !creating) {
                    form.dispatchEvent(
                      new Event("submit", { cancelable: true, bubbles: true })
                    );
                  }
                }}
                disabled={!canSubmit || creating}
                className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg px-4 py-3 font-medium hidden lg:block"
              >
                {creating ? "Preparing…" : "Confirm & Pay"}
              </button>

              <p className="text-[11px] text-gray-500 mt-3 text-center hidden lg:block">
                SSL Secure Payment · Razorpay · VISA · Mastercard · AmEx · RuPay
                · UPI
              </p>
            </div>

            <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-4 text-xs text-gray-400">
              Credits never expire. You’ll see them in your wallet instantly
              after a successful payment.
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
