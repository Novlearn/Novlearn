export interface TextSegment {
  type: "text" | "math" | "display-math";
  content: string;
}

export function parseMathText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

    const mathContent = match[0];
    if (mathContent.startsWith("$$")) {
      segments.push({
        type: "display-math",
        content: mathContent.slice(2, -2),
      });
    } else {
      segments.push({
        type: "math",
        content: mathContent.slice(1, -1),
      });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  return segments;
}
