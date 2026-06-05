# AI Accountant Chatbot

This project is a Next.js (App Router) chatbot application for AI Accountant, designed to be embedded into a Webflow site as an iframe overlay.

## Running Locally

Because of the environment limitations, you must run standard installation and dev server commands yourself:

1. Clone or copy the files into a directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables: Rename `.env.example` to `.env.local` and add your OpenRouter API key.
4. Run the development server:
   ```bash
   npm run dev
   ```

## Webflow Integration Snippet

To embed this chatbot into Webflow, you'll need to add some custom HTML/JS. 

### 1. The Floating Button and Iframe Overlay
Add the following HTML in an "Embed" component on your Webflow site (or in the site-wide custom code section `Before </body> tag`):

```html
<!-- Floating Button (You can customize this button's CSS in Webflow or leave this basic style) -->
<button 
  id="aia-chat-trigger" 
  style="position: fixed; bottom: 20px; right: 20px; z-index: 9999; border-radius: 50px; background-color: #2563eb; color: white; border: none; padding: 12px 24px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15);"
>
  Ask Aria
</button>

<!-- Iframe Container (Hidden by default) -->
<div 
  id="aia-chat-overlay" 
  style="display: none; position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 10000; border: none; background: transparent;"
>
  <!-- Replace SRC with your actual deployed Vercel URL -->
  <iframe 
    src="https://your-vercel-app.vercel.app/" 
    style="width: 100%; height: 100%; border: none; background: transparent;"
    allowtransparency="true"
  ></iframe>
</div>

<!-- Integration Script -->
<script>
  document.addEventListener("DOMContentLoaded", function() {
    var triggerBtn = document.getElementById("aia-chat-trigger");
    var overlay = document.getElementById("aia-chat-overlay");

    // Open Chat
    if (triggerBtn) {
      triggerBtn.addEventListener("click", function() {
        overlay.style.display = "block";
        // To prevent scrolling of the main site when chat is open
        document.body.style.overflow = "hidden";
      });
    }

    // Listen for close message from the Next.js Iframe
    window.addEventListener("message", function(event) {
      // You can add origin validation here: if (event.origin !== "https://your-vercel-app.vercel.app") return;
      
      if (event.data && event.data.type === "CLOSE_CHAT") {
        overlay.style.display = "none";
        document.body.style.overflow = "auto";
      }
    });
  });
</script>
```

### 2. Replace the SRC URL
Ensure you replace the `src` attribute of the `<iframe>` with your actual Vercel deployment URL (e.g., `https://ai-accountant-chat.vercel.app`).

### Notes
- The Next.js application sets its root layout background to transparent so the iframe can show Webflow's background if needed, but it includes its own full-screen backdrop (`bg-black/55 backdrop-blur-sm`).
- RevenueHero triggers inside the Next.js iframe, so the iframe overlay must cover the full screen for the scheduler to display properly.
