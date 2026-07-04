/**
 * 白屏检测
 *
 * 通过采样页面关键点判断是否出现白屏。
 * 策略：在页面取 N 个采样点，检查是否有可见内容。
 */

export interface WhiteScreenConfig {
  /** 采样点数量 */
  samplePoints?: number;
  /** 检测阈值（连续多少次检测到白屏才上报） */
  threshold?: number;
  /** 检测间隔 (ms) */
  interval?: number;
}

const DEFAULT_CONFIG: Required<WhiteScreenConfig> = {
  samplePoints: 9,
  threshold: 3,
  interval: 3000,
};

export class WhiteScreenDetector {
  private config: Required<WhiteScreenConfig>;
  private whiteCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onWhiteScreen: (() => void) | null = null;

  constructor(config?: WhiteScreenConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 开始检测 */
  start(callback: () => void): void {
    this.onWhiteScreen = callback;
    this.timer = setInterval(() => this.check(), this.config.interval);
  }

  /** 停止检测 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.whiteCount = 0;
  }

  /** 执行一次白屏检测 */
  private check(): void {
    if (this.isWhiteScreen()) {
      this.whiteCount++;
      if (this.whiteCount >= this.config.threshold) {
        this.whiteCount = 0;
        this.onWhiteScreen?.();
      }
    } else {
      this.whiteCount = 0;
    }
  }

  /**
   * 通过采样点判断是否白屏
   *
   * 策略：
   * 1. 取页面对角线和中心共 N 个点
   * 2. 检查每个点处的 elementFromPoint 是否返回 null/body/html
   * 3. 如果大多数点都无内容，判断为白屏
   */
  private isWhiteScreen(): boolean {
    const { innerWidth, innerHeight } = window;
    if (innerWidth === 0 || innerHeight === 0) return false;

    const points = this.getSamplePoints(innerWidth, innerHeight);
    let emptyCount = 0;

    for (const [x, y] of points) {
      const element = document.elementFromPoint(x, y);
      if (!element || element === document.body || element === document.documentElement) {
        emptyCount++;
      }
    }

    // 超过 70% 的采样点无内容 → 疑似白屏
    return emptyCount / points.length > 0.7;
  }

  /** 生成采样点坐标（网格分布） */
  private getSamplePoints(width: number, height: number): [number, number][] {
    const points: [number, number][] = [];
    const cols = Math.ceil(Math.sqrt(this.config.samplePoints));
    const rows = Math.ceil(this.config.samplePoints / cols);

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (points.length >= this.config.samplePoints) break;
        points.push([
          Math.floor((width * (j + 0.5)) / cols),
          Math.floor((height * (i + 0.5)) / rows),
        ]);
      }
    }

    return points;
  }
}
