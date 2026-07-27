import { isRecord } from "./shared";

const FORBIDDEN_KEYS = [
  "rawhtml",
  "raw_html",
  "rawscreenshot",
  "raw_screenshot",
  "screenshot",
  "cookie",
  "password",
  "authorization",
  "bearer",
  "apikey",
  "api_key",
  "browserprofile",
  "browser_profile",
  "profilepath",
  "profile_path",
  "rawfullpagetext",
  "raw_full_page_text",
  "chatcontent",
  "chat_content",
  "contactcontent",
  "contact_content",
  "accountevidence",
  "account_evidence",
  "platformsafeguarddetails",
  "platform_safeguard_details"
];

const SECRET_VALUE_PATTERNS = [/cookie\s*=/i, /password\s*=/i, /token\s*=/i, /authorization\s*:\s*bearer/i, /\bsk-[A-Za-z0-9_-]{8,}\b/];

export function collectSensitiveRepositoryFindings(value: unknown, path = "workbench"): string[] {
  if (typeof value === "string") {
    return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ? [path] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSensitiveRepositoryFindings(item, `${path}[${index}]`));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const keyPath = `${path}.${key}`;
    if (FORBIDDEN_KEYS.includes(normalizedKey)) return [keyPath];
    if ((normalizedKey === "sessionid" || normalizedKey === "session_id") && typeof nested === "string" && nested.trim()) {
      return [keyPath];
    }
    return collectSensitiveRepositoryFindings(nested, keyPath);
  });
}

// 外部抓取的文本（如 JD）可能恰好命中密钥样式，若不脱敏，保存时会被
// 敏感扫描直接拒绝并丢掉整条记录。命中片段连同行尾一起抹除。
export function redactSecretValues(text: string): string {
  let result = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    result = result.replace(new RegExp(`(?:${pattern.source})[^\\n]*`, flags), "[已脱敏]");
  }
  return result;
}
