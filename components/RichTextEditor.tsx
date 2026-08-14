"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Underline, Link2, Link2Off, List, ListOrdered,
  Heading, Quote, Eraser, AlignLeft, AlignCenter, AlignRight,
} from "lucide-react";

/**
 * A formatting editor for campaign email bodies — write the message the way it
 * will be read, instead of hand-writing HTML.
 *
 * Deliberately dependency-free. The output has to survive Gmail, Outlook and
 * Apple Mail, so the tag set is restricted to what those render reliably: an
 * editor library's richer document model would mostly be output we'd have to
 * strip back out again. `document.execCommand` is formally deprecated but is
 * the only cross-browser primitive for this, and every current browser
 * implements it; `styleWithCSS(false)` keeps it emitting <b>/<i> rather than
 * styled spans.
 *
 * The value is an HTML string, the same shape the campaign already stores, so
 * this drops into the existing `content` state with no conversion.
 */

/** Tags an email client will render predictably. Everything else is unwrapped. */
const ALLOWED_TAGS = new Set([
  "P", "BR", "DIV", "SPAN", "B", "STRONG", "I", "EM", "U", "A",
  "UL", "OL", "LI", "H1", "H2", "H3", "BLOCKQUOTE", "IMG",
  "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "HR",
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "title", "target", "rel"]),
  IMG: new Set(["src", "alt", "width", "height", "style"]),
  TD: new Set(["colspan", "rowspan", "align", "style"]),
  TH: new Set(["colspan", "rowspan", "align", "style"]),
  "*": new Set(["style"]),
};

/**
 * Strips anything that shouldn't reach a recipient's mail client: scripts,
 * event handlers, javascript: URLs, and the pile of markup that Word and
 * Google Docs attach to a copy-paste.
 */
export function cleanEmailHtml(dirty: string): string {
  if (typeof document === "undefined") return dirty;
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = dirty;

  doc.body.querySelectorAll("script, style, meta, link, title, noscript").forEach((n) => n.remove());

  const walk = (node: Element) => {
    // Children first — unwrapping a parent mid-iteration would skip nodes.
    Array.from(node.children).forEach((c) => walk(c));

    if (!ALLOWED_TAGS.has(node.tagName)) {
      // Keep the text, drop the tag (covers <font>, <o:p>, <section>, …).
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const ok =
        ALLOWED_ATTRS[node.tagName]?.has(name) || ALLOWED_ATTRS["*"].has(name);
      // on* handlers and javascript: URLs go regardless of the allow-list.
      const dangerous =
        name.startsWith("on") ||
        ((name === "href" || name === "src") &&
          /^\s*javascript:/i.test(attr.value));
      if (!ok || dangerous) node.removeAttribute(attr.name);
    }
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  };
  Array.from(doc.body.children).forEach((c) => walk(c));
  return doc.body.innerHTML;
}

