"use client";

import { useChat } from "ai/react";
import { useEffect, useState, useRef, UIEvent } from "react";
import { X, Send, User, ArrowDown } from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const SESSION_KEY = "aia_chat_messages";

// RevenueHero's hosted booking page (the "Inbound router link URL" from the
// RevenueHero install modal). It renders RH's own form + calendar, so the chat
// doesn't need to collect name/email. Set this in .env.local.
const RH_BOOKING_URL = process.env.NEXT_PUBLIC_RH_BOOKING_URL || "";

// Feature flag: the "Book a Demo" / RevenueHero booking feature is kept in the
// code but disabled for now. Re-enable by setting
// NEXT_PUBLIC_ENABLE_BOOK_A_DEMO=true in .env.local (and restarting the dev server).
const BOOK_A_DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_BOOK_A_DEMO === "true";

export default function ChatInterface() {
  const [isMounted, setIsMounted] = useState(false);
  const [utms, setUtms] = useState<Record<string, string>>({});
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  // Save messages to sessionStorage whenever they change
  useEffect(() => {
    if (isMounted) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
    }
    // Check scroll position when messages change to potentially show the scroll button
    handleScroll();
  }, [messages, isMounted]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Show button if we are more than 50px away from the bottom
    const isNotAtBottom = scrollHeight - scrollTop - clientHeight > 50;
    setShowScrollButton(isNotAtBottom);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Build the booking page URL, forwarding any UTM params for attribution.
  const bookingUrl = (() => {
    if (!RH_BOOKING_URL) return "";
    try {
      const url = new URL(RH_BOOKING_URL);
      Object.entries(utms).forEach(([k, v]) => url.searchParams.set(k, v));
      return url.toString();
    } catch {
      return RH_BOOKING_URL;
    }
  })();

  const triggerRevenueHero = () => {
    if (!RH_BOOKING_URL) {
      console.error(
        "NEXT_PUBLIC_RH_BOOKING_URL is not set — add the RevenueHero Inbound router link URL to .env.local"
      );
    }
    setIsBooking(true);
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

  const renderMessageContent = (content: string, isAssistant: boolean) => {
    const hasButton = isAssistant && content.includes("[SHOW_DEMO_BUTTON]");
    const textToShow = content.replace(/\[SHOW_DEMO_BUTTON\]/g, "").replace(/\[OPEN_BOOKING\]/g, "").trim();
    
    return (
      <div className="flex flex-col items-start">
        <div>
          {textToShow.split("\\n").map((line, i) => (
            <span key={i}>
              {line}
              <br />
            </span>
          ))}
        </div>
        {hasButton && BOOK_A_DEMO_ENABLED && (
          <button
            type="button"
            onClick={triggerRevenueHero}
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 sm:p-6 backdrop-blur-sm">
      <div className="relative flex w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl h-[90vh] max-h-[800px]">

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
              {messages.map((m) => (
                <div key={m.id} className="relative group">
                  <div className={cn(
                    "flex items-start gap-4 py-4 border-b border-gray-100 last:border-b-0",
                  )}>
                    {m.role === "user" ? (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500">
                        <User size={16} />
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white border border-gray-100 overflow-hidden shadow-sm">
                        <img src="/logo.png" alt="Aria" className="h-6 w-6 object-contain" />
                      </div>
                    )}
                    <div className="flex-1 text-[15px] text-gray-800 leading-relaxed whitespace-pre-wrap mt-1">
                      {renderMessageContent(m.content, m.role === "assistant")}
                    </div>
                  </div>
                </div>
              ))}

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

        {/* RevenueHero Booking Overlay — embeds RH's hosted page (its own form
            + calendar) in an iframe. RH's CSP allows framing (frame-ancestors *). */}
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
            <div className="flex-1 overflow-hidden">
              {bookingUrl ? (
                <iframe
                  src={bookingUrl}
                  title="Book a Demo"
                  className="h-full w-full border-0"
                  allow="camera; microphone; fullscreen"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">
                  Booking link isn&apos;t configured. Set{" "}
                  <code className="mx-1">NEXT_PUBLIC_RH_BOOKING_URL</code> in
                  .env.local.
                </div>
              )}
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
