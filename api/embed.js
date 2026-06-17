// api/embed.js — Vercel Serverless Function
// Secure proxy for the OpenAI Embeddings API.
// The API key lives only in process.env — it is NEVER sent to the browser.
// Requires Node.js >= 18 for native global fetch.

module.exports = async function handler(req, res) {
  // CORS headers — allow any origin so the app works on local dev
  // and on Vercel preview/production deployments alike.
  // For a private production deploy, replace "*" with your actual domain.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Browser sends an OPTIONS preflight before the real POST — respond and stop.
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Vercel auto-parses application/json bodies into req.body.
  const { text } = req.body ?? {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: 'Missing or invalid "text" field' });
  }

  if (text.length > 500) {
    return res.status(400).json({ error: "Text too long (max 500 chars)" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Log server-side; never expose the reason to the client.
    console.error("[embed] OPENAI_API_KEY is not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.trim(),
      }),
    });
  } catch (networkErr) {
    console.error("[embed] Network error reaching OpenAI:", networkErr);
    return res.status(502).json({ error: "Could not reach OpenAI API" });
  }

  if (!openaiRes.ok) {
    const status = openaiRes.status;
    if (status === 401) {
      return res.status(401).json({ error: "OpenAI authentication failed — check the API key" });
    }
    if (status === 429) {
      return res.status(429).json({ error: "Rate limit reached — try again in a moment" });
    }
    // Map everything else to a generic error without leaking the raw OpenAI response.
    return res.status(status).json({ error: `OpenAI API error (${status})` });
  }

  let data;
  try {
    data = await openaiRes.json();
  } catch (parseErr) {
    console.error("[embed] Could not parse OpenAI response:", parseErr);
    return res.status(502).json({ error: "Invalid response from OpenAI API" });
  }

  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    console.error("[embed] Unexpected response shape:", JSON.stringify(data));
    return res.status(502).json({ error: "Unexpected response shape from OpenAI API" });
  }

  // Return only the embedding array — nothing else from the OpenAI response
  // reaches the browser (no usage stats, model name, index, etc.).
  return res.status(200).json({ embedding });
};
