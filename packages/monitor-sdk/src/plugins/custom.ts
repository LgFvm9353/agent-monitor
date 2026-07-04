/**
 * CustomPlugin — 自定义事件插件
 *
 * 允许用户自定义监控事件，通过 monitor.report() 手动上报
 */

import type { MonitorCore } from '../core/types';
import { ListenerPlugin } from '../core/plugin';

export class CustomPlugin extends ListenerPlugin {
  name = 'custom-plugin';
  version = '0.1.0';

  onSetup(_monitor: MonitorCore): void {
    // CustomPlugin 本身不需要劫持任何事件
    // 它提供的是用户通过 monitor.report() 手动上报的能力
    // 这个能力已经内建在 Monitor 类中
  }

  onDestroy(): void {
    // noop
  }
}
