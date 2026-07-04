/**
 * WhiteScreenDetector 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhiteScreenDetector } from '../../src/utils/white-screen';

describe('WhiteScreenDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"><p>Hello World</p></div>';
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });
    // mock elementFromPoint — jsdom 默认不实现
    document.elementFromPoint = vi.fn().mockReturnValue(document.getElementById('root'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应正确创建实例', () => {
    const detector = new WhiteScreenDetector();
    expect(detector).toBeDefined();
  });

  it('应接受自定义配置', () => {
    const detector = new WhiteScreenDetector({
      samplePoints: 16,
      threshold: 5,
      interval: 5000,
    });
    expect(detector).toBeDefined();
  });

  it('有内容的页面不应触发白屏回调', () => {
    const callback = vi.fn();
    const detector = new WhiteScreenDetector({
      samplePoints: 4,
      threshold: 3,
      interval: 100,
    });

    detector.start(callback);
    vi.advanceTimersByTime(500);

    expect(callback).not.toHaveBeenCalled();
  });

  it('白屏时应触发回调', () => {
    const callback = vi.fn();
    // elementFromPoint 返回 null 模拟白屏
    document.elementFromPoint = vi.fn().mockReturnValue(null);

    const detector = new WhiteScreenDetector({
      samplePoints: 4,
      threshold: 2,
      interval: 100,
    });

    detector.start(callback);
    vi.advanceTimersByTime(300); // 触发3次 → 超过 threshold(2) 触发回调

    expect(callback).toHaveBeenCalled();
  });

  it('连续白屏达到阈值才触发', () => {
    const callback = vi.fn();
    document.elementFromPoint = vi.fn().mockReturnValue(null);

    const detector = new WhiteScreenDetector({
      samplePoints: 4,
      threshold: 3,
      interval: 100,
    });

    detector.start(callback);
    vi.advanceTimersByTime(150); // 只触发1次，未达到 threshold(3)

    expect(callback).not.toHaveBeenCalled();
  });

  it('stop 应停止检测', () => {
    const callback = vi.fn();

    const detector = new WhiteScreenDetector({ interval: 100 });
    detector.start(callback);
    vi.advanceTimersByTime(50);
    detector.stop();
    vi.advanceTimersByTime(500);

    expect(callback).not.toHaveBeenCalled();
  });

  it('stop 未启动时不应报错', () => {
    const detector = new WhiteScreenDetector();
    expect(() => detector.stop()).not.toThrow();
  });

  it('窗口尺寸为0时不应触发白屏', () => {
    const callback = vi.fn();
    Object.defineProperty(window, 'innerWidth', { value: 0, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 0, writable: true });

    const detector = new WhiteScreenDetector({ interval: 100, threshold: 1 });
    detector.start(callback);
    vi.advanceTimersByTime(200);

    expect(callback).not.toHaveBeenCalled();
  });
});
