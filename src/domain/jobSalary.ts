export function parseSalaryText(salaryText: string | null | undefined): [number, number] | null {
  if (!salaryText) return null;
  const text = salaryText.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (/面议|未披露|未显示|薪资.*?不?详|暂无/i.test(text)) return null;

  const toMonthlyK = (value: number) => Math.max(0, Math.round(value));

  const monthlyRange = text.match(/(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (monthlyRange) {
    const min = toMonthlyK(Number(monthlyRange[1]));
    const max = toMonthlyK(Number(monthlyRange[2]));
    return normalizeRange(min, max);
  }

  const monthlySingle = text.match(/(\d+(?:\.\d+)?)\s*[kK]/);
  if (monthlySingle) {
    const value = toMonthlyK(Number(monthlySingle[1]));
    return normalizeRange(value, value);
  }

  const dailyRange = text.match(/(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*元?\/\s*天/);
  if (dailyRange) {
    const min = toMonthlyK((Number(dailyRange[1]) * 21.75) / 1000);
    const max = toMonthlyK((Number(dailyRange[2]) * 21.75) / 1000);
    return normalizeRange(min, max);
  }

  const dailySingle = text.match(/(\d+(?:\.\d+)?)\s*元?\/\s*天/);
  if (dailySingle) {
    const value = toMonthlyK((Number(dailySingle[1]) * 21.75) / 1000);
    return normalizeRange(value, value);
  }

  return null;
}

function normalizeRange(min: number, max: number): [number, number] | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || (min === 0 && max === 0)) return null;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return [low, high];
}
