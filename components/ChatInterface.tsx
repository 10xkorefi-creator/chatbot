"use client";

import { useChat } from "ai/react";
import { useEffect, useState, useRef, UIEvent } from "react";
import { X, Send, ArrowDown, Calendar, ChevronDown, Sparkles, ShieldCheck, Layers, ArrowRight, BookOpen } from "lucide-react";
import Script from "next/script";

// Turn a line of assistant text into nodes: Markdown links [label](url) and
// bare http(s) URLs become anchors, **bold** becomes <strong>. Plain text
// passes through.
const LINK_CLASS =
  "text-blue-600 underline underline-offset-2 hover:text-blue-800 break-words";

function renderTextWithLinks(text: string, keyPrefix: string) {
  const nodes: (string | JSX.Element)[] = [];
  const pattern =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[4] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-gray-900">
          {match[4]}
        </strong>
      );
    } else {
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
    }
    lastIndex = pattern.lastIndex;
    i++;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function parseMessageContent(content: string) {
  let text = content;
  let suggestions: string[] = [];
  
  // Parse suggestions marker: [SUGGESTIONS] Q1 | Q2
  const suggestionsMatch = text.match(/\[SUGGESTIONS\]([\s\S]*)$/);
  if (suggestionsMatch) {
    const rawSuggestions = suggestionsMatch[1];
    suggestions = rawSuggestions
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    text = text.replace(/\[SUGGESTIONS\][\s\S]*$/, "");
  }
  
  // Strip other markers
  text = text.replace(/\[SHOW_DEMO_BUTTON\]/g, "").replace(/\[OPEN_BOOKING\]/g, "").trim();
  
  return { text, suggestions };
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
const TOOL_OPTIONS = ["Tally", "Zoho Books", "Both", "Other"];

export default function ChatInterface() {
  const [isMounted, setIsMounted] = useState(false);
  const [utms, setUtms] = useState<Record<string, string>>({});
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  // 'form' = collecting details, 'submitting' = sending the lead to RevenueHero.
  const [bookingStatus, setBookingStatus] = useState<"form" | "submitting">("form");
  const [bookingForm, setBookingForm] = useState({ name: "", email: "", phone: "", tool: "" });
  const [bookingError, setBookingError] = useState("");
  // Custom "accounting tool" dropdown — replaces a native <select>, which
  // intermittently failed to open inside the embedded iframe.
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  // True once a lead has been submitted — hides the demo CTAs afterwards.
  const [leadCaptured, setLeadCaptured] = useState(false);
  const heroRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // True while the view should stay pinned to the latest content (auto-follow
  // the streaming reply). Set false when the user scrolls up to read.
  const shouldAutoScrollRef = useRef(true);

  // Initialize useChat
  const { messages, input, handleInputChange, handleSubmit, append, setMessages, isLoading } = useChat({
    api: "/api/chat",
  });

  // On mount: load messages from sessionStorage, parse UTMs and query params for autofill
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

    // Parse UTMs & Prefill fields
    const params = new URLSearchParams(window.location.search);
    const parsedUtms: Record<string, string> = {};
    params.forEach((value, key) => {
      if (key.startsWith("utm_")) {
        parsedUtms[key] = value;
      }
    });
    setUtms(parsedUtms);

    // Dynamic URL Prefill (e.g. ?name=John&email=john@example.com&phone=9876543210)
    const nameParam = params.get("name") || params.get("firstname") || "";
    const emailParam = params.get("email") || "";
    const phoneParam = (params.get("phone") || params.get("mobile") || "").replace(/\D/g, "").slice(-10);

    if (nameParam || emailParam || phoneParam) {
      setBookingForm((prev) => ({
        ...prev,
        name: nameParam || prev.name,
        email: emailParam || prev.email,
        phone: phoneParam || prev.phone,
      }));
    }
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

  // Close the accounting-tool dropdown when clicking anywhere outside it.
  useEffect(() => {
    if (!toolDropdownOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [toolDropdownOpen]);

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
    setToolDropdownOpen(false);
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

    // Only Indian 10-digit mobile numbers; we prefix +91 ourselves.
    const phoneDigits = bookingForm.phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      setBookingError("Please enter a valid 10-digit phone number.");
      return;
    }

    if (!bookingForm.tool) {
      setBookingError("Please select the accounting tool you use.");
      return;
    }

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
      first_name: firstname || fullName,
      lastname: rest.join(" "),
      last_name: rest.join(" "),
      phone: `+91${phoneDigits}`,
      lg_phone: `+91${phoneDigits}`,
      current_tool: bookingForm.tool,
      contact_source: "website chatbot",
      ...utms, // forward UTM params for attribution
      // Always tag the source so RevenueHero maps it to the HubSpot contact.
      // Placed after ...utms so it wins over any utm_source in the URL.
      utm_source: "website chatbot",
    };

    try {
      const sessionData = await hero.submit(payload);
      setLeadCaptured(true);
      if (bookingForm.tool === SLOTS_TOOL || bookingForm.tool === "Both") {
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
            content: `Thanks, ${firstName} — our team will reach out to you shortly.`,
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
    // Send the suggested prompt immediately — append adds the user message and
    // triggers the API call, instead of just populating the input box.
    append({ role: "user", content: question });
  };

  const renderMessageContent = (
    content: string,
    isAssistant: boolean,
    forceButton: boolean = false
  ) => {
    const { text: textToShow } = parseMessageContent(content);
    
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
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const lastAssistantMessageId = assistantMessages[assistantMessages.length - 1]?.id;

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
      <div className="relative flex w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl h-[95vh] max-h-[750px]">

        {/* Header — identity bar: Aria avatar, name, status; demo CTA appears
            here once the inline button has been shown and the user keeps
            chatting without clicking it. */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white border border-gray-100 overflow-hidden shadow-sm">
            <img src="/logo.png" alt="Aria" className="h-7 w-7 object-contain" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-gray-900 leading-tight">Aria</span>
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              AI Accountant assistant
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={handleClose}
              className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              aria-label="Close Chat"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Scrollable Conversation Area */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-6 scrollbar-thin relative bg-gradient-to-b from-white to-slate-50/50"
        >
          {isEmpty ? (
            <div className="flex flex-col pt-4 pb-4 items-center justify-center min-h-[250px] animate-fade-in">
              {/* Centered Hero Greeting */}
              <div className="flex flex-col items-center text-center mb-5">
                <img src="/logo.png" alt="Aria Logo" className="h-10 w-10 object-contain mb-2" />
                <h2 className="text-lg font-bold tracking-tight text-slate-800">
                  Ask Aria
                </h2>
                <p className="mt-1 text-[11px] text-slate-500 max-w-[280px] leading-relaxed">
                  Your AI Accountant assistant. Ask me anything about bookkeeping, GST, or Tally.
                </p>
              </div>

              {/* Suggestions Bubbles */}
              <div className="flex flex-wrap gap-2 justify-center max-w-[420px]">
                {[
                  {
                    text: "🤖 Tally Automation",
                    prompt: "How does AI Accountant automate Tally bookkeeping?",
                    style: "bg-blue-50/60 hover:bg-blue-100/85 border-blue-100/60 text-blue-700"
                  },
                  {
                    text: "🎯 Accuracy Rate",
                    prompt: "How accurate is the AI categorization and scanned bill extraction?",
                    style: "bg-emerald-50/60 hover:bg-emerald-100/85 border-emerald-100/60 text-emerald-700"
                  },
                  {
                    text: "💼 CA Support",
                    prompt: "What is included in the Virtual Accounting managed service?",
                    style: "bg-indigo-50/60 hover:bg-indigo-100/85 border-indigo-100/60 text-indigo-700"
                  },
                  {
                    text: "🔌 Support for Zoho?",
                    prompt: "Do you support Zoho Books integration?",
                    style: "bg-purple-50/60 hover:bg-purple-100/85 border-purple-100/60 text-purple-700"
                  }
                ].map((bubble, i) => (
                  <button
                    key={i}
                    onClick={() => handleExampleClick(bubble.prompt)}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-all active:scale-95 cursor-pointer shadow-sm ${bubble.style}`}
                  >
                    {bubble.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col space-y-6">
              {messages.map((m) => {
                // User messages: right-aligned chat bubble, no avatar.
                if (m.role === "user") {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-gradient-to-tr from-blue-600 to-indigo-600 px-4 py-2.5 text-[15px] text-white whitespace-pre-wrap break-words shadow-sm shadow-blue-500/10">
                        {m.content}
                      </div>
                    </div>
                  );
                }
                // Assistant messages: left-aligned with the Aria avatar.
                const isLastAssistant = m.id === lastAssistantMessageId;
                const { suggestions } = parseMessageContent(m.content);

                return (
                  <div key={m.id} className="relative group flex flex-col">
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
                    {isLastAssistant && suggestions.length > 0 && !isLoading && (
                      <div className="flex flex-wrap gap-2 mt-3 pl-12">
                        {suggestions.map((suggestion, sIdx) => (
                          <button
                            key={sIdx}
                            type="button"
                            onClick={() => handleExampleClick(suggestion)}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100/80 text-xs font-semibold text-blue-700 rounded-full border border-blue-100/50 transition-all active:scale-95 cursor-pointer shadow-sm"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
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
                      name="name"
                      autoComplete="name"
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
                      name="email"
                      autoComplete="email"
                      value={bookingForm.email}
                      onChange={(e) => setBookingForm({ ...bookingForm, email: e.target.value })}
                      className="rounded-xl border border-gray-200 px-4 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    Phone
                    <div className="flex items-center rounded-xl border border-gray-200 focus-within:ring-2 focus-within:ring-blue-500/50">
                      <span className="pl-4 pr-1 py-2.5 text-[15px] text-gray-500 select-none">+91</span>
                      <input
                        type="tel"
                        required
                        name="phone"
                        autoComplete="tel"
                        inputMode="numeric"
                        placeholder="10-digit mobile number"
                        value={bookingForm.phone}
                        onChange={(e) =>
                          setBookingForm({
                            ...bookingForm,
                            // Keep only digits, cap at 10 — the +91 prefix is shown separately.
                            phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                          })
                        }
                        className="flex-1 min-w-0 rounded-r-xl bg-transparent pl-1 pr-4 py-2.5 text-[15px] text-gray-900 focus:outline-none"
                      />
                    </div>
                  </label>

                  <div className="flex flex-col gap-1 text-sm text-gray-700">
                    Which accounting tool do you use?
                    {/* Custom dropdown (not a native <select>, which sometimes
                        failed to open inside the embedded iframe). Opens upward
                        so the list isn't clipped by the scrollable form. */}
                    <div className="relative" ref={toolDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setToolDropdownOpen((o) => !o)}
                        className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-left text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      >
                        <span className={bookingForm.tool ? "text-gray-900" : "text-gray-400"}>
                          {bookingForm.tool || "Select a tool"}
                        </span>
                        <ChevronDown
                          size={16}
                          className={`shrink-0 text-gray-400 transition-transform ${toolDropdownOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                      {toolDropdownOpen && (
                        <div className="absolute bottom-full z-10 mb-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                          {TOOL_OPTIONS.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => {
                                setBookingForm({ ...bookingForm, tool: t });
                                setToolDropdownOpen(false);
                              }}
                              className={`block w-full px-4 py-2.5 text-left text-[15px] transition-colors hover:bg-blue-50 ${
                                bookingForm.tool === t ? "bg-blue-50/60 text-blue-700" : "text-gray-700"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

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
        <div className="px-6 pb-2 pt-4 bg-white border-t border-slate-100">
          <form 
            onSubmit={handleSubmit} 
            className="flex flex-col bg-slate-50 focus-within:bg-white rounded-2xl p-3.5 border border-slate-200/80 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10 transition-all duration-200"
          >
            {/* Row 1: Text Input */}
            <div className="w-full mb-3">
              <input
                type="text"
                value={input}
                onChange={handleInputChange}
                autoFocus
                placeholder="Ask anything about AI Accountant..."
                className="w-full bg-transparent border-none p-0 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />
            </div>

            {/* Row 2: Bottom Control Bar */}
            <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/50">
              <div className="flex items-center gap-2">
                {BOOK_A_DEMO_ENABLED && (
                  <button
                    type="button"
                    onClick={openBooking}
                    className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-lg active:scale-95 transition-all shadow-sm"
                    title="Book a Demo"
                  >
                    <Calendar size={13} />
                    <span>Book Demo</span>
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ${
                  input.trim() && !isLoading
                    ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/20 active:scale-95"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <Send size={14} />
              </button>
            </div>
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
