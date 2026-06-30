"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  Users,
  UserCheck,
  AlertCircle,
  Send,
  Target,
  Workflow,
  Bot,
  TrendingUp,
  ShoppingCart,
  BarChart,
  FileText,
  CreditCard,
  Settings,
  Shield,
  ShieldOff,
  LineChart,
  Briefcase,
  Smartphone,
  Database,
  MessageSquare,
  Activity,
  Mail,
  BookOpen,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import Image from "next/image";
import { useOptionalAuth } from "@/components/AuthProvider";

/**
 * Sidebar items.  An item may either be a leaf (has `href`) or a group
 * (has `children`).  Active state on any child highlights the parent.
 *
 * `staffOnly: true` hides the item entirely for non-staff (anyone whose
 * role isn't 'admin' or 'moderator').
 */
const ALL_ITEMS = [
  // Lead Generation
  { name: "Dashboard", href: "/app", icon: BarChart3, comingSoon: true },
  { name: "Companies", href: "/portal/companies", icon: Building2 },
  { name: "Company Access", href: "/portal/company-access", icon: UserCheck },
  { name: "Contacts", href: "/portal/contacts", icon: Users },
  { name: "Contact ID Manager", href: "/portal/contact-id-manager", icon: UserCheck, comingSoon: true },
  { name: "Import Failures", href: "/portal/import-failures", icon: AlertCircle, comingSoon: true },

  // Outreach & Engagement
  { name: "Multi-Channel", href: "/portal/multi-channel", icon: Send },
  {
    name: "Campaigns",
    icon: Target,
    children: [
      { name: "Email Campaigns", href: "/portal/campaigns", icon: Mail },
      { name: "Tracking", href: "/portal/campaigns/tracking", icon: LineChart },
      { name: "Suppressions", href: "/portal/campaigns/suppressions", icon: ShieldOff },
    ],
  },
  { name: "Inbox", href: "/portal/inbox", icon: Mail },
  { name: "Catalogues & Offers", href: "/portal/catalogues", icon: BookOpen },
  { name: "Proforma Invoices", href: "/portal/invoices", icon: FileText },
  { name: "Orders", href: "/portal/orders", icon: ClipboardCheck },
  { name: "Offer Analytics", href: "/portal/offer-analytics", icon: LineChart },
  { name: "Sequences", href: "/portal/sequences", icon: Workflow, comingSoon: true },

  // Relationship Management
  { name: "CRM Automation", href: "/portal/crm-automation", icon: Bot, comingSoon: true },
  { name: "Pipeline", href: "/portal/pipeline", icon: TrendingUp, comingSoon: true },

  // Intelligence & Analytics
  { name: "AI Intelligence", href: "/portal/ai-intelligence", icon: Bot, comingSoon: true },
  { name: "Data Intelligence", href: "/portal/data-intelligence", icon: BarChart, comingSoon: true },
  { name: "Data Marketplace", href: "/portal/data-marketplace", icon: ShoppingCart, comingSoon: true },
  { name: "Analytics", href: "/portal/analytics", icon: BarChart3, comingSoon: true },
  { name: "Reporting", href: "/portal/reporting", icon: FileText, comingSoon: true },

  // Business Operations
  { name: "Billing", href: "/portal/billing", icon: CreditCard, comingSoon: true },
  { name: "Users & Roles", href: "/portal/users-roles", icon: Users, comingSoon: true },
  { name: "Settings", href: "/portal/settings", icon: Settings, comingSoon: true },

  // Admin Controls
  { name: "Marketing", href: "/portal/marketing", icon: Target, comingSoon: true },
  { name: "Enterprise", href: "/portal/enterprise", icon: Briefcase, comingSoon: true },
  { name: "Scalability", href: "/portal/scalability", icon: TrendingUp, comingSoon: true },
  { name: "Integrations", href: "/portal/integrations", icon: Bot, comingSoon: true },
  { name: "Mobile", href: "/portal/mobile", icon: Smartphone, comingSoon: true },
  { name: "CMS", href: "/portal/cms", icon: Database, comingSoon: true },

  // Support
  { name: "Support Sessions", href: "/portal/support", icon: MessageSquare, comingSoon: true },
  { name: "Real-Time Activity", href: "/portal/activity", icon: Activity, comingSoon: true },
];

function isItemActive(item, pathname) {
  if (item.children) return item.children.some((c) => pathname === c.href);
  return pathname === item.href;
}

/**
 * Map a portal href to the page-access key used by the moderator allowlist.
 * Kept in sync with PORTAL_PAGES in lib/modPageAccess.ts and the matcher in
 * AuthGuard.tsx. Hrefs outside /portal/* (the marketing dashboard, etc.)
 * return null and are never hidden by the allowlist.
 */
