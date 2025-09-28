import { gunzipSync } from "node:zlib";
import { getAllMarketMetadata, insertMarketHeuristicSnapshots, getMetaNumberValue, setMetaNumberValue } from "./db.js";

const RULE_KEYS = [
  "rule",
  "rules",
  "description",
  "details",
  "criteria",
  "resolution",
  "settlement",
  "grading",
  "adjudication"
];

const SOURCE_KEYS = [
  "sources",
  "links",
  "references",
  "citations",
  "urls",
  "feeds"
];

const AMBIGUOUS_TERMS = [
  "likely",
  "maybe",
  "roughly",
  "approximately",
  "around",
  "about",
  "tbd",
  "subject to",
  "pending",
  "unless",
  "discretion",
  "or later",
  "unclear",
  "unknown",
  "not sure"
];

const VAGUE_PHRASES = [
  "as soon as",
  "at some point",
  "to be determined",
  "before the end",
  "by the end",
  "after announcement",
  "if possible",
  "subject to change",
  "final decision",
  "officially confirmed"
];

const URL_REGEX = /https?:\/\/[^\s)"']+/gi;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function collectAmbiguousTerms(text: string): { matches: string[]; vagueCount: number } {
  const tokens = tokenize(text);
  const matches = new Set<string>();
  for (const token of tokens) {
    if (AMBIGUOUS_TERMS.includes(token)) {
      matches.add(token);
    }
  }
  let vagueCount = 0;
  const lowered = text.toLowerCase();
  for (const phrase of VAGUE_PHRASES) {
    if (lowered.includes(phrase)) {
      vagueCount += 1;
    }
  }
  return { matches: [...matches], vagueCount };
}

function computeRuleAnalysis(ruleText: string | null | undefined) {
  if (!ruleText) {
    return { clarityScore: 0, ambiguousTerms: [] as string[], vaguePhraseCount: 0 };
  }
  const trimmed = ruleText.trim();
  if (!trimmed) {
    return { clarityScore: 0, ambiguousTerms: [] as string[], vaguePhraseCount: 0 };
  }
  const { matches, vagueCount } = collectAmbiguousTerms(trimmed);
  const tokenCount = Math.max(1, tokenize(trimmed).length);
  const penalty = Math.min(1, ((matches.length * 2 + vagueCount * 3) / tokenCount) * 12);
  const clarity = Math.max(0, 1 - penalty);
  return {
    clarityScore: Number(clarity.toFixed(3)),
    ambiguousTerms: matches,
    vaguePhraseCount: vagueCount
  };
}

function uniqueDomains(urls: string[]): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      out.add(host.startsWith("www.") ? host.slice(4) : host);
    } catch (error) {
      // ignore malformed URLs
    }
  }
  return [...out];
}

function computeSourceAnalysis(ruleText: string | null | undefined, explicitUrls: string[]) {
  const urls = new Set<string>();
  for (const url of explicitUrls) {
    if (url) urls.add(url);
  }
  if (ruleText) {
    const matches = ruleText.match(URL_REGEX) ?? [];
    for (const match of matches) {
      urls.add(match);
    }
  }
  const urlList = [...urls];
  const domains = uniqueDomains(urlList);
  const parityScore = urlList.length === 0 ? 0 : Math.min(1, domains.length / Math.max(1, urlList.length));
  return {
    urls: urlList,
    domains,
    parityScore: Number(parityScore.toFixed(3))
  };
}

function computeSettlementRisk(rule: ReturnType<typeof computeRuleAnalysis>, sources: ReturnType<typeof computeSourceAnalysis>) {
  const warnings: string[] = [];
  let score = 0.5;
  if (rule.clarityScore < 0.5) {
    warnings.push("Rule text contains ambiguity");
    score -= 0.2;
  }
  if (rule.vaguePhraseCount >= 2) {
    warnings.push("Multiple vague phrases detected");
    score -= 0.1;
  }
  if (sources.urls.length < 1) {
    warnings.push("No sources linked");
    score -= 0.15;
  } else if (sources.domains.length < 2) {
    warnings.push("Only one source domain found");
    score -= 0.1;
  }
  if (rule.ambiguousTerms.length >= 3) {
    warnings.push("Several ambiguous terms present");
    score -= 0.1;
  }
  score = Math.min(1, Math.max(0, score));
  return {
    score: Number(score.toFixed(3)),
    warnings
  };
}

