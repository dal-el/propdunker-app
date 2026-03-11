
import { TEAM_ALIASES, TEAM_CANONICAL, TEAM_CODES, type TeamKey } from "./teamData";

function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extractRawTeam(input: any): string | null {
  if (!input) return null;
  if (typeof input === "string") return input;

  if (typeof input === "object") {
    return (
      input.name ||
      input.display ||
      input.team ||
      input.code ||
      input.abbr ||
      input.id ||
      null
    );
  }

  return String(input);
}

export function resolveTeamKey(rawInput: any): TeamKey | null {
  const raw = extractRawTeam(rawInput);
  if (!raw) return null;

  const s = String(raw).trim();
  if (!s) return null;

  const sClean = stripDiacritics(s);
  const lower = sClean.toLowerCase();
  const upper = sClean.toUpperCase();

  // 1) Direct canonical key (exact)
  if ((TEAM_CANONICAL as any)[s]) return s as TeamKey;

  // 2) Canonical key case-insensitive
  if ((TEAM_CANONICAL as any)[lower]) return lower as TeamKey;

  // 3) Direct alias
  const directAlias = (TEAM_ALIASES as any)[lower];
  if (directAlias) return directAlias as TeamKey;

  // 4) Provider code
  const code = (TEAM_CODES as any)[upper];
  if (code) return code as TeamKey;

  // 5) Normalized alias (remove punctuation / collapse spaces)
  const norm = lower
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const normAlias = (TEAM_ALIASES as any)[norm];
  if (normAlias) return normAlias as TeamKey;

  // 6) Snake canonical attempt
  const snake = norm.replace(/\s+/g, "_");
  if ((TEAM_CANONICAL as any)[snake]) return snake as TeamKey;

  return null;
}
