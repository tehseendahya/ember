/**
 * Lightweight CSV utilities for the People importer.
 *
 * Safe for both client and server use — no Node-only APIs.
 *
 * Design notes:
 * - We handle the common RFC 4180 subset: quoted fields, escaped quotes (""),
 *   embedded commas and newlines inside quotes, CRLF/LF line endings, BOM stripping.
 * - We infer a column -> CRM field mapping from common header labels (LinkedIn,
 *   Apollo, HubSpot, Google Contacts exports). Consumers can override the
 *   auto-detected mapping before import.
 */

export type ImportField =
  | "name"
  | "firstName"
  | "lastName"
  | "email"
  | "company"
  | "role"
  | "linkedIn"
  | "notes"
  | "tags"
  | "ignore";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export interface ImportRow {
  name: string;
  email: string;
  company: string;
  role: string;
  linkedIn: string;
  notes: string;
  tags: string[];
  /** Whether the row looks sparse enough to benefit from AI enrichment. */
  looksSparse: boolean;
}

/**
 * Parse a CSV string into headers + rows. Gracefully handles:
 * - BOM prefix
 * - CRLF / LF
 * - Quoted fields with embedded commas, quotes ("") and newlines
 * - Trailing empty lines
 */
export function parseCsv(raw: string): ParsedCsv {
  const text = raw.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const trimmed = rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  if (trimmed.length === 0) return { headers: [], rows: [] };

  const headers = trimmed[0].map((h) => h.trim());
  const dataRows = trimmed.slice(1).map((r) => {
    const padded = r.slice(0, headers.length);
    while (padded.length < headers.length) padded.push("");
    return padded.map((cell) => cell.trim());
  });
  return { headers, rows: dataRows };
}

const FIELD_ALIASES: Record<Exclude<ImportField, "ignore">, string[]> = {
  name: ["name", "full name", "fullname", "contact", "contact name", "person", "display name"],
  firstName: ["first name", "firstname", "given name", "first"],
  lastName: ["last name", "lastname", "surname", "family name", "last"],
  email: ["email", "email address", "e-mail", "primary email", "work email", "personal email"],
  company: ["company", "organization", "org", "employer", "current company", "workplace", "company name"],
  role: ["role", "title", "position", "job title", "current role", "current title", "occupation", "headline"],
  linkedIn: ["linkedin", "linkedin url", "linkedin profile", "li", "profile url", "linkedin link"],
  notes: ["notes", "bio", "about", "description", "summary", "comments", "context", "memo"],
  tags: ["tags", "labels", "category", "categories", "segment", "lists", "list"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Guess a column->field mapping based on header text. Unknown headers map to "ignore".
 * If both `firstName` and `lastName` are detected, `name` will be synthesized at import time.
 */
export function inferColumnMapping(headers: string[]): ImportField[] {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<ImportField>();
  const mapping: ImportField[] = normalized.map(() => "ignore");

  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Exclude<ImportField, "ignore">, string[]][]) {
      if (used.has(field)) continue;
      if (aliases.some((a) => h === a || h.includes(a))) {
        mapping[i] = field;
        used.add(field);
        break;
      }
    }
  }
  return mapping;
}

function splitTagsCell(cell: string): string[] {
  if (!cell) return [];
  return cell
    .split(/[|,;]/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function sparseHeuristic(row: {
  name: string;
  company: string;
  role: string;
  notes: string;
  linkedIn: string;
}): boolean {
  if (!row.name) return false;
  const filled = [row.company, row.role, row.notes, row.linkedIn].filter((v) => v.trim().length > 0).length;
  return filled <= 1;
}

/**
 * Apply a mapping to parsed rows. Produces normalized ImportRow[] the API can accept.
 * - First/last name are joined when a dedicated `name` column is missing.
 * - Rows without a name are dropped (we can't do anything useful with them).
 */
export function buildImportRows(parsed: ParsedCsv, mapping: ImportField[]): ImportRow[] {
  const result: ImportRow[] = [];
  const colFor = (field: ImportField): number => mapping.findIndex((m) => m === field);
  const nameIdx = colFor("name");
  const firstIdx = colFor("firstName");
  const lastIdx = colFor("lastName");
  const emailIdx = colFor("email");
  const companyIdx = colFor("company");
  const roleIdx = colFor("role");
  const linkedInIdx = colFor("linkedIn");
  const notesIdx = colFor("notes");
  const tagsIdx = colFor("tags");

  for (const row of parsed.rows) {
    const explicitName = nameIdx >= 0 ? row[nameIdx]?.trim() ?? "" : "";
    const first = firstIdx >= 0 ? row[firstIdx]?.trim() ?? "" : "";
    const last = lastIdx >= 0 ? row[lastIdx]?.trim() ?? "" : "";
    const joined = [first, last].filter(Boolean).join(" ").trim();
    const name = explicitName || joined;
    if (!name) continue;

    const email = emailIdx >= 0 ? row[emailIdx]?.trim() ?? "" : "";
    const company = companyIdx >= 0 ? row[companyIdx]?.trim() ?? "" : "";
    const role = roleIdx >= 0 ? row[roleIdx]?.trim() ?? "" : "";
    const linkedIn = linkedInIdx >= 0 ? row[linkedInIdx]?.trim() ?? "" : "";
    const notes = notesIdx >= 0 ? row[notesIdx]?.trim() ?? "" : "";
    const tags = tagsIdx >= 0 ? splitTagsCell(row[tagsIdx] ?? "") : [];

    result.push({
      name,
      email,
      company,
      role,
      linkedIn,
      notes,
      tags,
      looksSparse: sparseHeuristic({ name, company, role, notes, linkedIn }),
    });
  }
  return result;
}

export const IMPORT_FIELD_OPTIONS: { value: ImportField; label: string }[] = [
  { value: "ignore", label: "Ignore" },
  { value: "name", label: "Full name" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "company", label: "Company" },
  { value: "role", label: "Role / title" },
  { value: "linkedIn", label: "LinkedIn" },
  { value: "notes", label: "Notes / bio" },
  { value: "tags", label: "Tags" },
];
