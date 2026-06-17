// api/embed.js — Vercel Serverless Function
// Secure proxy for the Cohere Embeddings API.
// The API key lives only in process.env — it is NEVER sent to the browser.
// Requires Node.js >= 18 for native global fetch.
// Model: embed-multilingual-v3.0 — 1024 dimensions, optimised for Spanish/multilingual.

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

  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    console.error("[embed] COHERE_API_KEY is not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }

  let cohereRes;
  try {
    cohereRes = await fetch("https://api.cohere.com/v2/embed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        texts: [text.trim()],
        model: "embed-multilingual-v3.0",
        input_type: "search_document",
        embedding_types: ["float"],
      }),
    });
  } catch (networkErr) {
    console.error("[embed] Network error reaching Cohere:", networkErr);
    return res.status(502).json({ error: "Could not reach Cohere API" });
  }

  if (!cohereRes.ok) {
    const status = cohereRes.status;
    if (status === 401) {
      return res.status(401).json({ error: "Cohere authentication failed — check the API key" });
    }
    if (status === 429) {
      return res.status(429).json({ error: "Rate limit reached — try again in a moment" });
    }
    return res.status(status).json({ error: `Cohere API error (${status})` });
  }

  let data;
  try {
    data = await cohereRes.json();
  } catch (parseErr) {
    console.error("[embed] Could not parse Cohere response:", parseErr);
    return res.status(502).json({ error: "Invalid response from Cohere API" });
  }

  const embedding = data?.embeddings?.float?.[0];
  if (!Array.isArray(embedding)) {
    console.error("[embed] Unexpected response shape:", JSON.stringify(data));
    return res.status(502).json({ error: "Unexpected response shape from Cohere API" });
  }

  // Return only the embedding array — 1024 floats for embed-multilingual-v3.0.
  return res.status(200).json({ embedding });
};