function hrefToPageKey(href) {
  if (!href || typeof href !== "string") return null;
  const m = href.match(/^\/portal\/([^/?#]+)/);
  if (!m) return null;
  const key = m[1];
  const known = new Set(["contacts", "companies", "campaigns", "multi-channel"]);
  return known.has(key) ? key : null;
}

function itemAllowed(item, allow) {
  // No restriction set → everything is allowed.
  if (!Array.isArray(allow)) return true;
  if (item.children) {
    return item.children.some((c) => itemAllowed(c, allow));
  }
  const key = hrefToPageKey(item.href);
  if (!key) return true; // unmanaged paths stay visible (dashboard, billing, …)
  return allow.includes(key);
}

export default function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const { user } = useOptionalAuth();
  const isStaff = user?.role === "admin" || user?.role === "moderator";
  // For moderators, hide sidebar entries that fall outside the admin-defined
  // allowlist. Non-moderators (admins, regular users) see everything they
  // already saw before — `page_access` is only attached on the moderator path.
  const moderatorAllow =
    user?.role === "moderator" && Array.isArray(user?.page_access)
      ? user.page_access
      : null;

  const { active, comingSoon } = useMemo(() => {
    let visible = ALL_ITEMS.filter((i) => !i.staffOnly || isStaff);
    if (moderatorAllow) {
      visible = visible
        .filter((i) => itemAllowed(i, moderatorAllow))
        .map((i) => {
          if (!i.children) return i;
          // Trim children list to only the allowed ones.
          return {
            ...i,
            children: i.children.filter((c) => itemAllowed(c, moderatorAllow)),
          };
        });
    }
    const active = visible.filter((i) => !i.comingSoon);
    const comingSoon = visible.filter((i) => i.comingSoon);
    return { active, comingSoon };
  }, [isStaff, moderatorAllow]);

  // Per-group expand state, keyed by item name.  Auto-expand any group
  // whose child route is currently active.
  const [expanded, setExpanded] = useState(() => {
    const init = {};
    for (const item of ALL_ITEMS) {
      if (item.children && item.children.some((c) => pathname === c.href)) {
        init[item.name] = true;
      }
    }
    return init;
  });
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const item of ALL_ITEMS) {
        if (item.children && item.children.some((c) => pathname === c.href) && !next[item.name]) {
          next[item.name] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pathname]);

  function toggleGroup(name) {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  return (
    <div
      className={`${
        isCollapsed ? "w-18" : "w-64"
      } bg-gray-900 border-r border-gray-800 h-screen sticky top-0 overflow-y-auto sidebar-scrollbar transition-all duration-300`}
    >
      {/* Brand / collapse */}
      <div className={`${isCollapsed ? "p-2" : "p-4"} flex items-center justify-between`}>
        <Link
          href="/"
          className="flex items-center gap-2 group"
          aria-label="Go to home"
          title="Home"
        >
          <Image
            src="/Ri-Logo-Graph-White.webp"
            alt="LeadSentra logo"
            width={48}
            height={48}
            className="w-8 h-8 rounded-lg object-contain"
            priority
          />
          {!isCollapsed && (
            <span className="text-xl font-bold text-white">LeadSentra</span>
          )}
        </Link>
        <button
          onClick={() => setIsCollapsed((v) => !v)}
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-300"
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className={`${isCollapsed ? "px-2" : "px-4"}`}>
        {!isCollapsed && (
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
            Navigation
          </div>
        )}

        {/* Active items */}
        <nav className="space-y-1">
          {active.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item, pathname);

            // Group with children
            if (item.children) {
              const isOpen = !!expanded[item.name];
              return (
                <div key={item.name}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.name)}
                    className={`sidebar-nav-item w-full ${active ? "active" : ""}`}
                    aria-expanded={isOpen}
                    title={item.name}
                  >
                    <Icon className="w-4 h-4" />
                    {!isCollapsed && (
                      <div className="flex items-center justify-between w-full">
                        <span>{item.name}</span>
                        {isOpen ? (
                          <ChevronUp className="w-3.5 h-3.5 opacity-70" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                        )}
                      </div>
                    )}
                  </button>
                  {isOpen && (
                    <div className={`${isCollapsed ? "ml-0" : "ml-3 pl-3 border-l border-gray-800"} mt-1 space-y-1`}>
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        const childActive = pathname === child.href;
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`sidebar-nav-item ${childActive ? "active" : ""}`}
                            title={child.name}
                          >
                            <ChildIcon className="w-4 h-4" />
                            {!isCollapsed && <span>{child.name}</span>}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // Leaf item
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-nav-item ${active ? "active" : ""}`}
                title={item.name}
              >
                <Icon className="w-4 h-4" />
                {!isCollapsed && <span>{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Coming soon — collapsible footer */}
        {comingSoon.length > 0 && (
          <div className="mt-6 border-t border-gray-800 pt-3">
            <button
              type="button"
              onClick={() => setShowComingSoon((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              aria-expanded={showComingSoon}
              aria-controls="coming-soon-list"
              title={isCollapsed ? `Coming soon (${comingSoon.length})` : undefined}
            >
              {!isCollapsed ? (
                <>
                  <span className="uppercase tracking-wider">
                    Coming soon ({comingSoon.length})
                  </span>
                  {showComingSoon ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </>
              ) : (
                <span className="mx-auto text-[10px] uppercase">{comingSoon.length}</span>
              )}
            </button>

            {showComingSoon && (
              <div id="coming-soon-list" className="mt-1 space-y-1">
                {comingSoon.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.href}
                      className="sidebar-nav-item opacity-60 cursor-not-allowed pointer-events-none"
                      title={`${item.name} (coming soon)`}
                    >
                      <Icon className="w-4 h-4" />
                      {!isCollapsed && (
                        <div className="flex items-center justify-between w-full">
                          <span>{item.name}</span>
                          <span className="text-[10px] uppercase text-gray-500 border border-gray-700 px-1 rounded">
                            Soon
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
