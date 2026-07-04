/**
 * 堆栈解析工具
 *
 * 将压缩后的堆栈字符串解析为结构化数据。
 * 支持 source-map 反解（可选集成）。
 */

export interface StackFrame {
  functionName?: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  source?: string;
}

/**
 * 解析错误堆栈字符串
 */
export function parseStackTrace(stack: string): StackFrame[] {
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const frame = parseStackLine(line.trim());
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

/**
 * 解析单行堆栈
 *
 * 支持格式：
 * - Chrome: at functionName (file:line:col)
 * - Firefox: functionName@file:line:col
 * - Safari: functionName@file:line:col
 */
function parseStackLine(line: string): StackFrame | null {
  // Chrome 格式: "at functionName (file:line:col)"
  const chromeMatch = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/);
  if (chromeMatch) {
    return {
      functionName: chromeMatch[1] || '<anonymous>',
      fileName: chromeMatch[2],
      lineNumber: parseInt(chromeMatch[3], 10),
      columnNumber: parseInt(chromeMatch[4], 10),
    };
  }

  // Firefox 格式: "functionName@file:line:col"
  const firefoxMatch = line.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
  if (firefoxMatch) {
    return {
      functionName: firefoxMatch[1] || '<anonymous>',
      fileName: firefoxMatch[2],
      lineNumber: parseInt(firefoxMatch[3], 10),
      columnNumber: parseInt(firefoxMatch[4], 10),
    };
  }

  return null;
}

/**
 * 格式化堆栈为人类可读字符串
 */
export function formatStackTrace(frames: StackFrame[]): string {
  return frames
    .map((frame) => {
      const fn = frame.functionName || '<anonymous>';
      const file = frame.fileName ? ` (${frame.fileName}:${frame.lineNumber})` : '';
      return `  at ${fn}${file}`;
    })
    .join('\n');
}
