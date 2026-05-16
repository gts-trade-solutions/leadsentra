'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import {
  ArrowRight,
  Shield,
  Globe,
  Users,
  BarChart3,
  Zap,
  CheckCircle,
  Plus,
  Minus,
  SlidersHorizontal,
  Twitter,
  Github,
  Mail,
  IndianRupee,
  DollarSign,
  MapPin,
  Phone,
} from 'lucide-react';
export default function MarketingHome() {
  const [signedIn, setSignedIn] = useState(null);

  // Pricing state
  const USD_PER_CREDIT = 0.10;
  const FX_INR_PER_USD = 88;

  // Tiers & discounts
  const PRO_QTY = 3000;
  const PREMIUM_QTY = 7200;
  const PRO_DISCOUNT = 0.15;       // 15%
  const PREMIUM_DISCOUNT = 0.25;   // 25%

  // State
  const [currency, setCurrency] = useState('USD');
  const [credits, setCredits] = useState(100); // default to show Pro

  const fmt = useCallback(
    (val) =>
      new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'en-IN', {
        style: 'currency',
        currency,
        maximumFractionDigits: currency === 'USD' ? 2 : 0,
      }).format(val),
    [currency]
  );

  // --- exact compact label (so 2,300 => "2.3K" not "2K") ---
  const formatCreditsLabel = useCallback((n) => {
    if (n < 1000) return n.toLocaleString('en-US');
    const k = Math.round((n / 1000) * 10) / 10; // one decimal
    const text = Number.isInteger(k) ? k.toFixed(0) : k.toLocaleString('en-US', { maximumFractionDigits: 1 });
    return `${text}K`;
  }, []);

  // Derived totals (apply discount only when exactly on a tier)
  const baseUsd = credits * USD_PER_CREDIT;
  const tierDiscount =
    credits === PREMIUM_QTY ? PREMIUM_DISCOUNT :
      credits === PRO_QTY ? PRO_DISCOUNT : 0;

  const discountedUsd = baseUsd * (1 - tierDiscount);
  const amount = currency === 'USD' ? discountedUsd : discountedUsd * FX_INR_PER_USD;

  // Which card to highlight
  const activePlan =
    credits === PREMIUM_QTY ? 'PREMIUM' :
      credits === PRO_QTY ? 'PRO' : 'SCALE';

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setSignedIn(!!d?.user);
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      });
    return () => { cancelled = true; };
  }, []);

  // smooth-scroll handler
  const handleSmoothScroll = useCallback((e, id) => {
    e.preventDefault();
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const clampCredits = (val) => {
    const v = Math.max(0, Math.min(10000, Number(val) || 0));
    return Math.round(v / 100) * 100; // snap to 100
  };
  const dec = () => setCredits((c) => clampCredits(c - 100));
  const inc = () => setCredits((c) => clampCredits(c + 100));

  const goToCheckout = useCallback((qty) => {
    const dest = `/checkout?credits=${qty}`;
    if (signedIn === false) {
      window.location.href = `/auth/signin?next=${encodeURIComponent(dest)}`;
    } else {
      window.location.href = dest;
    }
  }, [signedIn]);

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Navigation */}
      <nav className="border-b border-gray-800 sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-gray-900/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                {/* Brand image from /public */}
                <Image
                  src="/Ri-Logo-Graph-White.webp"
                  alt="LeadSentra logo"
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-lg object-contain"
                  priority
                />
                <span className="text-xl font-bold text-white">LeadSentra</span>
              </div>

              {/* Only keep Pricing in header */}
              <div className="hidden md:flex items-center gap-6">
                <Link
                  href="#pricing"
                  onClick={(e) => handleSmoothScroll(e, 'pricing')}
                  className="text-gray-300 hover:text-white text-sm"
                >
                  Pricing
                </Link>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {signedIn === null ? null : signedIn ? (
                <Link
                  href="/portal/companies"
                  className="bg-emerald-600 hover:bg-emerald-700 text-gray-100 px-4 py-2 rounded-lg text-sm"
                >
                  Portal
                </Link>
              ) : (
                <Link href="/auth/signin" className="text-gray-300 hover:text-white text-sm">
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
            The Future of
            <span className="text-emerald-400"> Sales Intelligence</span>
          </h1>
          <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto leading-relaxed">
            Unlock unprecedented growth with AI-powered lead generation, multi-channel outreach, and intelligent
            sales automation. Turn prospects into revenue faster than ever.
          </p>

          {/* KPI Badges */}
          <div className="flex flex-wrap justify-center gap-8 mb-12">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">500M+</div>
              <div className="text-sm text-gray-400">Global Contacts</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">70M+</div>
              <div className="text-sm text-gray-400">Companies</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">200+</div>
              <div className="text-sm text-gray-400">Data Points</div>
            </div>
          </div>

          <Link
            href="#pricing"
            onClick={(e) => handleSmoothScroll(e, 'pricing')}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-lg text-lg font-medium transition-colors"
          >
            See Pricing
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="py-12 border-y border-gray-800">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-wrap justify-center items-center gap-12">
            <div className="flex items-center gap-3">
              <Shield className="w-6 h-6 text-emerald-400" />
              <span className="text-gray-300 font-medium">SOC2 Compliant</span>
            </div>
            <div className="flex items-center gap-3">
              <Globe className="w-6 h-6 text-emerald-400" />
              <span className="text-gray-300 font-medium">GDPR Ready</span>
            </div>
            <div className="flex items-center gap-3">
              <Shield className="w-6 h-6 text-emerald-400" />
              <span className="text-gray-300 font-medium">Enterprise Security</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Everything you need to accelerate sales</h2>
            <p className="text-gray-300 text-lg">
              Comprehensive sales intelligence platform built for modern sales teams
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
              <Users className="w-10 h-10 text-emerald-400 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-3">Lead Intelligence</h3>
              <p className="text-gray-300">
                Access 500M+ verified contacts and 70M+ companies with real-time data updates and AI-powered insights.
              </p>
            </div>

            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
              <Zap className="w-10 h-10 text-emerald-400 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-3">Multi-Channel Outreach</h3>
              <p className="text-gray-300">
                Engage prospects across email, LinkedIn, and phone with automated sequences and personalized messaging.
              </p>
            </div>

            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
              <BarChart3 className="w-10 h-10 text-emerald-400 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-3">Sales Analytics</h3>
              <p className="text-gray-300">
                Track performance, optimize campaigns, and forecast revenue with advanced analytics and reporting.
              </p>
            </div>

            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
              <Shield className="w-10 h-10 text-emerald-400 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-3">CRM Integration</h3>
              <p className="text-gray-300">
                Seamlessly sync with Salesforce, HubSpot, and 50+ other platforms to centralize your sales workflow.
              </p>
            </div>

            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
              <Globe className="w-10 h-10 text-emerald-400 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-3">Global Coverage</h3>
              <p className="text-gray-300">
                Reach prospects worldwide with localized data and compliance tools for international markets.
              </p>
            </div>

            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
              <CheckCircle className="w-10 h-10 text-emerald-400 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-3">Enterprise Ready</h3>
              <p className="text-gray-300">
                Scale with confidence using enterprise-grade security, compliance, and dedicated support.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section (Credit-based) */}
      <section
        id="pricing"
        className="py-24 px-4 border-t border-gray-800 bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950"
      >
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="grid lg:grid-cols-2 gap-8 items-start mb-10">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold text-white leading-tight">
                Tailor the right credits for you
              </h2>
            </div>
            <p className="text-gray-300 text-lg">
              Scale up or down with on-demand credits—no subscriptions, no lock-ins.
            </p>
          </div>

          {/* Slider row */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 md:p-8 mb-10">
            <div className="flex flex-wrap items-center gap-4 justify-between">
              <div className="text-gray-200 font-medium">
                I need{' '}
                <span className="text-white font-semibold">
                  {formatCreditsLabel(credits)}
                </span>{' '}
                credits
              </div>

              {/* Currency toggle */}
              <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setCurrency('USD')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${currency === 'USD' ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:text-white'
                    }`}
                  aria-pressed={currency === 'USD'}
                >
                  USD
                </button>
                <button
                  type="button"
                  onClick={() => setCurrency('INR')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${currency === 'INR' ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:text-white'
                    }`}
                  aria-pressed={currency === 'INR'}
                >
                  INR
                </button>
              </div>
            </div>

            {/* Slider control */}
            <div className="mt-6">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={dec}
                  className="p-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600"
                  aria-label="decrease credits"
                >
                  <Minus className="w-4 h-4" />
                </button>

                <input
                  type="range"
                  min={100}
                  max={10000}
                  step={100}
                  value={credits}
                  onChange={(e) => setCredits(clampCredits(Number(e.target.value)))}
                  className="w-full accent-emerald-500"
                  aria-label="credits"
                  aria-valuetext={`${formatCreditsLabel(credits)} credits`}
                />

                <button
                  type="button"
                  onClick={inc}
                  className="p-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600"
                  aria-label="increase credits"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Tick labels */}
              <div className="mt-3 grid grid-cols-6 text-xs text-gray-400">
                {[0, 2000, 4000, 6000, 8000, 10000].map((m) => (
                  <div key={m} className="text-center">
                    {new Intl.NumberFormat('en-US', {
                      notation: 'compact',
                      maximumFractionDigits: 0,
                    }).format(m)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Cards row */}
          <div className="grid md:grid-cols-3 gap-6">
            {/* Pro */}
            <div
              className={`rounded-2xl p-6 bg-gray-900 transition border ${activePlan === 'PRO'
                ? 'border-emerald-600 ring-2 ring-emerald-500 scale-[1.02]'
                : 'border-gray-800 hover:border-emerald-600/50'
                }`}
            >
              <div className="text-sm tracking-wide text-gray-300 font-semibold">Pro</div>
              <div className="text-2xl font-bold text-white mt-1">{PRO_QTY.toLocaleString()} credits</div>

              <div className="mt-4">
                <div className="text-3xl font-extrabold text-white">
                  {fmt((currency === 'USD' ? 1 : FX_INR_PER_USD) * (PRO_QTY * USD_PER_CREDIT * (1 - PRO_DISCOUNT)))}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  <span className="line-through mr-2">
                    {fmt((currency === 'USD' ? 1 : FX_INR_PER_USD) * (PRO_QTY * USD_PER_CREDIT))}
                  </span>
                  <span className="text-emerald-300 font-medium">Save {Math.round(PRO_DISCOUNT * 100)}%</span>
                </div>
              </div>

              <ul className="mt-6 space-y-2 text-sm text-gray-300">
                <li className="flex gap-2"><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" /> All credits upfront</li>
                <li className="flex gap-2"><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" /> Use across features</li>
                <li className="flex gap-2"><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" /> No expiry</li>
              </ul>

              <button
                type="button"
                className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-3 rounded-lg"
                onClick={() => goToCheckout(PRO_QTY)}
              >
                Choose Pro
              </button>
            </div>

            {/* Premium */}
            <div
              className={`rounded-2xl p-6 bg-gray-900 transition border ${activePlan === 'PREMIUM'
                ? 'border-emerald-600 ring-2 ring-emerald-500 scale-[1.02]'
                : 'border-gray-800 hover:border-emerald-600/50'
                }`}
            >
              <div className="text-sm tracking-wide text-emerald-300 font-semibold">Premium</div>
              <div className="text-2xl font-bold text-white mt-1">{PREMIUM_QTY.toLocaleString()} credits</div>

              <div className="mt-4">
                <div className="text-3xl font-extrabold text-white">
                  {fmt((currency === 'USD' ? 1 : FX_INR_PER_USD) * (PREMIUM_QTY * USD_PER_CREDIT * (1 - PREMIUM_DISCOUNT)))}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  <span className="line-through mr-2">
                    {fmt((currency === 'USD' ? 1 : FX_INR_PER_USD) * (PREMIUM_QTY * USD_PER_CREDIT))}
                  </span>
                  <span className="text-emerald-300 font-medium">Save {Math.round(PREMIUM_DISCOUNT * 100)}%</span>
                </div>
              </div>

              <ul className="mt-6 space-y-2 text-sm text-gray-300">
                <li className="flex gap-2"><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" /> All Pro benefits</li>
                <li className="flex gap-2"><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" /> Best value at scale</li>
                <li className="flex gap-2"><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" /> Priority support</li>
              </ul>

              <button
                type="button"
                className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-3 rounded-lg"
                onClick={() => goToCheckout(PREMIUM_QTY)}
              >
                Choose Premium
              </button>
            </div>

            {/* Scale (custom) */}
            <div
              className={`rounded-2xl p-6 bg-gray-900 transition border ${activePlan === 'SCALE'
                ? 'border-emerald-600 ring-2 ring-emerald-500 scale-[1.02]'
                : 'border-gray-800 hover:border-emerald-600/50'
                }`}
            >
              <div className="text-sm tracking-wide text-gray-300 font-semibold">Scale</div>
              <div className="text-2xl font-bold text-white mt-1">{credits.toLocaleString()} credits</div>

              <div className="mt-4">
                <div className="text-3xl font-extrabold text-white">{fmt(amount)}</div>
                {tierDiscount > 0 ? (
                  <div className="text-xs text-gray-400 mt-1">
                    <span className="line-through mr-2">
                      {fmt((currency === 'USD' ? 1 : FX_INR_PER_USD) * (credits * USD_PER_CREDIT))}
                    </span>
                    <span className="text-emerald-300 font-medium">
                      {credits === PRO_QTY
                        ? `Pro price — Save ${Math.round(PRO_DISCOUNT * 100)}%`
                        : `Premium price — Save ${Math.round(PREMIUM_DISCOUNT * 100)}%`}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 mt-1">Base pricing</div>
                )}
              </div>

              <ul className="mt-6 space-y-2 text-sm text-gray-300">
                <li className="flex gap-2"><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" /> Pick any amount up to 10,000</li>
                <li className="flex gap-2"><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" /> All credits upfront</li>
                <li className="flex gap-2"><CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" /> No expiry</li>
              </ul>

              <button
                type="button"
                className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-3 rounded-lg"
                onClick={() => goToCheckout(credits)}
              >
                Buy {credits.toLocaleString()} credits
              </button>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-gray-500">
            Base rate ${USD_PER_CREDIT.toFixed(2)}/credit. Pro saves {Math.round(PRO_DISCOUNT * 100)}%. Premium saves {Math.round(PREMIUM_DISCOUNT * 100)}%. Taxes may apply.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-950 border-t border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="grid md:grid-cols-3 gap-10">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Image
                  src="/Ri-Logo-Graph-White.webp"
                  alt="LeadSentra logo"
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-lg object-contain"
                />
                <span className="text-xl font-bold text-white">LeadSentra</span>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                AI-powered sales intelligence to help you find the right prospects and turn pipeline into revenue.
              </p>
            </div>

            {/* Address */}
            <div>
              <h4 className="text-white font-semibold mb-3">Address</h4>
              <ul className="space-y-3 text-sm text-gray-300">
                <li className="flex gap-3">
                  <MapPin className="w-4 h-4 text-emerald-400 mt-0.5" />
                  <span>Olympia Platina, Guindy, Chennai 600032, TN</span>
                </li>
                <li className="flex gap-3">
                  <Phone className="w-4 h-4 text-emerald-400 mt-0.5" />
                  <span>
                    <a href="tel:+914466108114" className="hover:text-white">91 44 66108114</a> /{' '}
                    <a href="tel:+918072098352" className="hover:text-white">+91 8072098352</a>{' '}
                    <a href="tel:+919003031527" className="hover:text-white">+91 9003031527</a> (Whatsapp)
                  </span>
                </li>
                <li className="flex gap-3">
                  <Mail className="w-4 h-4 text-emerald-400 mt-0.5" />
                  <a href="mailto:info@raceinnovations.in" className="hover:text-white">
                    info@raceinnovations.in
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-white font-semibold mb-3">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/privacy" className="text-gray-400 hover:text-white">Privacy Policy</Link></li>
                <li><Link href="/terms" className="text-gray-400 hover:text-white">Terms &amp; Conditions</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col md:flex-row items-center justify-between gap-4 border-t border-gray-800 pt-6">
            <div className="text-sm text-gray-400">
              © {new Date().getFullYear()} LeadSentra. All rights reserved.
            </div>
            <div className="text-xs text-gray-500">
              Built for growth teams. Need a DPA?{' '}
              <a href="mailto:info@raceinnovations.in" className="text-emerald-400 hover:underline">Contact legal</a>.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
