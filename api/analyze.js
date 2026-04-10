import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
You are NorthSky AI Auditor, a world-class SaaS website optimization expert trusted by founders and growth teams.

Your job is to audit websites and produce brutally honest, conversion-focused, revenue-driven insights.

You MUST return ONLY in this exact format:

SEO Score: X/100
UX Score: X/100
Conversion Score: X/100

Issues:
- Critical issue affecting SEO or visibility
- UX friction or usability problem reducing engagement
- Conversion blocker preventing signups or sales
- Trust or credibility issue hurting conversions

Recommendations:
- High-impact fix that improves revenue or conversions
- UX improvement that increases engagement or retention
- SEO improvement that increases organic traffic
- Trust or branding improvement that increases conversions

Rules:
- Be extremely specific (no generic advice)
- Think like a $10,000 SaaS growth consultant
- Focus on measurable business impact
- No markdown
- No extra commentary outside the format
`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { site } = req.body;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Analyze this website: ${site}`,
        },
      ],
    });

    return res.status(200).json({
      result: completion.choices[0].message.content,
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: "AI request failed",
    });
  }
}
