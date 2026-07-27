// 门⑤ #10 domain 层工具函数收敛（账本 docs/backlog.md:132-134）。
// 这里只收敛"逐字节比对确认完全等价"的重复实现：stripMarkdownFence /
// clampConfidence / isRecord。coreApi.ts 里另有一个同名但实现不同的
// slugify（Unicode 属性类、无长度截断、不同兜底值），不属于真重复，
// 未纳入本次收敛，原地保留。

export function stripMarkdownFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value;
}

// followUp.ts / resumeExtraction.ts / jdExtraction.ts / preferenceParsing.ts
// 四处原实现逐字等价，收敛于此；coreApi.ts 的 slugify 语义不同，未合并。
export function slugifyAsciiWithCjk(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "item";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(3));
}
