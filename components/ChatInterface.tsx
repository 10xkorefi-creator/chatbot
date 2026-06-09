"use client";

import { useChat } from "ai/react";
import { useEffect, useState, useRef, UIEvent } from "react";
import { X, Send, ArrowDown, Calendar } from "lucide-react";
import Script from "next/script";

// Turn a line of assistant text into nodes, making Markdown links
// [label](url) and bare http(s) URLs clickable. Plain text passes through.
const LINK_CLASS =
  "text-blue-600 underline underline-offset-2 hover:text-blue-800 break-words";

function renderTextWithLinks(text: string, keyPrefix: string) {
  const nodes: (string | JSX.Element)[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;
  let lastIndex = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const href = match[2] || match[3];
    const label = match[1] || match[3];
    nodes.push(
      <a
        key={`${keyPrefix}-${i}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        {label}
      </a>
    );
    lastIndex = pattern.lastIndex;
    i++;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

const SESSION_KEY = "aia_chat_messages";

// RevenueHero Inbound Router ID (the "Inside your application" install method
// from the RH widget modal). We feed our own in-chat form to RH's JavaScript
// SDK instead of embedding RH's hosted page, so we control the flow. Set in
// .env.local.
const RH_ROUTER_ID = process.env.NEXT_PUBLIC_RH_ROUTER_ID || "";
const RH_SCHEDULER_SRC = "https://assets.revenuehero.io/scheduler.min.js";

// Feature flag: the "Book a Demo" / RevenueHero booking feature is kept in the
// code but disabled for now. Re-enable by setting
// NEXT_PUBLIC_ENABLE_BOOK_A_DEMO=true in .env.local (and restarting the dev server).
const BOOK_A_DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_BOOK_A_DEMO === "true";

// Only users on this tool are offered calendar slots. Everyone else is still
// captured as a lead in RevenueHero, but sees a "we'll reach out" message.
const SLOTS_TOOL = "Tally";
const TOOL_OPTIONS = ["Tally", "Zoho Books", "Other"];

export default function ChatInterface() {
  const [isMounted, setIsMounted] = useState(false);
  const [utms, setUtms] = useState<Record<string, string>>({});
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  // 'form' = collecting details, 'submitting' = sending the lead to RevenueHero.
  const [bookingStatus, setBookingStatus] = useState<"form" | "submitting">("form");
  const [bookingForm, setBookingForm] = useState({ name: "", email: "", phone: "", tool: "" });
  const [bookingError, setBookingError] = useState("");
  // True once a lead has been submitted — hides the demo CTAs afterwards.
  const [leadCaptured, setLeadCaptured] = useState(false);
  const heroRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // True while the view should stay pinned to the latest content (auto-follow
  // the streaming reply). Set false when the user scrolls up to read.
  const shouldAutoScrollRef = useRef(true);

  // Initialize useChat
  const { messages, input, handleInputChange, handleSubmit, setMessages, isLoading } = useChat({
    api: "/api/chat",
  });

  // On mount: load messages from sessionStorage and parse UTMs
  useEffect(() => {
    setIsMounted(true);

    // Load from sessionStorage
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved messages");
      }
    }

    // Parse UTMs
    const params = new URLSearchParams(window.location.search);
    const parsedUtms: Record<string, string> = {};
    params.forEach((value, key) => {
      if (key.startsWith("utm_")) {
        parsedUtms[key] = value;
      }
    });
    setUtms(parsedUtms);
  }, [setMessages]);

  // Save messages to sessionStorage whenever they change, and follow the
  // streaming reply: keep the view pinned to the bottom as new tokens arrive,
  // unless the user has scrolled up.
  useEffect(() => {
    if (!isMounted) return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
    if (shouldAutoScrollRef.current && scrollContainerRef.current) {
      const el = scrollContainerRef.current;
      el.scrollTop = el.scrollHeight;
    } else {
      // Not pinned — just keep the scroll-to-bottom button in sync.
      handleScroll();
    }
  }, [messages, isMounted, isLoading]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Show button if we are more than 50px away from the bottom
    const isNotAtBottom = scrollHeight - scrollTop - clientHeight > 50;
    setShowScrollButton(isNotAtBottom);
    // Auto-follow the response only while the user is near the bottom; if they
    // scroll up to read, stop forcing them back down.
    shouldAutoScrollRef.current = !isNotAtBottom;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Lazily create the RevenueHero SDK instance once its script has loaded.
  // showLoader: false keeps hero.submit() a silent background call — its
  // spinner would otherwise hang over the thank-you for non-Tally users, since
  // we never call dialog.open() for them. The calendar still opens for Tally.
  const getHero = () => {
    if (heroRef.current) return heroRef.current;
    const RH = (window as any).RevenueHero;
    if (RH && RH_ROUTER_ID) {
      heroRef.current = new RH({ routerId: RH_ROUTER_ID, showLoader: false });
    }
    return heroRef.current;
  };

  // Open the in-chat qualification form.
  const openBooking = () => {
    setBookingForm({ name: "", email: "", phone: "", tool: "" });
    setBookingError("");
    setBookingStatus("form");
    setIsBooking(true);
  };

  // Celebrate a completed (non-Tally) lead submission with a confetti burst.
  const fireConfetti = () => {
    import("canvas-confetti")
      .then(({ default: confetti }) => {
        confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
        confetti({ particleCount: 60, spread: 100, startVelocity: 45, origin: { y: 0.6 } });
      })
      .catch(() => {});
  };

  // Submit the lead to RevenueHero. EVERY lead is captured via hero.submit();
  // only Tally users are then shown bookable slots via hero.dialog.open().
  // Non-Tally users get a "we'll reach out" thank-you instead.
  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError("");

    const hero = getHero();
    if (!hero) {
      setBookingError(
        "Booking isn't available right now — please call +91 63648 35217."
      );
      return;
    }

    setBookingStatus("submitting");

    const fullName = bookingForm.name.trim();
    const [firstname, ...rest] = fullName.split(/\s+/);
    // Keys must match the field mapping configured in the RevenueHero router.
    const payload: Record<string, string> = {
      email: bookingForm.email.trim(),
      firstname: firstname || fullName,
      lastname: rest.join(" "),
      phone: bookingForm.phone.trim(),
      current_tool: bookingForm.tool,
      ...utms, // forward UTM params for attribution
    };

    try {
      const sessionData = await hero.submit(payload);
      setLeadCaptured(true);
      if (bookingForm.tool === SLOTS_TOOL) {
        // Tally → show the calendar, then close our panel so RH's modal shows.
        hero.dialog.open(sessionData);
        setIsBooking(false);
        setBookingStatus("form");
      } else {
        // Non-Tally → lead captured in RevenueHero; no slots. Close the panel,
        // celebrate, and reply in the chat thread, addressing them by name.
        const firstName = firstname || fullName;
        setIsBooking(false);
        setBookingStatus("form");
        setMessages((prev) => [
          ...prev,
          {
            id: `rh-thanks-${prev.length}`,
            role: "assistant",
            content: `Thanks, ${firstName}! 🎉 Our team will reach out to you shortly.`,
          },
        ]);
        fireConfetti();
      }
    } catch (err) {
      console.error("RevenueHero submit failed", err);
      setBookingStatus("form");
      setBookingError(
        "Something went wrong. Please try again or call +91 63648 35217."
      );
    }
  };

  const handleClose = () => {
    window.parent.postMessage({ type: "CLOSE_CHAT" }, "*");
  };

  const handleClear = () => {
    setMessages([]);
    sessionStorage.removeItem(SESSION_KEY);
  };

  const handleExampleClick = (question: string) => {
    handleInputChange({ target: { value: question } } as any);
    // Simulate a small delay before sending, giving user visual feedback
    setTimeout(() => {
      const event = new Event("submit", { cancelable: true, bubbles: true });
      handleSubmit(event as unknown as React.FormEvent<HTMLFormElement>);
    }, 50);
  };

  const renderMessageContent = (
    content: string,
    isAssistant: boolean,
    forceButton: boolean = false
  ) => {
    // Show the "Book a Demo" button only where we anchor it (forceButton), so
    // it appears exactly once per session. The model's [SHOW_DEMO_BUTTON] marker
    // is still stripped from the text below but no longer renders a button.
    const showButton =
      isAssistant && BOOK_A_DEMO_ENABLED && forceButton && !leadCaptured;
    const textToShow = content.replace(/\[SHOW_DEMO_BUTTON\]/g, "").replace(/\[OPEN_BOOKING\]/g, "").trim();
    
    return (
      <div className="flex flex-col items-start">
        <div>
          {textToShow.split("\\n").map((line, i) => (
            <span key={i}>
              {renderTextWithLinks(line, `l${i}`)}
              <br />
            </span>
          ))}
        </div>
        {showButton && (
          <button
            type="button"
            onClick={openBooking}
            className="mt-4 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-[14px] font-medium hover:bg-gray-800 active:scale-95 transition-all shadow-sm"
          >
            Book a Demo
          </button>
        )}
      </div>
    );
  };

  if (!isMounted) return null; // Avoid hydration mismatch

  const isEmpty = messages.length === 0;
  // Show the "Book a Demo" button exactly once per session — anchored to the
  // 2nd genuine assistant reply (excluding our injected thank-you messages).
  const demoButtonMessageId = messages.filter(
    (m) => m.role === "assistant" && !m.id.startsWith("rh-thanks-")
  )[1]?.id;
  // The last message is "live" while streaming; used to hold the button back
  // until that reply has finished generating.
  const lastMessageId = messages[messages.length - 1]?.id;
  // Once the inline button has shown and the user keeps chatting past it
  // (without booking), surface a persistent floating "Book a Demo" CTA.
  const showFloatingDemo =
    BOOK_A_DEMO_ENABLED &&
    !!demoButtonMessageId &&
    demoButtonMessageId !== lastMessageId &&
    !isBooking &&
    !leadCaptured;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 sm:p-6 backdrop-blur-sm">
      {/* RevenueHero scheduler SDK — loads the global `RevenueHero` constructor
          used by getHero()/handleBookingSubmit. Don't add defer/async. */}
      {BOOK_A_DEMO_ENABLED && RH_ROUTER_ID && (
        <Script
          src={RH_SCHEDULER_SRC}
          strategy="afterInteractive"
          onLoad={() => getHero()}
        />
      )}
      <div className="relative flex w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl h-[90vh] max-h-[900px]">

        {/* Header / Close Button */}
        <div className="absolute right-4 top-4 z-10">
          <button
            onClick={handleClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close Chat"
          >
            <X size={20} />
          </button>
        </div>

        {/* Floating "Book a Demo" CTA — appears once the inline button has been
            shown and the user keeps chatting without clicking it. */}
        {showFloatingDemo && (
          <button
            type="button"
            onClick={openBooking}
            className="absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-[13px] font-medium text-white shadow-md hover:bg-gray-800 active:scale-95 transition-all"
          >
            <Calendar size={14} />
            Book a Demo
          </button>
        )}

        {/* Scrollable Conversation Area */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-6 scrollbar-thin relative"
        >
          {isEmpty ? (
            <div className="flex flex-col pt-12">
              <div className="flex items-start gap-4 mb-8">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white border border-gray-100 overflow-hidden shadow-sm">
                  <img src="/logo.png" alt="Aria" className="h-6 w-6 object-contain" />
                </div>
                <div className="flex flex-col text-gray-800 text-[15px] leading-relaxed">
                  <p>Hi!</p>
                  <p className="mt-2">I&apos;m Aria — AI Accountant&apos;s assistant, trained on our product, features, and docs.</p>
                  <p className="mt-2">
                    Ask me anything about <span className="inline-block rounded-full bg-gray-800 px-3 py-1 text-xs font-semibold text-white ml-1">AI Accountant</span>
                  </p>
                </div>
              </div>

              <div className="mt-8">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Example Questions</p>
                <div className="flex flex-col gap-3">
                  {[
                    "How does AiA automate Tally bookkeeping?",
                    "How accurate is the AI categorization?",
                    "Do I need to switch from Tally?"
                  ].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleExampleClick(q)}
                      className="text-left px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col space-y-6">
              {messages.map((m) => {
                // User messages: right-aligned chat bubble, no avatar.
                if (m.role === "user") {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-[15px] text-white whitespace-pre-wrap break-words">
                        {m.content}
                      </div>
                    </div>
                  );
                }
                // Assistant messages: left-aligned with the Aria avatar.
                return (
                  <div key={m.id} className="relative group">
                    <div className="flex items-start gap-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white border border-gray-100 overflow-hidden shadow-sm">
                        <img src="/logo.png" alt="Aria" className="h-6 w-6 object-contain" />
                      </div>
                      <div className="flex-1 text-[15px] text-gray-800 leading-relaxed whitespace-pre-wrap mt-1">
                        {renderMessageContent(
                          m.content,
                          true,
                          m.id === demoButtonMessageId &&
                            !(isLoading && m.id === lastMessageId)
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex items-start gap-4 py-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white border border-gray-100 overflow-hidden shadow-sm">
                    <img src="/logo.png" alt="Aria" className="h-6 w-6 object-contain" />
                  </div>
                  <div className="flex-1 flex items-center h-8">
                    <span className="flex gap-1">
                      <span className="h-2 w-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="h-2 w-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="h-2 w-2 bg-gray-400 rounded-full animate-bounce"></span>
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Booking overlay — collects lead details, sends every lead to
            RevenueHero via the SDK, and only shows calendar slots to Tally
            users (handleBookingSubmit). Non-Tally users see a thank-you. */}
        {isBooking && (
          <div className="absolute inset-0 z-30 flex flex-col bg-white">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Book a Demo</h3>
              <button
                onClick={() => setIsBooking(false)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                aria-label="Close Booking"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <form onSubmit={handleBookingSubmit} className="flex flex-col gap-4">
                  <p className="text-sm text-gray-500">
                    Share a few details and we&apos;ll set you up.
                  </p>

                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    Name
                    <input
                      type="text"
                      required
                      value={bookingForm.name}
                      onChange={(e) => setBookingForm({ ...bookingForm, name: e.target.value })}
                      className="rounded-xl border border-gray-200 px-4 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    Email
                    <input
                      type="email"
                      required
                      value={bookingForm.email}
                      onChange={(e) => setBookingForm({ ...bookingForm, email: e.target.value })}
                      className="rounded-xl border border-gray-200 px-4 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    Phone
                    <input
                      type="tel"
                      required
                      value={bookingForm.phone}
                      onChange={(e) => setBookingForm({ ...bookingForm, phone: e.target.value })}
                      className="rounded-xl border border-gray-200 px-4 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    Which accounting tool do you use?
                    <select
                      required
                      value={bookingForm.tool}
                      onChange={(e) => setBookingForm({ ...bookingForm, tool: e.target.value })}
                      className="rounded-xl border border-gray-200 px-4 py-2.5 text-[15px] text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    >
                      <option value="" disabled>
                        Select a tool
                      </option>
                      {TOOL_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>

                  {bookingError && (
                    <p className="text-sm text-red-600">{bookingError}</p>
                  )}

                  <button
                    type="submit"
                    disabled={bookingStatus === "submitting"}
                    className="mt-2 px-5 py-3 bg-gray-900 text-white rounded-xl text-[15px] font-medium hover:bg-gray-800 active:scale-95 transition-all disabled:opacity-60"
                  >
                    {bookingStatus === "submitting" ? "Please wait…" : "Continue"}
                  </button>
                </form>
            </div>
          </div>
        )}

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <div className="absolute bottom-[90px] left-1/2 -translate-x-1/2 z-20">
            <button
              onClick={scrollToBottom}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-gray-200 shadow-md text-gray-500 hover:text-blue-600 hover:bg-gray-50 transition-all"
              aria-label="Scroll to bottom"
            >
              <ArrowDown size={16} />
            </button>
          </div>
        )}

        {/* Input Area */}
        <div className="px-6 pb-2 pt-4 bg-white">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              placeholder="Ask anything about AI Accountant..."
              className="w-full rounded-full border-none bg-gray-100 py-3.5 pl-6 pr-12 text-[15px] text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="absolute right-2 flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:text-blue-600 disabled:opacity-50 disabled:hover:text-gray-400 transition-colors"
            >
              <Send size={18} />
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 pb-6 bg-white text-xs text-gray-400">
          <div>Powered by <span className="font-semibold">AI Accountant</span></div>
          <button
            onClick={handleClear}
            className="hover:text-gray-700 transition-colors cursor-pointer"
          >
            Clear
          </button>
        </div>

      </div>
    </div>
  );
}
