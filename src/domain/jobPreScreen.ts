export interface KeywordPreScreenResult {
  matchedKeywords: string[];
  missedKeywords: string[];
  matchCount: number;
  totalKeywords: number;
  matchRatio: number;
  quickVerdict: "likely_match" | "possible_match" | "likely_skip";
}

export function preScreenJob(jdText: string, keywords: string[]): KeywordPreScreenResult {
  if (keywords.length === 0) {
    return {
      matchedKeywords: [],
      missedKeywords: [],
      matchCount: 0,
      totalKeywords: 0,
      matchRatio: 0,
      quickVerdict: "likely_skip"
    };
  }

  const normalizedJd = jdText.toLowerCase();
  const preparedKeywords = keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  const matchedKeywords: string[] = [];
  const missedKeywords: string[] = [];

  for (const keyword of preparedKeywords) {
    if (normalizedJd.includes(keyword.toLowerCase())) {
      matchedKeywords.push(keyword);
    } else {
      missedKeywords.push(keyword);
    }
  }

  const matchCount = matchedKeywords.length;
  const totalKeywords = preparedKeywords.length;
  const matchRatio = totalKeywords === 0 ? 0 : Number((matchCount / totalKeywords).toFixed(3));

  return {
    matchedKeywords,
    missedKeywords,
    matchCount,
    totalKeywords,
    matchRatio,
    quickVerdict: resolveVerdict(matchRatio)
  };
}

function resolveVerdict(matchRatio: number): KeywordPreScreenResult["quickVerdict"] {
  if (matchRatio >= 0.6) {
    return "likely_match";
  }
  if (matchRatio >= 0.3) {
    return "possible_match";
  }
  return "likely_skip";
}
