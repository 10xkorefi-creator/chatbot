// Server-only helper: logs a user's chat prompt to Supabase.
//
// Uses Supabase's PostgREST endpoint directly via fetch, so there's no extra
// npm dependency. The table (public.chat_prompts) has RLS with an insert-only
// policy for the anon role, so this key can write rows but not read them.
//
// This function deliberately NEVER throws — prompt logging must never break or
// slow down the chat response.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

export async function logPrompt(prompt: string): Promise<void> {
  const trimmed = (prompt || "").trim();
  if (!trimmed) return;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn(
      "[logPrompt] SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set — skipping prompt logging"
    );
    return;
  }

  try {
    // NOTE: send the key only via the `apikey` header. Passing it as
    // `Authorization: Bearer` makes this project's gateway resolve a non-anon
    // role, which fails the insert-only RLS policy.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_prompts`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ prompt: trimmed }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[logPrompt] insert failed: ${res.status} ${detail}`);
    }
  } catch (err) {
    console.error("[logPrompt] insert error", err);
  }
}
