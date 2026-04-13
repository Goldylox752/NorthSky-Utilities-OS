/* ================= CORE ================= */
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

/* ================= LOGGING ================= */
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

/* ================= CACHE ================= */
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30;

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

/* ================= URL NORMALIZER ================= */
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

/* ================= FETCH HTML ================= */
async function fetchHTML(url) {
  try {
    const res = await axios.get(url, {
      timeout: 12000,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    });

    return res.data;
  } catch (err) {
    console.log("FETCH ERROR:", err.message);
    return null;
  }
}

/* ================= PARSER ================= */
function parseHTML(html, url) {
  const $ = cheerio.load(html);

  const title =
    $("meta[property='og:title']").attr("content") ||
    $("meta[name='twitter:title']").attr("content") ||
    $("title").text().trim() ||
    "Untitled";

  const description =
    $("meta[property='og:description']").attr("content") ||
    $("meta[name='description']").attr("content") ||
    $("meta[name='twitter:description']").attr("content") ||
    $("p").first().text().trim().slice(0, 200) ||
    "";

  const image =
    $("meta[property='og:image']").attr("content") ||
    $("meta[name='twitter:image']").attr("content") ||
    null;

  const site = new URL(url).hostname.replace("www.", "");

  return {
    title,
    description,
    image,
    site,
    favicon: `https://${site}/favicon.ico`,
  };
}

/* ================= AI ANALYSIS ENGINE ================= */
function analyzeHTML(html, url) {
  const $ = cheerio.load(html);

  const title = $("title").text() || "";
  const desc = $("meta[name='description']").attr("content") || "";
  const h1 = $("h1").length;
  const imgs = $("img").length;
  const links = $("a").length;
  const hasSSL = url.startsWith("https");

  let seo = 50;
  let ux = 50;
  let conv = 50;

  // SEO scoring
  if (title.length > 10) seo += 10;
  if (desc) seo += 15;
  if (h1 > 0) seo += 10;
  if (imgs > 2) seo += 5;
  if (links > 5) seo += 10;

  // UX scoring
  if (imgs > 0) ux += 10;
  if (h1 > 0) ux += 10;
  if (title) ux += 10;

  // Conversion scoring
  if (desc.length > 50) conv += 10;
  if (links > 3) conv += 10;
  if (hasSSL) conv += 10;

  seo = Math.min(seo, 100);
  ux = Math.min(ux, 100);
  conv = Math.min(conv, 100);

  const insights = [];

  if (!desc) insights.push("Missing meta description hurts SEO.");
  if (h1 === 0) insights.push("No H1 tag found.");
  if (imgs < 2) insights.push("Low visual content reduces engagement.");
  if (links < 3) insights.push("Weak internal linking structure.");
  if (!hasSSL) insights.push("Site is not secure (no HTTPS).");

  return { seo, ux, conv, insights };
}

/* ================= ENGINE ================= */
async function engine(url) {
  const html = await fetchHTML(url);

  if (!html) return { success: false, error: "fetch_failed" };

  const metadata = parseHTML(html, url);

  if (!metadata) return { success: false, error: "parse_failed" };

  return { success: true, metadata, html };
}

/* ================= API: SCRAPER ================= */
app.get("/api/rip", async (req, res) => {
  try {
    const url = normalizeURL(req.query.url);
    if (!url) {
      return res.status(400).json({ success: false, error: "invalid_url" });
    }

    const key = crypto.createHash("md5").update(url).digest("hex");

    const cached = getCache(key);
    if (cached) {
      return res.json({ success: true, cached: true, ...cached });
    }

    const result = await engine(url);

    if (!result.success) {
      return res.status(500).json(result);
    }

    setCache(key, result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

/* ================= API: AI ANALYZER ================= */
app.post("/api/analyze", async (req, res) => {
  try {
    const url = normalizeURL(req.body.site);

    if (!url) {
      return res.status(400).json({ success: false, error: "invalid_url" });
    }

    const html = await fetchHTML(url);

    if (!html) {
      return res.status(500).json({ success: false, error: "fetch_failed" });
    }

    const meta = parseHTML(html, url);
    const scores = analyzeHTML(html, url);

    return res.json({
      success: true,
      result: `
SEO Score: ${scores.seo}/100
UX Score: ${scores.ux}/100
Conversion Score: ${scores.conv}/100

Insights:
- ${scores.insights.join("\n- ")}
      `.trim(),
      meta,
      scores,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

/* ================= HEALTH ================= */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    cacheSize: cache.size,
  });
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`🚀 NorthSky AI running on port ${PORT}`);
});