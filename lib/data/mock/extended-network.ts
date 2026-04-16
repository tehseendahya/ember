import type { ExtendedProfile } from "@/lib/types";

/** Second-degree connections shown in the network graph. Keyed by contact id. */
export const extendedConnections: Record<string, ExtendedProfile[]> = {
  "1": [
    { name: "Garry Tan", company: "Y Combinator", role: "President" },
    { name: "Peter Thiel", company: "Founders Fund", role: "Managing Partner" },
    { name: "Sam Altman", company: "OpenAI", role: "CEO" },
  ],
  "2": [
    { name: "Sundar Pichai", company: "Google", role: "CEO" },
    { name: "Jeff Dean", company: "Google DeepMind", role: "Chief Scientist" },
    { name: "Noam Shazeer", company: "Character AI", role: "CEO" },
  ],
  "3": [
    { name: "Paul Graham", company: "Y Combinator", role: "Co-founder" },
    { name: "Naval Ravikant", company: "AngelList", role: "Co-founder" },
  ],
  "4": [
    { name: "Greg Brockman", company: "OpenAI", role: "Co-founder" },
    { name: "Ilya Sutskever", company: "SSI", role: "CEO" },
    { name: "Andrej Karpathy", company: "Independent", role: "AI Researcher" },
  ],
  "5": [
    { name: "Jamie Dimon", company: "JPMorgan", role: "CEO" },
    { name: "Howard Marks", company: "Oaktree Capital", role: "Co-founder" },
  ],
  "6": [
    { name: "Patrick Collison", company: "Stripe", role: "CEO" },
    { name: "John Collison", company: "Stripe", role: "President" },
  ],
  "7": [
    { name: "Jason Fried", company: "37signals", role: "CEO" },
    { name: "Pieter Levels", company: "Independent", role: "Indie Hacker" },
  ],
  "9": [
    { name: "Guillermo Rauch", company: "Vercel", role: "CEO" },
    { name: "Rich Harris", company: "Vercel", role: "Staff Engineer" },
  ],
  "10": [
    { name: "Dylan Field", company: "Figma", role: "CEO" },
    { name: "Evan Wallace", company: "Figma", role: "Co-founder" },
  ],
  "12": [
    { name: "Doug Leone", company: "Sequoia", role: "Managing Partner" },
    { name: "Roelof Botha", company: "Sequoia", role: "Managing Partner" },
    { name: "Alfred Lin", company: "Sequoia", role: "Partner" },
  ],
  "15": [
    { name: "Ivan Zhao", company: "Notion", role: "CEO" },
    { name: "Simon Last", company: "Notion", role: "Co-founder" },
  ],
};
