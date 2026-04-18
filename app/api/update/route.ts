import { NextRequest, NextResponse } from "next/server";
import { getContactSummariesForPrompt } from "@/lib/data";

export async function POST(req: NextRequest) {
  const { text } = await req.json();

  if (!text?.trim()) {
    return NextResponse.json({ error: "No input text provided" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const knownContacts = await getContactSummariesForPrompt();

  const systemPrompt = `You are a smart personal CRM assistant. The user will describe a recent interaction or request about their professional network.

Your job is to parse their natural language input and return a structured JSON response.

Known contacts in the user's network:
${knownContacts.map((c) => `- ${c.name} (${c.role} @ ${c.company}), id: ${c.id}`).join("\n")}

Respond ONLY with a JSON object (no markdown, no explanation) in this exact format:
{
  "matched_contact": { "id": "...", "name": "..." } | null,
  "new_contact": { "name": "...", "company": "...", "role": "..." } | null,
  "interaction": { "type": "meeting" | "email" | "zoom" | "intro" | "message" | "event", "title": "...", "notes": "..." } | null,
  "reminder": { "date": "YYYY-MM-DD", "text": "..." } | null,
  "tags": ["..."],
  "summary": "One sentence describing what you did"
}

Rules:
- If a name in the input matches a known contact (fuzzy match ok), set matched_contact and leave new_contact null.
- If this is a new person not in the list, set new_contact and leave matched_contact null.
- If there's no clear person, both can be null.
- reminder MUST be null UNLESS the user EXPLICITLY asks to be reminded or signals clear future-tense intent. Examples that SHOULD create a reminder: "follow up next week", "ping me in 6 months", "remind me after the demo", "check back with her in Q2", "circle back in 2 weeks". Examples that should NOT create a reminder: "just met Alice", "had coffee with Bob", "sent a note to Carol", "great call with Dan". When in doubt, set reminder to null — we would rather miss a reminder than spam the user.
- For reminder dates: interpret relative terms like "next week", "early may", "in 3 days" relative to today (${new Date().toISOString().split("T")[0]}).
- tags should be 1-3 relevant tags like "investor", "follow-up", "opportunity", "intro", etc.
- summary should be a friendly one-liner like "Added meeting with Justin Smith and set a follow-up reminder for May 1"`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        max_tokens: 400,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: `OpenAI error: ${err}` }, { status: 500 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Failed to parse GPT response", raw }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
