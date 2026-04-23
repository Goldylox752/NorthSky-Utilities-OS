import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ valid: false });
  }

  try {
    const { session_id } = req.body;

    if (!session_id) {
      return res.status(400).json({ valid: false });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (!session || session.payment_status !== "paid") {
      return res.json({ valid: false });
    }

    return res.json({
      valid: true,
      plan: session.metadata?.plan || "basic",
      email: session.customer_email || null,
    });

  } catch (err) {
    console.error("Verify error:", err);
    return res.status(500).json({ valid: false });
  }
}