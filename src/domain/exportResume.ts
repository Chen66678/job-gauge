import type { MaterialPreview } from "../types";

export function exportToMarkdown(material: MaterialPreview, jobTitle: string, company: string): string {
  const title = [jobTitle.trim(), company.trim()].filter(Boolean).join(" - ");
  const sections = [
    title ? `# ${title}` : "# 定制简历",
    material.greeting.trim(),
    material.resumeLines.map((line) => `- ${line.text.trim()}`).join("\n")
  ].filter(Boolean);

  return `${sections.join("\n\n")}\n`;
}

export function exportToPlainText(material: MaterialPreview): string {
  const lines = [material.greeting.trim(), ...material.resumeLines.map(line => line.text.trim())].filter(Boolean);
  return lines.join("\n");
}
