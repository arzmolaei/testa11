import { normalizeKeyword } from "./domain";
import type { Row } from "./types";

/** Local, reviewable lexical suggestions. They do not establish SERP similarity. */
export type KeywordRule = {
  id: string;
  phrase: string;
  group?: string;
  intent?: string;
};

export type SuggestionOptions = {
  scopeIds?: ReadonlySet<string>;
  replaceGroups?: boolean;
  replaceIntents?: boolean;
  suggestGroups?: boolean;
  suggestIntents?: boolean;
  mode?: "automatic" | "rules";
  rules?: readonly KeywordRule[];
};

export type KeywordSuggestion = {
  rowId: string;
  keyword: string;
  groupId: string;
  group?: string;
  intent?: string;
  reasons: string[];
  before: { keyword: string; group: string; intent: string };
};

export type SuggestionGroup = {
  id: string;
  label: string;
  rowIds: string[];
  examples: string[];
  groupCount: number;
  intentCount: number;
  intents: Record<string, number>;
};

export type SuggestionPreview = {
  scopeCount: number;
  protectedGroups: number;
  protectedIntents: number;
  suggestions: KeywordSuggestion[];
  groups: SuggestionGroup[];
};

type Modifier = { words: string[]; intent: string; label: string };
const modifier = (phrase: string, intent: string): Modifier => ({
  words: phrase.split(" "),
  intent,
  label: phrase,
});
// Longer expressions consume their words first: «راهنمای خرید» is a commercial
// investigation, while «خرید» on its own suggests a transactional intention.
const MODIFIERS: Modifier[] = [
  modifier("راهنمای خرید", "بررسی تجاری"),
  modifier("راهنما خرید", "بررسی تجاری"),
  modifier("آموزش نصب", "اطلاعاتی"),
  modifier("نحوه نصب", "اطلاعاتی"),
  modifier("روش نصب", "اطلاعاتی"),
  modifier("آموزش تعمیر", "اطلاعاتی"),
  modifier("نحوه تعمیر", "اطلاعاتی"),
  modifier("خدمات نصب", "تراکنشی"),
  modifier("خدمات تعمیر", "تراکنشی"),
  modifier("سایت رسمی", "ناوبری"),
  modifier("sign in", "ناوبری"),
  modifier("خرید", "تراکنشی"),
  modifier("سفارش", "تراکنشی"),
  modifier("فروش", "تراکنشی"),
  modifier("دانلود", "تراکنشی"),
  modifier("قیمت", "بررسی تجاری"),
  modifier("مقایسه", "بررسی تجاری"),
  modifier("بهترین", "بررسی تجاری"),
  modifier("بررسی", "بررسی تجاری"),
  modifier("vs", "بررسی تجاری"),
  modifier("versus", "بررسی تجاری"),
  modifier("آموزش", "اطلاعاتی"),
  modifier("نحوه", "اطلاعاتی"),
  modifier("چگونه", "اطلاعاتی"),
  modifier("چیست", "اطلاعاتی"),
  modifier("معنی", "اطلاعاتی"),
  modifier("تعریف", "اطلاعاتی"),
  modifier("راهنما", "اطلاعاتی"),
  modifier("راهنمای", "اطلاعاتی"),
  modifier("ورود", "ناوبری"),
  modifier("لاگین", "ناوبری"),
  modifier("login", "ناوبری"),
  modifier("نصب", "نیاز به بررسی"),
  modifier("تعمیر", "نیاز به بررسی"),
];
const EDGE_WORDS = new Set(["از", "به", "با", "برای", "در", "و", "یا", "است", "هست"]);
const asText = (value: unknown) => String(value ?? "").trim();
const tokensOf = (keyword: string) =>
  normalizeKeyword(keyword)
    // Keep punctuation inside model identifiers and a meaningful suffix «+».
    // For example 12.3, 12-3, 12/3 and S24+ are distinct product variants.
    .replace(/[^\p{L}\p{N}./+_-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[./_-]+|[./_-]+$/g, ""))
    .filter((token) => /[\p{L}\p{N}]/u.test(token));

export function analyzeKeyword(keyword: string): {
  core: string;
  intent?: string;
  evidence: string[];
} {
  const tokens = tokensOf(keyword);
  const used = new Set<number>();
  const evidence: string[] = [];
  const intents = new Set<string>();
  for (const pattern of MODIFIERS) {
    for (let start = 0; start <= tokens.length - pattern.words.length; start++) {
      if (
        pattern.words.every(
          (word, offset) => tokens[start + offset] === word && !used.has(start + offset),
        )
      ) {
        for (let offset = 0; offset < pattern.words.length; offset++) used.add(start + offset);
        intents.add(pattern.intent);
        if (!evidence.includes(pattern.label)) evidence.push(pattern.label);
      }
    }
  }
  const coreTokens = tokens.filter((_, index) => !used.has(index));
  while (coreTokens.length && EDGE_WORDS.has(coreTokens[0])) coreTokens.shift();
  while (coreTokens.length && EDGE_WORDS.has(coreTokens[coreTokens.length - 1])) coreTokens.pop();
  return {
    core: coreTokens.join(" "),
    ...(intents.size ? { intent: intents.size === 1 ? [...intents][0] : "نیاز به بررسی" } : {}),
    evidence,
  };
}

/** Exact normalized phrase matching keeps «دوربین» distinct from «دوربینی». */
export function matchesKeywordRule(keyword: string, phrase: string): boolean {
  const needle = tokensOf(phrase).join(" ");
  if (!needle) return false;
  return ` ${tokensOf(keyword).join(" ")} `.includes(` ${needle} `);
}

