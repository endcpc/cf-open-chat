export async function onRequest(context) {
  const { request, env } = context;

  // ---------- CORS pre‑flight ----------
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }

  // ---------- Only POST ----------
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ---------- API key ----------
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server error: missing API key" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // ---------- Parse body ----------
  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const {
    model = "openai/gpt-oss-20b:free", // choose a chat‑compatible model
    messages
  } = payload;

  if (!messages || !Array.isArray(messages)) {
    return new Response(
      JSON.stringify({ error: "Missing or malformed `messages` array" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ---------- Call OpenRouter ----------
  let openrouterResp;
  try {
    openrouterResp = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://no-chat.pages.dev/", // must be a real URL
          "X-Title": "AI Chat"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 1024
        })
      }
    );
  } catch (netErr) {
    // Network‑level failure (DNS, timeout, etc.)
    return new Response(
      JSON.stringify({ error: `Network error: ${netErr.message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // ---------- If NOT OK, read the *exact* error payload ----------
  if (!openrouterResp.ok) {
    let rawErrorBody = "";
    const contentType = openrouterResp.headers.get("content-type") || "";

    // Try JSON first, fall back to plain text
    if (contentType.includes("application/json")) {
      rawErrorBody = await openrouterResp.text(); // keep raw text for logging
    } else {
      rawErrorBody = await openrouterResp.text();
    }

    // Log to Cloudflare Workers console (visible in `wrangler tail` or Dashboard)
    console.error(
      `OpenRouter responded ${openrouterResp.status}: ${rawErrorBody}`
    );

    // Forward the raw payload to the caller – you’ll see it in the browser/network tab
    return new Response(rawErrorBody, {
      status: openrouterResp.status,
      headers: {
        // Preserve the original content‑type if possible, otherwise default to JSON
        "Content-Type": contentType || "application/json"
      }
    });
  }

  // ---------- Success path ----------
  const data = await openrouterResp.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
