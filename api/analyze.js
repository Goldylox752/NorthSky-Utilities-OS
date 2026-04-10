export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let { site } = req.body;

  // ❌ INVALID
  if (!site || !site.includes(".")) {
    return res.status(400).json({
      result: "Enter a valid website"
    });
  }

  // 🔧 FIX URL
  if (!site.startsWith("http")) {
    site = "https://" + site;
  }

  // =============================
  // 🚫 RATE LIMIT (IMPORTANT)
  // =============================
  const ip = req.headers["x-forwarded-for"] || "unknown";

  global.calls = global.calls || {};

  if (!global.calls[ip]) {
    global.calls[ip] = 0;
  }

  if (global.calls[ip] > 10) {
    return res.status(429).json({
      result: "Too many requests — try again later"
    });
  }

  global.calls[ip]++;

  // continue with GPT + fetch...
}