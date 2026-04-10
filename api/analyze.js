import OpenAI from "openai";
import { getUserByEmail, incrementUsage } from "../lib/db";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
You are NorthSky AI Auditor, a world-class SaaS website optimization expert.

Return ONLY:

SEO Score: X/100
UX Score: X/100
Conversion Score: X/100

Issues:
- 4 specific issues

Recommendations:
- 4 high-impact fixes
`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { site, email } = req.body;

    // 1. Get user
    const user = await getUserByEmail(email);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // 2. Check usage limit
    if (!user.isPro && user.uses >= 3) {
      return res.status(403).json({ error: "Upgrade required" });
    }

    // 3. Call AI
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Analyze: ${site}` },
      ],
    });

    const result = completion.choices[0].message.content;

    // 4. Save usage
    await incrementUsage(email);

    return res.status(200).json({ result });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