export function buildKeywordSuggestions(
  rows: readonly Row[],
  options: SuggestionOptions = {},
): SuggestionPreview {
  const suggestions: KeywordSuggestion[] = [];
  const grouped = new Map<string, SuggestionGroup>();
  let scopeCount = 0;
  let protectedGroups = 0;
  let protectedIntents = 0;
  const ruleMode = options.mode === "rules";
  const rules = (options.rules ?? [])
    .filter((rule) => asText(rule.phrase) && (asText(rule.group) || asText(rule.intent)))
    .map((rule) => ({ ...rule, needle: ` ${tokensOf(rule.phrase).join(" ")} ` }))
    .filter((rule) => rule.needle.trim());
  for (const row of rows) {
    if (options.scopeIds && !options.scopeIds.has(row.id)) continue;
    scopeCount++;
    const keyword = asText(row.keyword);
    if (!keyword) continue;
    const before = { keyword, group: asText(row.group), intent: asText(row.intent) };
    if (before.group && !options.replaceGroups) protectedGroups++;
    if (before.intent && !options.replaceIntents) protectedIntents++;
    const analysis = analyzeKeyword(keyword);
    let group = ruleMode ? "" : analysis.core;
    let intent = ruleMode ? "" : analysis.intent ?? "";
    const reasons: string[] = [];
    if (ruleMode) {
      const normalized = ` ${tokensOf(keyword).join(" ")} `;
      // First matching rule per field wins; rule order is visible to the user.
      for (const rule of rules) {
        if (!normalized.includes(rule.needle)) continue;
        if (!group && asText(rule.group)) group = asText(rule.group);
        if (!intent && asText(rule.intent)) intent = asText(rule.intent);
        if (!reasons.includes(rule.phrase)) reasons.push(rule.phrase);
        if (group && intent) break;
      }
    } else {
      if (analysis.core) reasons.push(`موضوع واژگانی: ${analysis.core}`);
      if (analysis.evidence.length) reasons.push(`نشانه‌های نیت: ${analysis.evidence.join("، ")}`);
    }
    const proposedGroup = options.suggestGroups !== false && group && (!before.group || options.replaceGroups) && group !== before.group ? group : undefined;
    const proposedIntent = options.suggestIntents !== false && intent && (!before.intent || options.replaceIntents) && intent !== before.intent ? intent : undefined;
    if (!proposedGroup && !proposedIntent) continue;
    const label = group || analysis.core || before.group || "بدون موضوع قابل تشخیص";
    const groupId = `${ruleMode ? "rule" : "core"}:${normalizeKeyword(label)}`;
    suggestions.push({
      rowId: row.id,
      keyword,
      groupId,
      ...(proposedGroup ? { group: proposedGroup } : {}),
      ...(proposedIntent ? { intent: proposedIntent } : {}),
      reasons,
      before,
    });
    let item = grouped.get(groupId);
    if (!item) {
      item = { id: groupId, label, rowIds: [], examples: [], groupCount: 0, intentCount: 0, intents: Object.create(null) as Record<string, number> };
      grouped.set(groupId, item);
    }
    item.rowIds.push(row.id);
    if (item.examples.length < 5) item.examples.push(keyword);
    if (proposedGroup) item.groupCount++;
    if (proposedIntent) {
      item.intentCount++;
      item.intents[proposedIntent] = (item.intents[proposedIntent] ?? 0) + 1;
    }
  }
  return {
    scopeCount,
    protectedGroups,
    protectedIntents,
    suggestions,
    groups: [...grouped.values()].sort((a, b) => b.rowIds.length - a.rowIds.length || a.label.localeCompare(b.label, "fa")),
  };
}

export type SuggestionApplyOptions = {
  excludedGroups?: ReadonlySet<string>;
  labels?: Readonly<Record<string, string>>;
};

export function applyKeywordSuggestions(
  rows: readonly Row[],
  preview: SuggestionPreview,
  options: SuggestionApplyOptions = {},
): {
  rows: Row[];
  changed: number;
  groupChanges: number;
  intentChanges: number;
  overwritten: number;
  skipped: number;
} {
  const plans = new Map(preview.suggestions.map((suggestion) => [suggestion.rowId, suggestion]));
  let changed = 0, groupChanges = 0, intentChanges = 0, overwritten = 0, skipped = 0;
  const nextRows = rows.map((row) => {
    const plan = plans.get(row.id);
    if (!plan || options.excludedGroups?.has(plan.groupId)) return row;
    // A preview must never overwrite edits made while it was open.
    if (asText(row.keyword) !== plan.before.keyword || asText(row.group) !== plan.before.group || asText(row.intent) !== plan.before.intent) {
      skipped++;
      return row;
    }
    const group = plan.group ? asText(options.labels?.[plan.groupId] ?? plan.group) : undefined;
    const intent = plan.intent;
    const patch: Partial<Row> = {};
    if (group && group !== asText(row.group)) {
      patch.group = group;
      groupChanges++;
      if (asText(row.group)) overwritten++;
    }
    if (intent && intent !== asText(row.intent)) {
      patch.intent = intent;
      intentChanges++;
      if (asText(row.intent)) overwritten++;
    }
    if (!Object.keys(patch).length) return row;
    changed++;
    return { ...row, ...patch };
  });
  return { rows: nextRows, changed, groupChanges, intentChanges, overwritten, skipped };
}