function analyzeMarketHeuristics(ruleText: string | null | undefined, urls: string[] = []) {
  const ruleAnalysis = computeRuleAnalysis(ruleText);
  const sourceAnalysis = computeSourceAnalysis(ruleText, urls);
  const settlement = computeSettlementRisk(ruleAnalysis, sourceAnalysis);
  return {
    rule: ruleAnalysis,
    sources: sourceAnalysis,
    settlement
  };
}

function decodeMetadata(metadata: string | null): string | null {
  if (!metadata) return null;
  let decoded = metadata;
  if (metadata.startsWith("0x")) {
    try {
      const raw = Buffer.from(metadata.slice(2), "hex");
      const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
      const buffer = isGzip ? gunzipSync(raw) : raw;
      decoded = buffer.toString("utf8");
    } catch (error) {
      decoded = metadata;
    }
  }
  const trimmed = decoded.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLikelyUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function collectSourcesFromObject(value: unknown, seen: Set<unknown>, out: Set<string>) {
  if (!value) return;
  if (typeof value === "string") {
    if (isLikelyUrl(value)) {
      out.add(value.trim());
    }
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSourcesFromObject(entry, seen, out);
    }
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of SOURCE_KEYS) {
    if (key in obj) {
      collectSourcesFromObject(obj[key], seen, out);
    }
  }
  for (const key of Object.keys(obj)) {
    collectSourcesFromObject(obj[key], seen, out);
  }
}

function extractRuleFromObject(value: unknown, seen: Set<unknown>): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = extractRuleFromObject(entry, seen);
      if (match) return match;
    }
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  for (const key of RULE_KEYS) {
    if (key in obj) {
      const match = extractRuleFromObject(obj[key], seen);
      if (match) return match;
    }
  }
  for (const key of Object.keys(obj)) {
    const match = extractRuleFromObject(obj[key], seen);
    if (match) return match;
  }
  return undefined;
}

function interpretRuleAndSources(metadata: string | null): { rule: string | null; sources: string[] } {
  const decoded = decodeMetadata(metadata);
  if (!decoded) {
    return { rule: null, sources: [] };
  }
  const sources = new Set<string>();
  let rule: string | undefined;
  if (decoded.startsWith("{") || decoded.startsWith("[")) {
    try {
      const parsed = JSON.parse(decoded);
      rule = extractRuleFromObject(parsed, new Set());
      collectSourcesFromObject(parsed, new Set(), sources);
    } catch (error) {
      // fall through to text parsing
    }
  }
  if (!rule) {
    rule = decoded;
  }
  const matches = decoded.match(URL_REGEX) ?? [];
  for (const match of matches) {
    if (isLikelyUrl(match)) {
      sources.add(match);
    }
  }
  return {
    rule: rule ?? null,
    sources: [...sources]
  };
}

const HEURISTICS_META_KEY = "heuristics_last_synced_at";

export async function syncMarketHeuristicsSnapshots(log: (message: string, extra?: unknown) => void = console.log) {
  const markets = getAllMarketMetadata();
  if (markets.length === 0) {
    return;
  }
  const capturedAt = Math.floor(Date.now() / 1000);
  const rows = markets.map(({ marketId, metadata }) => {
    const interpreted = interpretRuleAndSources(metadata);
    const heuristics = analyzeMarketHeuristics(interpreted.rule, interpreted.sources);
    return {
      marketId,
      capturedAt,
      clarity: heuristics.rule.clarityScore,
      ambiguousTerms: heuristics.rule.ambiguousTerms,
      vagueCount: heuristics.rule.vaguePhraseCount,
      sourceCount: heuristics.sources.urls.length,
      sourceDomains: heuristics.sources.domains.length,
      parity: heuristics.sources.parityScore,
      settlementScore: heuristics.settlement.score,
      warnings: heuristics.settlement.warnings,
      metadata: {
        rule: interpreted.rule,
        sources: interpreted.sources
      }
    };
  });
  insertMarketHeuristicSnapshots(rows);
  setMetaNumberValue(HEURISTICS_META_KEY, capturedAt);
  log(`[heuristics] snapshot captured for ${rows.length} markets`);
}

export function getLastHeuristicsSnapshot(): number {
  return getMetaNumberValue(HEURISTICS_META_KEY);
}
