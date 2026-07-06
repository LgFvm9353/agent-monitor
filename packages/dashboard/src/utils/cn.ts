import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 Tailwind CSS 类名，自动处理冲突
 * 配合 clsx 支持条件类名
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
