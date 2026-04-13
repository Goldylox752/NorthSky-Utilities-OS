/* ================= CORE ================= */
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const cors = require("cors");
const Stripe = require("stripe");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ================= MIDDLEWARE ================= */
app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

/* ================= MEMORY DB ================= */
const users = new Map();
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30;

/* ================= CACHE ================= */
function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

/* ================= HELPERS ================= */
function normalizeURL(input) {
  try {
    if (!input) return null;
    input = input.trim();
    if (!input.startsWith("http")) input = "https://" + input;
    return new URL(input).toString();
  } catch {
    return null;
  }
}

function isURL(str) {
  try {
    new URL(str.startsWith("http") ? str : "https://" + str);
    return true;
  } catch {
    return false;
  }
}

/* ================= FETCH ================= */
async function fetchHTML(url) {
  try {
    const res = await axios.get(url, {
      timeout: 12000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    });
    return res.data;
  } catch {
    return null;
  }
}

/* ================= SCRAPER ================= */
function parseHTML(html, url) {
  const $ = cheerio.load(html);

  return {
    title:
      $("meta[property='og:title']").attr("content") ||
      $("title").text().trim() ||
      "Untitled",

    description:
      $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      $("p").first().text().trim().slice(0, 200) ||
      "",

    image: $("meta[property='og:image']").attr("content") || null,

    site: new URL(url).hostname.replace("www.", ""),
  };
}

/* ================= AI SCORING ================= */
function analyzeHTML(html, url) {
  const $ = cheerio.load(html);

  const title = $("title").text() || "";
  const desc = $("meta[name='description']").attr("content") || "";
  const h1 = $("h1").length;
  const imgs = $("img").length;
  const links = $("a").length;
  const ssl = url.startsWith("https");

  let seo = 50;
  let ux = 50;
  let conv = 50;

  if (title.length > 10) seo += 10;
  if (desc.length > 20) seo += 15;
  if (h1 > 0) seo += 10;
  if (links > 5) seo += 10;

  if (imgs > 0) ux += 10;
  if (h1 > 0) ux += 10;

  if (desc.length > 50) conv += 10;
  if (links > 3) conv += 10;
  if (ssl) conv += 10;

  return {
    seo: Math.min(seo, 100),
    ux: Math.min(ux, 100),
    conv: Math.min(conv, 100),
  };
}

/* ================= LIMIT MIDDLEWARE ================= */
function checkLimit(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || !users.has(apiKey)) {
    return res.status(401).json({ error: "invalid_api_key" });
  }

  const user = users.get(apiKey);

  if (user.usage >= user.limit) {
    return res.status(429).json({ error: "limit_reached", plan: user.plan });
  }

  user.usage++;
  users.set(apiKey, user);

  req.user = user;
  next();
}

/* ================= ENGINE ================= */
async function scrape(url) {
  const html = await fetchHTML(url);
  if (!html) return { success: false };

  return {
    success: true,
    metadata: parseHTML(html, url),
  };
}

/* ================= SEARCH ================= */
async function searchEngine(query) {
  return {
    success: true,
    query,
    results: [
      {
        title: `Search: ${query}`,
        url: `https://example.com?q=${encodeURIComponent(query)}`
      }
    ]
  };
}

/* ================= ASK ROUTER ================= */
async function askEngine(input) {
  if (isURL(input)) {
    return scrape(normalizeURL(input));
  }

  return searchEngine(input);
}

/* ================= STRIPE USER CREATE ================= */
app.post("/api/create-user", (req, res) => {
  const apiKey = uuidv4();

  users.set(apiKey, {
    apiKey,
    plan: "free",
    usage: 0,
    limit: 5
  });

  res.json({ success: true, apiKey });
});

/* ================= STRIPE SUBSCRIBE ================= */
app.post("/api/subscribe", async (req, res) => {
  const { apiKey } = req.body;

  if (!users.has(apiKey)) {
    return res.status(400).json({ error: "invalid_user" });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "NorthSky Auditor Pro"
          },
          unit_amount: 2900,
          recurring: { interval: "month" }
        },
        quantity: 1
      }
    ],
    success_url: `${process.env.BASE_URL}/success?apiKey=${apiKey}`,
    cancel_url: `${process.env.BASE_URL}/cancel`
  });

  res.json({ url: session.url });
});

/* ================= WEBHOOK ================= */
app.post("/api/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return res.status(400).send("Webhook Error");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const apiKey = new URL(session.success_url).searchParams.get("apiKey");

    if (users.has(apiKey)) {
      const user = users.get(apiKey);

      user.plan = "pro";
      user.limit = 1000;
      user.usage = 0;

      users.set(apiKey, user);
    }
  }

  res.json({ received: true });
});

/* ================= API ROUTES ================= */
app.get("/api/rip", checkLimit, async (req, res) => {
  const url = normalizeURL(req.query.url);
  if (!url) return res.status(400).json({ error: "invalid_url" });

  const result = await scrape(url);
  res.json(result);
});

app.post("/api/analyze", checkLimit, async (req, res) => {
  const url = normalizeURL(req.body.site);
  const html = await fetchHTML(url);

  if (!html) return res.status(500).json({ error: "fetch_failed" });

  const meta = parseHTML(html, url);
  const scores = analyzeHTML(html, url);

  res.json({
    success: true,
    meta,
    scores,
    result: `
SEO Score: ${scores.seo}/100
UX Score: ${scores.ux}/100
Conversion Score: ${scores.conv}/100
    `.trim()
  });
});

app.get("/api/ask", checkLimit, async (req, res) => {
  const q = req.query.q;
  const result = await askEngine(q);
  res.json(result);
});

/* ================= USER STATUS ================= */
app.get("/api/me", (req, res) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || !users.has(apiKey)) {
    return res.status(401).json({ error: "invalid_user" });
  }

  const user = users.get(apiKey);

  res.json({
    plan: user.plan,
    usage: user.usage,
    limit: user.limit,
    remaining: user.limit - user.usage
  });
});

/* ================= HEALTH ================= */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    users: users.size
  });
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`🚀 NorthSky OS v3 LIVE on ${PORT}`);
});