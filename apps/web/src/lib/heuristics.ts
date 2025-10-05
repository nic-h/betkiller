type RuleAnalysis = {
  clarityScore: number;
  ambiguousTerms: string[];
  vaguePhraseCount: number;
};

export type SourceAnalysis = {
  urls: string[];
  domains: string[];
  parityScore: number;
};

export type SettlementRiskAnalysis = {
  score: number;
  warnings: string[];
};

export type MarketHeuristics = {
  rule: RuleAnalysis;
  sources: SourceAnalysis;
  settlement: SettlementRiskAnalysis;
};

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

const URL_REGEX = /https?:\/\/[^\s)]+/gi;

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

function computeRuleAnalysis(ruleText: string | null | undefined): RuleAnalysis {
  if (!ruleText) {
    return { clarityScore: 0, ambiguousTerms: [], vaguePhraseCount: 0 };
  }
  const trimmed = ruleText.trim();
  if (!trimmed) {
    return { clarityScore: 0, ambiguousTerms: [], vaguePhraseCount: 0 };
  }
  const { matches, vagueCount } = collectAmbiguousTerms(trimmed);
  const tokenCount = Math.max(1, tokenize(trimmed).length);
  const penalty = Math.min(1, (matches.length * 2 + vagueCount * 3) / tokenCount * 12);
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

function computeSourceAnalysis(ruleText: string | null | undefined, explicitUrls: string[]): SourceAnalysis {
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

function computeSettlementRisk(rule: RuleAnalysis, sources: SourceAnalysis): SettlementRiskAnalysis {
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

export function analyzeMarketHeuristics(ruleText: string | null | undefined, urls: string[] = []): MarketHeuristics {
  const ruleAnalysis = computeRuleAnalysis(ruleText);
  const sourceAnalysis = computeSourceAnalysis(ruleText, urls);
  const settlement = computeSettlementRisk(ruleAnalysis, sourceAnalysis);
  return {
    rule: ruleAnalysis,
    sources: sourceAnalysis,
    settlement
  };
}