type Cmd = { icon: any; title: string; run: () => void; active?: () => boolean };

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Write your message…",
  minHeight = 320,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [, forceRender] = useState(0);

  // Link dialog. Replaces window.prompt(), which showed a browser-chrome box
  // reading "localhost:5007 says" and couldn't carry a separate link label.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  /** The caret/selection as it was before the dialog stole focus. */
  const savedRange = useRef<Range | null>(null);
  const linkUrlRef = useRef<HTMLInputElement>(null);

  // Only write into the DOM when the incoming value differs from what's already
  // there. Assigning innerHTML on every keystroke would collapse the caret to
  // the start of the field on each character.
  useEffect(() => {
    const el = ref.current;
    if (el && value !== el.innerHTML) el.innerHTML = value || "";
  }, [value]);

  // Focus the address box when the dialog opens — it's the field you came for.
  useEffect(() => {
    if (linkOpen) linkUrlRef.current?.focus();
  }, [linkOpen]);

  useEffect(() => {
    // Emit <b>/<i> instead of <span style>, which older mail clients handle
    // more consistently. Throws in browsers that don't implement it — harmless.
    try {
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      /* not supported — the defaults are still usable */
    }
  }, []);

  const emit = useCallback(() => {
    const el = ref.current;
    if (el) onChange(el.innerHTML);
  }, [onChange]);

  const exec = useCallback(
    (command: string, arg?: string) => {
      ref.current?.focus();
      document.execCommand(command, false, arg);
      emit();
      forceRender((n) => n + 1); // refresh the toolbar's active states
    },
    [emit]
  );

  const isActive = (command: string) => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };

  /**
   * Opens the link dialog.
   *
   * The caret has to be captured up front: as soon as the dialog's input takes
   * focus the browser drops the selection inside the editable, so by the time
   * the user presses Add there is nothing left to wrap. We stash a cloned
   * Range and put it back before running the command.
   */
  const addLink = () => {
    const sel = document.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    // Only accept a selection that's actually inside this editor.
    savedRange.current =
      range && ref.current?.contains(range.commonAncestorContainer) ? range : null;

    const selected = range ? range.toString() : "";
    // Editing an existing link? Prefill its address rather than starting blank.
    let node: Node | null = range?.commonAncestorContainer ?? null;
    let anchor: HTMLAnchorElement | null = null;
    while (node && node !== ref.current) {
      if ((node as HTMLElement).tagName === "A") {
        anchor = node as HTMLAnchorElement;
        break;
      }
      node = node.parentNode;
    }

    setLinkText(selected || anchor?.textContent || "");
    setLinkUrl(anchor?.getAttribute("href") || "");
    setLinkOpen(true);
  };

  /** Normalises what the user typed into something a mail client will follow. */
  const normalizeHref = (raw: string) => {
    const v = raw.trim();
    if (!v) return "";
    // Template placeholders ({{unsubscribe_link}}) and real schemes pass through.
    if (/^(https?:|mailto:|tel:|\{\{)/i.test(v)) return v;
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return `mailto:${v}`;
    return `https://${v}`;
  };

  const applyLink = () => {
    const href = normalizeHref(linkUrl);
    if (!href) return;
    const el = ref.current;
    if (!el) return;

    el.focus();
    const sel = document.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }

    const hadSelection = savedRange.current && !savedRange.current.collapsed;
    const text = linkText.trim();

    if (hadSelection && (!text || text === savedRange.current!.toString())) {
      // Wrapping the existing selection — keeps any formatting inside it.
      document.execCommand("createLink", false, href);
    } else {
      // No selection, or the label was edited: write the anchor ourselves.
      const label = (text || href).replace(/[<>&]/g, (c) =>
        c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
      );
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${label}</a>`
      );
    }

    savedRange.current = null;
    setLinkOpen(false);
    emit();
    forceRender((n) => n + 1);
  };

  const cancelLink = () => {
    setLinkOpen(false);
    savedRange.current = null;
    // Put the caret back so typing carries on where it left off.
    const el = ref.current;
    if (el) el.focus();
  };

  /** Paste arrives as Word/Docs markup — clean it before it enters the body. */
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (html) {
      document.execCommand("insertHTML", false, cleanEmailHtml(html));
    } else {
      document.execCommand("insertText", false, text);
    }
    emit();
  };

  const groups: Cmd[][] = [
    [
      { icon: Bold, title: "Bold (Ctrl+B)", run: () => exec("bold"), active: () => isActive("bold") },
      { icon: Italic, title: "Italic (Ctrl+I)", run: () => exec("italic"), active: () => isActive("italic") },
      { icon: Underline, title: "Underline (Ctrl+U)", run: () => exec("underline"), active: () => isActive("underline") },
    ],
    [
      { icon: Heading, title: "Heading", run: () => exec("formatBlock", "<h2>") },
      { icon: Quote, title: "Quote", run: () => exec("formatBlock", "<blockquote>") },
    ],
    [
      { icon: List, title: "Bulleted list", run: () => exec("insertUnorderedList"), active: () => isActive("insertUnorderedList") },
      { icon: ListOrdered, title: "Numbered list", run: () => exec("insertOrderedList"), active: () => isActive("insertOrderedList") },
    ],
    [
      { icon: AlignLeft, title: "Align left", run: () => exec("justifyLeft") },
      { icon: AlignCenter, title: "Align centre", run: () => exec("justifyCenter") },
      { icon: AlignRight, title: "Align right", run: () => exec("justifyRight") },
    ],
    [
      { icon: Link2, title: "Insert link", run: addLink },
      { icon: Link2Off, title: "Remove link", run: () => exec("unlink") },
      { icon: Eraser, title: "Clear formatting", run: () => exec("removeFormat") },
    ],
  ];

  const isEmpty = !value || value === "<br>" || value === "<p></p>";

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 overflow-hidden">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-700 bg-gray-900/60">
        {groups.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5">
            {gi > 0 && <span className="w-px h-5 bg-gray-700 mx-1" />}
            {group.map(({ icon: Icon, title, run, active }) => {
              const on = active?.() ?? false;
              return (
                <button
                  key={title}
                  type="button"
                  title={title}
                  aria-label={title}
                  aria-pressed={on}
                  // onMouseDown, not onClick: the default mousedown would blur
                  // the field and drop the selection before the command runs.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    run();
                  }}
                  className={`w-7 h-7 grid place-items-center rounded transition-colors ${
                    on ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="relative">
        {isEmpty && (
          <div className="absolute inset-0 px-3 py-2 text-gray-500 pointer-events-none text-[15px]">
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Email message"
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
          onKeyUp={() => forceRender((n) => n + 1)}
          onMouseUp={() => forceRender((n) => n + 1)}
          className="rte-body px-3 py-2 text-[15px] leading-relaxed text-gray-100 focus:outline-none overflow-y-auto"
          style={{ minHeight, maxHeight: 560 }}
        />
      </div>

      {/* Link dialog. Fixed to the viewport and above the page chrome so it
          can't be clipped by whatever the editor is nested inside. */}
      {linkOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cancelLink();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Insert link"
            className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelLink();
              }
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
          >
            <div className="px-5 py-4 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-white">Insert link</h3>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label htmlFor="rte-link-text" className="block text-xs text-gray-400 mb-1">
                  Text to show
                </label>
                <input
                  id="rte-link-text"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  placeholder="Read the report"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label htmlFor="rte-link-url" className="block text-xs text-gray-400 mb-1">
                  Link address
                </label>
                <input
                  ref={linkUrlRef}
                  id="rte-link-url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="example.com  ·  name@example.com  ·  {{unsubscribe_link}}"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:border-emerald-600"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  https:// is added for you. An email address becomes a mailto: link.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelLink}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyLink}
                disabled={!linkUrl.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The editing surface is dark while the email itself is light, so give
          the common tags visible styling here rather than relying on defaults. */}
      <style jsx global>{`
        .rte-body a { color: #6ee7b7; text-decoration: underline; }
        .rte-body h1, .rte-body h2, .rte-body h3 { font-weight: 700; margin: 0.6em 0 0.3em; }
        .rte-body h1 { font-size: 1.5em; }
        .rte-body h2 { font-size: 1.25em; }
        .rte-body h3 { font-size: 1.1em; }
        .rte-body p { margin: 0 0 0.6em; }
        .rte-body ul, .rte-body ol { margin: 0 0 0.6em 1.25em; }
        .rte-body ul { list-style: disc; }
        .rte-body ol { list-style: decimal; }
        .rte-body li { margin: 0.15em 0; }
        .rte-body blockquote {
          margin: 0 0 0.6em; padding-left: 0.75em;
          border-left: 3px solid #475569; color: #cbd5e1;
        }
        .rte-body img { max-width: 100%; height: auto; }
      `}</style>
    </div>
  );
}
