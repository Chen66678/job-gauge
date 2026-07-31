import type { MaterialPreview, ResumeLine } from "../types";

export interface ResumeImageRenderInput {
  resumeLines: ResumeLine[];
}

export function buildResumeImageRenderInput(material: MaterialPreview): ResumeImageRenderInput {
  if (material.resumeLines.length === 0) {
    throw new Error("定制简历没有可渲染的事实行。");
  }

  const usedFactIds = new Set(material.usedFacts.map((fact) => fact.factId));
  for (const [index, line] of material.resumeLines.entries()) {
    if (line.factIds.length === 0 || line.factIds.some((factId) => factId.trim().length === 0)) {
      throw new Error(`定制简历第 ${index + 1} 行缺少有效 factIds，拒绝渲染图片。`);
    }
    if (line.factIds.some((factId) => !usedFactIds.has(factId))) {
      throw new Error(`定制简历第 ${index + 1} 行包含无法追溯的 factIds，拒绝渲染图片。`);
    }
  }

  return { resumeLines: material.resumeLines };
}

export function buildResumeImageHtml(input: ResumeImageRenderInput): string {
  const serializedLines = JSON.stringify(input.resumeLines.map((line) => line.text)).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #ffffff; }
    body {
      width: 960px;
      padding: 56px 64px;
      color: #111827;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 22px;
      line-height: 1.65;
    }
    .resume-line {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .resume-line + .resume-line { margin-top: 18px; }
  </style>
</head>
<body>
  <script>
    const lines = ${serializedLines};
    for (const text of lines) {
      const line = document.createElement("div");
      line.className = "resume-line";
      line.textContent = text;
      document.body.appendChild(line);
    }
  </script>
</body>
</html>`;
}
