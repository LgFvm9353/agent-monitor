/**
 * 错误去重 ID 生成
 *
 * 基于错误堆栈签名生成稳定的错误 ID，
 * 相同根因的错误获得相同的 ID，实现去重上报。
 */

/**
 * 生成错误唯一标识
 * @param stackOrMessage - 错误堆栈或消息
 * @returns 稳定的错误 ID
 */
export function generateErrorId(stackOrMessage: string): string {
  if (!stackOrMessage) return 'unknown-error';

  // 提取关键堆栈行（忽略行号/列号的微小差异）
  const signature = extractStackSignature(stackOrMessage);
  return hashString(signature);
}

/**
 * 提取堆栈签名：只保留函数名和文件名，忽略行列号
 */
function extractStackSignature(stack: string): string {
  const lines = stack.split('\n');

  // 过滤堆栈中无意义的行
  const meaningfulLines = lines.filter(
    (line) =>
      !line.includes('node_modules') &&
      !line.includes('agent-harness/monitor-sdk') && // 排除 SDK 自身
      line.trim().length > 0,
  );

  // 取前三行（通常是错误类型和调用栈入口）
  const keyLines = meaningfulLines.slice(0, 3);

  // 删除行列号
  return keyLines
    .map((line) => line.replace(/:\d+:\d+/g, '').replace(/https?:\/\/[^\s)]+/g, (url) => {
      // 只保留文件路径的最后一部分
      const parts = url.split('/');
      return parts[parts.length - 1] || url;
    }))
    .join('|');
}

/**
 * 简单哈希函数（djb2 算法）
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return 'err_' + (hash >>> 0).toString(36);
}
