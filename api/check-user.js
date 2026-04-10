let users = [];

export default function handler(req, res) {
  const { email } = req.body;

  const user = users.find(u => u.email === email);

  res.json({ paid: user?.paid || false });
}


import { supabase } from "../lib/supabase";

export default async function handler(req, res) {
  const { email } = req.body;

  const { data } = await supabase
    .from("users")
    .select("paid")
    .eq("email", email)
    .single();

  res.json({ paid: data?.paid || false });
}