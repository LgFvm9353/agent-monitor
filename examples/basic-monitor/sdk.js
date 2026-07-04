var AgentHarnessMonitor = (function (exports) {
    'use strict';

    class Pipeline {
        middlewares = [];
        onFlush;
        constructor(onFlush) {
            this.onFlush = onFlush;
            this.use(this.normalizeMiddleware());
            this.use(this.dedupMiddleware());
        }
        use(middleware) {
            this.middlewares.push(middleware);
        }
        async process(events) {
            if (events.length === 0)
                return;
            const runner = this.compose(this.middlewares);
            const processed = await runner(events);
            this.onFlush(processed);
        }
        compose(middlewares) {
            return (initial) => {
                let index = -1;
                const dispatch = (i, events) => {
                    if (i <= index)
                        return Promise.reject(new Error('next() called multiple times'));
                    index = i;
                    if (i >= middlewares.length)
                        return Promise.resolve(events);
                    return middlewares[i](events, (nextEvents) => dispatch(i + 1, nextEvents));
                };
                return dispatch(0, initial);
            };
        }
        // ===== 内置中间件 =====
        normalizeMiddleware() {
            return async (events, next) => {
                const normalized = events.map((event) => ({
                    ...event,
                    timestamp: event.timestamp || Date.now(),
                    meta: {
                        url: event.meta?.url || (typeof window !== 'undefined' ? window.location.href : ''),
                        userAgent: event.meta?.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
                        sessionId: event.meta?.sessionId || '',
                        pageId: event.meta?.pageId || '',
                        sdkVersion: event.meta?.sdkVersion || '0.1.0',
                        appId: event.meta?.appId || 'unknown',
                        tags: event.meta?.tags || {},
                    },
                }));
                return next(normalized);
            };
        }
        dedupMiddleware() {
            const errorMap = new Map();
            return async (events, next) => {
                const deduped = [];
                for (const event of events) {
                    if (event.type === 'error') {
                        const data = event.data;
                        const errorId = data.errorId;
                        if (errorId) {
                            const existing = errorMap.get(errorId);
                            if (existing) {
                                existing.count++;
                                continue; // 跳过重复错误
                            }
                            errorMap.set(errorId, { count: 1 });
                        }
                    }
                    deduped.push(event);
                }
                return next(deduped);
            };
        }
    }

    /**
     * Transport 传输层 — 参考 sky-monitor-sdk 架构重写
     *
     * 核心改进：
     * 1. 优先级队列 — high/normal/low 三级，容量上限保护
     * 2. 多模式发送 — immediate（关键错误）/ throttle（高频事件）/ batch（批量）
     * 3. 写前日志 — 每个事件先写 IndexedDB，发送成功后清除
     * 4. 指数退避 + 随机抖动 — 避免重试风暴
     */
    // ===== 默认配置 =====
    const DEFAULT_BATCH_SIZE = 10;
    const DEFAULT_FLUSH_INTERVAL = 5000;
    const DEFAULT_THROTTLE_INTERVAL = 1000;
    const DEFAULT_MAX_BUFFER = 100;
    const DEFAULT_MAX_RETRIES = 3;
    const DEFAULT_BASE_RETRY_DELAY = 1000;
    const DEFAULT_MAX_RETRY_DELAY = 30000;
    const DEFAULT_RETRY_JITTER = 0.2;
    /** 关键错误类型 — 默认立即发送（对齐 ErrorData.errorType） */
    const DEFAULT_CRITICAL_TYPES = ['js', 'promise', 'resource'];
    // ===== PriorityQueue — 优先级队列 =====
    class PriorityQueue {
        high = [];
        normal = [];
        low = [];
        maxSize;
        constructor(maxSize = DEFAULT_MAX_BUFFER) {
            this.maxSize = maxSize;
        }
        get size() {
            return this.high.length + this.normal.length + this.low.length;
        }
        get isEmpty() {
            return this.size === 0;
        }
        /** 入队，超出容量时按优先级淘汰 */
        enqueue(event, priority) {
            if (this.size >= this.maxSize) {
                // 1. 先丢弃 low
                if (this.low.length > 0) {
                    this.low.shift();
                }
                else if (this.normal.length > 0 && priority !== 'high') {
                    // 2. 丢弃 normal（仅当新事件不是 high 时）
                    this.normal.shift();
                }
                else {
                    return false; // 队列满且无法淘汰
                }
            }
            const entry = { event, priority, retryCount: 0 };
            switch (priority) {
                case 'high':
                    this.high.push(entry);
                    break;
                case 'normal':
                    this.normal.push(entry);
                    break;
                case 'low':
                    this.low.push(entry);
                    break;
            }
            return true;
        }
        /** 按优先级出队 */
        dequeue(count) {
            const result = [];
            while (result.length < count && this.size > 0) {
                if (this.high.length > 0)
                    result.push(this.high.shift());
                else if (this.normal.length > 0)
                    result.push(this.normal.shift());
                else if (this.low.length > 0)
                    result.push(this.low.shift());
            }
            return result;
        }
        /** 预览但不移除 */
        peek(count) {
            const result = [];
            let remaining = count;
            let i = 0;
            while (i < remaining && i < this.high.length)
                result.push(this.high[i++]);
            remaining = count - result.length;
            i = 0;
            while (i < remaining && i < this.normal.length)
                result.push(this.normal[i++]);
            remaining = count - result.length;
            i = 0;
            while (i < remaining && i < this.low.length)
                result.push(this.low[i++]);
            return result;
        }
        /** 放回队列头部 */
        unshift(entries) {
            for (const entry of [...entries].reverse()) {
                switch (entry.priority) {
                    case 'high':
                        this.high.unshift(entry);
                        break;
                    case 'normal':
                        this.normal.unshift(entry);
                        break;
                    case 'low':
                        this.low.unshift(entry);
                        break;
                }
            }
        }
        /** 清空队列 */
        clear() {
            this.high = [];
            this.normal = [];
            this.low = [];
        }
        get stats() {
            return {
                high: this.high.length,
                normal: this.normal.length,
                low: this.low.length,
            };
        }
    }
    // ===== RetryScheduler — 指数退避 + 抖动 =====
    class RetryScheduler {
        retryCount = 0;
        baseDelay;
        maxDelay;
        jitter;
        currentDelay;
        constructor(baseDelay, maxDelay, jitter) {
            this.baseDelay = baseDelay;
            this.maxDelay = maxDelay;
            this.jitter = jitter;
            this.currentDelay = baseDelay;
        }
        /** 获取下次重试延迟（带抖动） */
        getNextDelay() {
            const delay = this.addJitter(this.currentDelay);
            this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
            this.retryCount++;
            return delay;
        }
        /** 成功时重置 */
        reset() {
            this.currentDelay = this.baseDelay;
            this.retryCount = 0;
        }
        /** 记录失败（不影响 retryCount） */
        recordFailure() {
            this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
            this.retryCount++;
        }
        get count() {
            return this.retryCount;
        }
        addJitter(delay) {
            const factor = 1 + (Math.random() * 2 - 1) * this.jitter;
            return Math.round(delay * factor);
        }
    }
    // ===== Transport =====
    class Transport {
        reportUrl;
        batchSize;
        flushInterval;
        throttleInterval;
        maxRetries;
        enableOffline;
        defaultMode;
        typeConfig;
        criticalTypes;
        queue;
        throttleQueue;
        retryScheduler;
        flushTimer = null;
        throttleTimer = null;
        retryTimer = null;
        isFlushing = false;
        isRetrying = false;
        lastThrottleSend = 0;
        lastRetryTime = 0;
        // IndexedDB
        offlineDB = null;
        writeAheadEnabled = false;
        constructor(reportUrl, config) {
            this.reportUrl = reportUrl;
            this.batchSize = config?.batchSize ?? DEFAULT_BATCH_SIZE;
            this.flushInterval = config?.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
            this.throttleInterval = config?.throttleInterval ?? DEFAULT_THROTTLE_INTERVAL;
            this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
            this.enableOffline = config?.enableOffline ?? true;
            this.defaultMode = config?.mode ?? 'batch';
            this.typeConfig = config?.typeConfig ?? {};
            this.criticalTypes = new Set(config?.criticalTypes ?? DEFAULT_CRITICAL_TYPES);
            // 关键类型默认走 immediate
            for (const type of this.criticalTypes) {
                if (!this.typeConfig[type]) {
                    this.typeConfig[type] = 'immediate';
                }
            }
            const maxBuffer = config?.maxBufferSize ?? DEFAULT_MAX_BUFFER;
            this.queue = new PriorityQueue(maxBuffer);
            this.throttleQueue = new PriorityQueue(maxBuffer);
            this.retryScheduler = new RetryScheduler(config?.baseRetryDelay ?? DEFAULT_BASE_RETRY_DELAY, config?.maxRetryDelay ?? DEFAULT_MAX_RETRY_DELAY, config?.retryJitter ?? DEFAULT_RETRY_JITTER);
            this.initWriteAheadLog();
            this.startTimers();
            this.setupUnloadHandler();
        }
        // ===== 公开接口 =====
        /** 将事件加入传输队列 */
        enqueue(event) {
            const mode = this.getMode(event);
            const priority = this.getPriority(event);
            switch (mode) {
                case 'immediate':
                    this.sendImmediate(event);
                    break;
                case 'throttle':
                    this.throttleQueue.enqueue(event, priority);
                    break;
                case 'batch':
                default: {
                    const ok = this.queue.enqueue(event, priority);
                    if (!ok) {
                        console.warn('[AgentHarnessMonitor] Buffer full, event dropped:', event.type);
                    }
                    // 写前日志：存到 IndexedDB
                    this.writeAhead(event);
                    // 达到批量大小立即刷出
                    if (this.queue.size >= this.batchSize) {
                        this.flush();
                    }
                    break;
                }
            }
        }
        /** 立即发送排队事件 */
        async flush() {
            if (this.queue.isEmpty || this.isFlushing)
                return;
            this.isFlushing = true;
            try {
                const batch = this.queue.dequeue(this.batchSize);
                if (batch.length === 0)
                    return;
                const events = batch.map((e) => e.event);
                const success = await this.send(events);
                if (success) {
                    this.retryScheduler.reset();
                    // 发送成功，从 IndexedDB 清除已发送事件
                    this.clearSentFromOffline(events);
                }
                else {
                    // 发送失败，放回队列重试
                    for (const entry of batch) {
                        entry.retryCount++;
                        if (entry.retryCount < this.maxRetries) {
                            this.queue.unshift([entry]);
                        }
                        // 超出重试次数，数据已在 IndexedDB 中，丢弃队列中的副本
                    }
                    this.scheduleRetry();
                }
            }
            catch {
                this.scheduleRetry();
            }
            finally {
                this.isFlushing = false;
            }
        }
        /** 节流刷出 */
        throttleFlush() {
            const now = Date.now();
            if (now - this.lastThrottleSend < this.throttleInterval)
                return;
            this.lastThrottleSend = now;
            if (!this.throttleQueue.isEmpty) {
                const batch = this.throttleQueue.dequeue(this.batchSize);
                const events = batch.map((e) => e.event);
                this.send(events).catch(() => {
                    // 失败放回节流队列
                    this.throttleQueue.unshift(batch);
                });
            }
            // 同时刷批量队列
            this.flush();
        }
        /** 销毁 Transport */
        destroy() {
            this.stopTimers();
            // 最后用 sendBeacon 清空队列
            this.flushBeacon();
        }
        // ===== 私有方法：发送 =====
        async send(events) {
            try {
                const response = await fetch(this.reportUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(events),
                    keepalive: true,
                });
                return response.ok;
            }
            catch {
                return false;
            }
        }
        /** 立即发送（用于关键错误），失败回退到批量队列 */
        async sendImmediate(event) {
            // 同时也写前日志
            this.writeAhead(event);
            const success = await this.send([event]);
            if (!success) {
                // 回退：作为高优先级加入批量队列
                this.queue.enqueue(event, 'high');
                this.scheduleRetry();
            }
            else {
                this.clearSentFromOffline([event]);
            }
        }
        /** 通过 sendBeacon 发送（页面卸载时） */
        sendBeacon(events) {
            if (typeof navigator === 'undefined' || !navigator.sendBeacon)
                return false;
            try {
                const blob = new Blob([JSON.stringify(events)], { type: 'application/json' });
                return navigator.sendBeacon(this.reportUrl, blob);
            }
            catch {
                return false;
            }
        }
        /** 页面卸载时清空所有队列 */
        flushBeacon() {
            const allBatch = this.queue.dequeue(this.queue.size);
            const allThrottle = this.throttleQueue.dequeue(this.throttleQueue.size);
            const all = [...allBatch, ...allThrottle];
            if (all.length === 0)
                return;
            const events = all.map((e) => e.event);
            if (!this.sendBeacon(events)) {
                // sendBeacon 失败，放回队列（数据在 IndexedDB 中有备份）
                this.queue.unshift(allBatch);
                this.throttleQueue.unshift(allThrottle);
            }
        }
        // ===== 私有方法：辅助 =====
        getMode(event) {
            // 从 event.data 中提取 errorType 用于匹配
            const errorType = event.type === 'error' && event.data && typeof event.data === 'object'
                ? event.data.errorType
                : undefined;
            // 用 errorType 匹配（如 'js_error'）
            if (errorType && this.typeConfig[errorType]) {
                return this.typeConfig[errorType];
            }
            // 用 event.type 匹配（如 'error'）
            return this.typeConfig[event.type] ?? this.defaultMode;
        }
        getPriority(event) {
            // 关键错误 → high
            if (event.type === 'error' && event.data && typeof event.data === 'object') {
                const errorType = event.data.errorType;
                if (errorType && this.criticalTypes.has(errorType))
                    return 'high';
            }
            return 'normal';
        }
        // ===== 私有方法：定时器 =====
        startTimers() {
            // 批量刷出定时器
            this.flushTimer = setInterval(() => {
                if (!this.queue.isEmpty && !this.isFlushing) {
                    this.flush();
                }
            }, this.flushInterval);
            // 节流刷出定时器
            this.throttleTimer = setInterval(() => {
                this.throttleFlush();
            }, this.throttleInterval);
        }
        stopTimers() {
            if (this.flushTimer) {
                clearInterval(this.flushTimer);
                this.flushTimer = null;
            }
            if (this.throttleTimer) {
                clearInterval(this.throttleTimer);
                this.throttleTimer = null;
            }
            if (this.retryTimer) {
                clearTimeout(this.retryTimer);
                this.retryTimer = null;
            }
        }
        setupUnloadHandler() {
            if (typeof window === 'undefined')
                return;
            // pagehide: 比 beforeunload 更可靠（包括移动端）
            const handler = (event) => {
                // PageTransitionEvent.persisted: true 表示页面被缓存（bfcache），不需要 flush
                if (event instanceof PageTransitionEvent && event.persisted)
                    return;
                this.flushBeacon();
            };
            window.addEventListener('pagehide', handler);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    this.flushBeacon();
                }
            });
        }
        // ===== 私有方法：重试 =====
        scheduleRetry() {
            if (this.isRetrying || this.retryTimer)
                return;
            // 防止频繁重试（30秒内最多触发一次重试调度）
            const now = Date.now();
            if (now - this.lastRetryTime < 30000)
                return;
            this.lastRetryTime = now;
            const delay = this.retryScheduler.getNextDelay();
            this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                this.isRetrying = true;
                this.flush().finally(() => {
                    this.isRetrying = false;
                });
            }, delay);
        }
        // ===== 私有方法：写前日志（IndexedDB） =====
        initWriteAheadLog() {
            if (!this.enableOffline || typeof indexedDB === 'undefined')
                return;
            const request = indexedDB.open('AgentHarnessMonitor', 1);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('offlineEvents')) {
                    db.createObjectStore('offlineEvents', { keyPath: 'eventId' });
                }
            };
            request.onsuccess = (event) => {
                this.offlineDB = event.target.result;
                this.writeAheadEnabled = true;
                // 恢复离线缓存的旧事件
                this.recoverOfflineEvents();
            };
        }
        /** 写前日志：每个事件先存 IndexedDB */
        writeAhead(event) {
            if (!this.writeAheadEnabled || !this.offlineDB)
                return;
            try {
                const tx = this.offlineDB.transaction('offlineEvents', 'readwrite');
                const store = tx.objectStore('offlineEvents');
                store.put(event);
            }
            catch {
                // IndexedDB 写入失败不影响主流程
            }
        }
        /** 发送成功后从 IndexedDB 清除 */
        clearSentFromOffline(events) {
            if (!this.writeAheadEnabled || !this.offlineDB)
                return;
            try {
                const tx = this.offlineDB.transaction('offlineEvents', 'readwrite');
                const store = tx.objectStore('offlineEvents');
                for (const event of events) {
                    store.delete(event.eventId);
                }
            }
            catch {
                // 清除失败不影响
            }
        }
        /** 恢复离线事件 */
        async recoverOfflineEvents() {
            if (!this.offlineDB)
                return;
            try {
                const tx = this.offlineDB.transaction('offlineEvents', 'readonly');
                const store = tx.objectStore('offlineEvents');
                const request = store.getAll();
                request.onsuccess = async () => {
                    const events = request.result;
                    if (events.length === 0)
                        return;
                    const success = await this.send(events);
                    if (success) {
                        // 恢复成功，清除离线缓存
                        const deleteTx = this.offlineDB.transaction('offlineEvents', 'readwrite');
                        const deleteStore = deleteTx.objectStore('offlineEvents');
                        for (const event of events) {
                            deleteStore.delete(event.eventId);
                        }
                    }
                    else {
                        // 恢复失败，事件保留在 IndexedDB，等待下次恢复
                        // 同时放入批量队列尝试发送
                        for (const event of events) {
                            this.queue.enqueue(event, 'normal');
                        }
                    }
                };
            }
            catch {
                // 恢复失败不影响
            }
        }
    }

    let instanceId = 0;
    class Monitor {
        config;
        plugins = [];
        pipeline;
        transport;
        sessionId;
        breadcrumbs = [];
        started = false;
        collectTimer = null;
        beforeSend;
        debug;
        constructor(config) {
            this.config = { enabled: true, sampleRate: 1, ...config };
            this.beforeSend = config.beforeSend ?? null;
            this.debug = config.debug ?? false;
            this.transport = new Transport(config.reportUrl, config.transport);
            this.pipeline = new Pipeline((events) => {
                for (const event of events) {
                    this.transport.enqueue(event);
                }
            });
            this.sessionId = this.generateSessionId();
        }
        // ===== Plugin Management =====
        use(plugin) {
            this.plugins.push(plugin);
            if (this.started) {
                plugin.setup?.(this);
            }
        }
        async start() {
            if (this.started)
                return;
            if (!this.config.enabled) {
                this.log('Monitor disabled via config');
                return;
            }
            if (!this.shouldSample('custom', this.config.sampleRate ?? 1)) {
                this.log('Monitor excluded by global sample rate');
                return;
            }
            this.started = true;
            this.log(`Monitor started (session: ${this.sessionId})`);
            for (const plugin of this.plugins) {
                await plugin.setup?.(this);
            }
            this.collectTimer = setInterval(async () => {
                await this.collect();
            }, 5000);
        }
        destroy() {
            this.started = false;
            if (this.collectTimer)
                clearInterval(this.collectTimer);
            for (const plugin of this.plugins) {
                plugin.destroy?.();
            }
            this.transport.flush();
            this.transport.destroy();
            this.log('Monitor destroyed');
        }
        // ===== Event Reporting =====
        report(event) {
            // 分类型采样检查
            if (!this.shouldSample(event.type, this.config.sampleRate ?? 1))
                return;
            const fullEvent = this.enrichEvent({
                eventId: this.generateEventId(),
                ...event,
                meta: {
                    url: typeof window !== 'undefined' ? window.location.href : '',
                    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
                    sessionId: this.sessionId,
                    pageId: this.getPageId(),
                    sdkVersion: "0.1.0",
                    appId: this.config.appId || 'unknown',
                    tags: { ...(this.config.appId ? { appId: this.config.appId } : {}) },
                    ...event.meta,
                },
                data: { ...event.data, breadcrumbs: [...this.breadcrumbs] },
            });
            // beforeSend 钩子：返回 null 则丢弃
            const processed = this.beforeSend ? this.beforeSend(fullEvent) : fullEvent;
            if (!processed) {
                this.log(`Event dropped by beforeSend: ${fullEvent.type}`);
                return;
            }
            this.pipeline.process([processed]);
        }
        // ===== Breadcrumb Management =====
        addBreadcrumb(breadcrumb) {
            this.breadcrumbs.push({ ...breadcrumb, timestamp: Date.now() });
            if (this.breadcrumbs.length > 100)
                this.breadcrumbs.shift();
        }
        getSessionId() {
            return this.sessionId;
        }
        // ===== Internal Methods =====
        async collect() {
            for (const plugin of this.plugins) {
                if (plugin.collect) {
                    try {
                        const rawEvents = await plugin.collect();
                        if (rawEvents.length > 0) {
                            // 为 collect 产生的事件补充 eventId 和 meta
                            const enriched = rawEvents
                                .filter((e) => this.shouldSample(e.type, this.config.sampleRate ?? 1))
                                .map((e) => this.enrichEvent(e));
                            if (enriched.length > 0) {
                                // beforeSend 过滤
                                const processed = this.beforeSend
                                    ? enriched.map((e) => this.beforeSend(e)).filter((e) => e !== null)
                                    : enriched;
                                if (processed.length > 0) {
                                    this.pipeline.process(processed);
                                }
                            }
                        }
                    }
                    catch (err) {
                        this.log(`Plugin ${plugin.name} collect error:`, err);
                    }
                }
            }
        }
        /** 为插件产出的事件补充完整字段 */
        enrichEvent(event) {
            return {
                eventId: event.eventId || this.generateEventId(),
                type: event.type,
                timestamp: event.timestamp || Date.now(),
                data: event.data,
                meta: {
                    url: typeof window !== 'undefined' ? window.location.href : '',
                    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
                    sessionId: this.sessionId,
                    pageId: this.getPageId(),
                    sdkVersion: "0.1.0",
                    appId: this.config.appId || 'unknown',
                    tags: { ...(this.config.appId ? { appId: this.config.appId } : {}) },
                    ...event.meta,
                },
            };
        }
        /** 分类型采样检查 */
        shouldSample(eventType, sampleRate) {
            if (typeof sampleRate === 'number') {
                return Math.random() < sampleRate;
            }
            const rate = sampleRate[eventType] ?? 1;
            return Math.random() < rate;
        }
        generateSessionId() {
            return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
        }
        generateEventId() {
            instanceId++;
            return `${this.sessionId}-${instanceId}`;
        }
        getPageId() {
            return typeof window !== 'undefined' ? window.location.pathname : '';
        }
        log(...args) {
            if (this.debug) {
                console.log('[AgentHarnessMonitor]', ...args);
            }
        }
    }

    /**
     * Plugin 基类 — 所有插件的抽象基类
     *
     * 插件生命周期：
     *   setup → collect (looping) → destroy
     *
     * 每个插件专注一种数据采集类型：
     *   ErrorPlugin    → JS Error / Promise Rejection / Resource Error
     *   PerformancePlugin → Web Vitals / Navigation Timing
     *   BehaviorPlugin → Clicks / Routes / HTTP Requests
     *   CustomPlugin   → 用户自定义事件
     */
    class BasePlugin {
        monitor = null;
        setup(monitor) {
            this.monitor = monitor;
            this.onSetup(monitor);
        }
        destroy() {
            this.onDestroy();
            this.monitor = null;
        }
    }
    /** 主动采集型插件基类（性能、行为类） */
    class CollectorPlugin extends BasePlugin {
    }
    /** 被动监听型插件基类（错误类） */
    class ListenerPlugin extends BasePlugin {
    }

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
    function generateErrorId(stackOrMessage) {
        if (!stackOrMessage)
            return 'unknown-error';
        // 提取关键堆栈行（忽略行号/列号的微小差异）
        const signature = extractStackSignature(stackOrMessage);
        return hashString(signature);
    }
    /**
     * 提取堆栈签名：只保留函数名和文件名，忽略行列号
     */
    function extractStackSignature(stack) {
        const lines = stack.split('\n');
        // 过滤堆栈中无意义的行
        const meaningfulLines = lines.filter((line) => !line.includes('node_modules') &&
            !line.includes('agent-harness/monitor-sdk') && // 排除 SDK 自身
            line.trim().length > 0);
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
    function hashString(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
        }
        return 'err_' + (hash >>> 0).toString(36);
    }

    /**
     * ErrorPlugin — 错误追踪插件
     *
     * 捕获四类错误：
     * 1. JS 运行时错误 (window.onerror)
     * 2. Promise 未处理拒绝 (unhandledrejection)
     * 3. 静态资源加载失败 (error event on window)
     * 4. console.error 劫持
     *
     * 错误去重：基于堆栈签名生成唯一 errorId
     */
    class ErrorPlugin extends ListenerPlugin {
        name = 'error-plugin';
        version = '0.1.0';
        originalConsoleError = null;
        onSetup(monitor) {
            this.captureJSErrors(monitor);
            this.capturePromiseRejections(monitor);
            this.captureResourceErrors(monitor);
            this.hijackConsoleError(monitor);
        }
        onDestroy() {
            // 恢复 console.error
            if (this.originalConsoleError) {
                console.error = this.originalConsoleError;
            }
        }
        /** 捕获 JS 运行时错误 */
        captureJSErrors(monitor) {
            window.addEventListener('error', (event) => {
                if (!event.error && event.target instanceof Element)
                    return; // 跳过资源错误
                const errorData = this.buildErrorData(event, 'js');
                monitor.report({
                    type: 'error',
                    timestamp: Date.now(),
                    data: errorData,
                });
            });
        }
        /** 捕获 Promise 未处理拒绝 */
        capturePromiseRejections(monitor) {
            window.addEventListener('unhandledrejection', (event) => {
                const reason = event.reason;
                const errorData = {
                    errorType: 'promise',
                    message: reason instanceof Error ? reason.message : String(reason),
                    stack: reason instanceof Error ? reason.stack : undefined,
                    errorId: generateErrorId(reason instanceof Error && reason.stack ? reason.stack : 'promise:' + String(reason)),
                };
                monitor.report({
                    type: 'error',
                    timestamp: Date.now(),
                    data: errorData,
                });
            });
        }
        /** 捕获静态资源加载失败 */
        captureResourceErrors(monitor) {
            window.addEventListener('error', (event) => {
                const target = event.target;
                if (!target || !('src' in target || 'href' in target))
                    return;
                const src = ('src' in target && typeof target.src === 'string' ? target.src : '') ||
                    ('href' in target && typeof target.href === 'string' ? target.href : '');
                const errorData = {
                    errorType: 'resource',
                    message: `Failed to load resource: ${src}`,
                    filename: src,
                    errorId: generateErrorId('resource:' + src),
                };
                monitor.report({
                    type: 'error',
                    timestamp: Date.now(),
                    data: errorData,
                });
            }, true);
        }
        /** 劫持 console.error */
        hijackConsoleError(monitor) {
            this.originalConsoleError = console.error;
            console.error = (...args) => {
                this.originalConsoleError?.apply(console, args);
                const message = args.map((arg) => arg instanceof Error ? arg.message : String(arg)).join(' ');
                const errorData = {
                    errorType: 'console',
                    message,
                    errorId: generateErrorId('console:' + message.substring(0, 200)),
                };
                monitor.report({
                    type: 'error',
                    timestamp: Date.now(),
                    data: errorData,
                });
            };
        }
        buildErrorData(event, category) {
            return {
                errorType: category,
                message: event.message || 'Unknown error',
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error instanceof Error ? event.error.stack : undefined,
                errorId: generateErrorId(event.error instanceof Error ? (event.error.stack || event.message || 'unknown') : (event.message || 'unknown')),
            };
        }
    }

    /**
     * PerformancePlugin — 性能监控插件
     *
     * 采集指标：
     * 1. Core Web Vitals (LCP, FCP, INP, CLS, TTFB)
     * 2. Navigation Timing (DNS, TCP, Request, DOM Parse)
     * 3. Long Task 监控
     *
     * 设计：Observer 回调仅存储指标，由 collect() 统一产出事件。
     * 避免每条指标立即上报造成的重复和碎片化。
     */
    class PerformancePlugin extends CollectorPlugin {
        name = 'performance-plugin';
        version = '0.1.0';
        /** 存储 Web Vitals 观测值 */
        webVitals = {};
        /** 存储 Long Task 数据 */
        longTaskDurations = [];
        /** 标记 Navigation Timing 是否已采集（只需采一次） */
        navTimingCollected = false;
        /** 存储 CLS 累计值引用 */
        clsValue = 0;
        onSetup(_monitor) {
            this.observeWebVitals();
            this.observeLongTasks();
        }
        onDestroy() {
            this.webVitals = {};
            this.longTaskDurations = [];
            this.clsValue = 0;
        }
        /** 定期采集 — 合并 Web Vitals + Navigation Timing + Long Tasks 为一次上报 */
        collect() {
            const events = [];
            // 首次 collect 时抓取 Navigation Timing
            if (!this.navTimingCollected) {
                const navTiming = this.collectNavigationTiming();
                if (navTiming) {
                    this.navTimingCollected = true;
                    Object.assign(this.webVitals, navTiming);
                }
            }
            // 汇总 Web Vitals
            if (Object.keys(this.webVitals).length > 0) {
                events.push({
                    type: 'performance',
                    timestamp: Date.now(),
                    data: { perfType: 'web-vital', ...this.webVitals },
                });
                // 重置 Web Vitals（CLS 只在页面隐藏时上报，不重置）
                const cls = this.webVitals.cls;
                this.webVitals = {};
                if (cls !== undefined)
                    this.webVitals.cls = cls;
            }
            // 汇总 Long Tasks
            if (this.longTaskDurations.length > 0) {
                const count = this.longTaskDurations.length;
                const avg = this.longTaskDurations.reduce((a, b) => a + b, 0) / count;
                const max = Math.max(...this.longTaskDurations);
                events.push({
                    type: 'performance',
                    timestamp: Date.now(),
                    data: {
                        perfType: 'long-task',
                        customMetrics: {
                            longTaskCount: count,
                            longTaskAvg: Math.round(avg),
                            longTaskMax: Math.round(max),
                        },
                    },
                });
                this.longTaskDurations = [];
            }
            return events;
        }
        // ===== Web Vitals 观测 =====
        observeWebVitals() {
            this.observeLCP();
            this.observeFCP();
            this.observeCLS();
            this.observeINP();
            this.observeTTFB();
        }
        observeLCP() {
            if (!('PerformanceObserver' in window))
                return;
            try {
                const observer = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    const lastEntry = entries[entries.length - 1];
                    if (lastEntry) {
                        this.webVitals.lcp = lastEntry.startTime;
                    }
                });
                observer.observe({ type: 'largest-contentful-paint', buffered: true });
            }
            catch { /* 浏览器不支持 */ }
        }
        observeFCP() {
            if (!('PerformanceObserver' in window))
                return;
            try {
                const observer = new PerformanceObserver((list) => {
                    const entries = list.getEntriesByName('first-contentful-paint');
                    if (entries.length > 0) {
                        this.webVitals.fcp = entries[0].startTime;
                    }
                });
                observer.observe({ type: 'paint', buffered: true });
            }
            catch { /* 浏览器不支持 */ }
        }
        observeCLS() {
            if (!('PerformanceObserver' in window))
                return;
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (!entry.hadRecentInput) {
                            this.clsValue += entry.value;
                        }
                    }
                });
                observer.observe({ type: 'layout-shift', buffered: true });
                // CLS 在页面生命周期内累计，页面隐藏时上报最终值
                window.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') {
                        this.webVitals.cls = this.clsValue;
                    }
                });
            }
            catch { /* 浏览器不支持 */ }
        }
        observeINP() {
            if (!('PerformanceObserver' in window))
                return;
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.webVitals.inp = entry.duration;
                    }
                });
                observer.observe({ type: 'first-input', buffered: true });
            }
            catch { /* 浏览器不支持 */ }
        }
        observeTTFB() {
            if (!('PerformanceObserver' in window))
                return;
            try {
                const observer = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    for (const entry of entries) {
                        this.webVitals.ttfb = entry.responseStart - entry.requestStart;
                    }
                });
                observer.observe({ type: 'navigation', buffered: true });
            }
            catch { /* fallback 到 Navigation Timing */ }
        }
        // ===== Long Task 观测 =====
        observeLongTasks() {
            if (!('PerformanceObserver' in window))
                return;
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.longTaskDurations.push(entry.duration);
                    }
                });
                observer.observe({ type: 'longtask', buffered: true });
            }
            catch { /* 浏览器不支持 */ }
        }
        // ===== Navigation Timing =====
        collectNavigationTiming() {
            const timing = performance.getEntriesByType('navigation')[0];
            if (!timing)
                return null;
            return {
                perfType: 'navigation',
                dnsTime: timing.domainLookupEnd - timing.domainLookupStart,
                tcpTime: timing.connectEnd - timing.connectStart,
                requestTime: timing.responseStart - timing.requestStart,
                responseTime: timing.responseEnd - timing.responseStart,
                domParseTime: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
                domReadyTime: timing.domContentLoadedEventEnd - timing.fetchStart,
                loadTime: timing.loadEventEnd - timing.fetchStart,
            };
        }
    }

    /**
     * BehaviorPlugin — 用户行为追踪插件
     *
     * 采集：
     * 1. 点击事件面包屑
     * 2. SPA 路由变化 (hash + history)
     * 3. HTTP 请求监控 (Fetch + XHR 拦截，慢请求/错误)
     * 4. PV/UV 统计
     */
    class BehaviorPlugin extends CollectorPlugin {
        name = 'behavior-plugin';
        version = '0.1.0';
        pvReported = false;
        clickBuffer = [];
        routeBuffer = [];
        httpBuffer = [];
        onSetup(monitor) {
            this.captureClicks(monitor);
            this.captureRoutes(monitor);
            this.interceptFetch(monitor);
            this.interceptXHR(monitor);
            this.reportPV(monitor);
        }
        onDestroy() {
            this.clickBuffer = [];
            this.routeBuffer = [];
            this.httpBuffer = [];
        }
        collect() {
            const allData = [...this.clickBuffer, ...this.routeBuffer, ...this.httpBuffer];
            this.clickBuffer = [];
            this.routeBuffer = [];
            this.httpBuffer = [];
            if (allData.length === 0)
                return [];
            return allData.map((data) => ({
                type: 'behavior',
                timestamp: Date.now(),
                data,
            }));
        }
        /** 点击事件追踪 */
        captureClicks(monitor) {
            document.addEventListener('click', (event) => {
                const target = event.target;
                if (!target?.tagName)
                    return;
                const data = {
                    behaviorType: 'click',
                    tagName: target.tagName.toLowerCase(),
                    className: typeof target.className === 'string' ? target.className : '',
                    textContent: target.textContent?.substring(0, 100) ?? '',
                    xpath: this.getXPath(target),
                };
                this.clickBuffer.push(data);
                // 同时添加面包屑
                monitor.addBreadcrumb({
                    type: 'click',
                    message: `Click: ${data.tagName}${data.className ? '.' + data.className : ''}`,
                    data: { xpath: data.xpath },
                });
            }, true);
        }
        /** SPA 路由变化追踪 */
        captureRoutes(monitor) {
            const trackRoute = (from, to) => {
                this.routeBuffer.push({ behaviorType: 'route', from, to });
                monitor.addBreadcrumb({
                    type: 'route',
                    message: `Route: ${from} → ${to}`,
                    data: { from, to },
                });
            };
            let currentPath = window.location.href;
            const originalPushState = history.pushState.bind(history);
            const originalReplaceState = history.replaceState.bind(history);
            history.pushState = function (data, _unused, url) {
                const newPath = url != null ? String(url) : '';
                originalPushState(data, _unused, url ?? null);
                if (newPath && newPath !== currentPath) {
                    trackRoute(currentPath, newPath);
                    currentPath = newPath;
                }
            };
            history.replaceState = function (data, _unused, url) {
                const newPath = url != null ? String(url) : '';
                originalReplaceState(data, _unused, url ?? null);
                if (newPath && newPath !== currentPath) {
                    trackRoute(currentPath, newPath);
                    currentPath = newPath;
                }
            };
            window.addEventListener('popstate', () => {
                const newPath = window.location.href;
                if (newPath !== currentPath) {
                    trackRoute(currentPath, newPath);
                    currentPath = newPath;
                }
            });
            window.addEventListener('hashchange', () => {
                trackRoute(currentPath, window.location.href);
                currentPath = window.location.href;
            });
        }
        /** 拦截 Fetch 请求 */
        interceptFetch(monitor) {
            const originalFetch = window.fetch.bind(window);
            window.fetch = async function (input, init) {
                const startTime = performance.now();
                const url = typeof input === 'string' ? input
                    : input instanceof Request ? input.url
                        : input.toString();
                const method = init?.method ?? 'GET';
                try {
                    const response = await originalFetch(input, init);
                    const duration = performance.now() - startTime;
                    monitorSlowOrErrorRequest(url, method, response.status, duration, monitor);
                    return response;
                }
                catch (error) {
                    const duration = performance.now() - startTime;
                    monitor.addBreadcrumb({
                        type: 'http',
                        message: `[Error] ${method} ${url} (${duration.toFixed(0)}ms)`,
                        data: { method, url, error: String(error), duration },
                    });
                    throw error;
                }
            };
        }
        /** 拦截 XMLHttpRequest */
        interceptXHR(monitor) {
            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (method, url, asyncFlag, username, password) {
                this._monitor_data = { method, url: url.toString(), startTime: performance.now() };
                return originalOpen.call(this, method, url, asyncFlag ?? true, username ?? undefined, password ?? undefined);
            };
            XMLHttpRequest.prototype.send = function (body) {
                const xhr = this;
                const data = xhr._monitor_data;
                xhr.addEventListener('loadend', () => {
                    if (!data)
                        return;
                    const duration = performance.now() - data.startTime;
                    monitorSlowOrErrorRequest(data.url, data.method, xhr.status, duration, monitor);
                });
                return originalSend.call(this, body);
            };
        }
        /** PV 上报 */
        reportPV(monitor) {
            if (this.pvReported)
                return;
            this.pvReported = true;
            // PV 使用立即上报（通过 monitor.report），不走 collect buffer
            monitor.report({
                type: 'behavior',
                timestamp: Date.now(),
                data: {
                    behaviorType: 'route',
                    from: '',
                    to: window.location.href,
                },
            });
        }
        /** 获取元素的 XPath */
        getXPath(element) {
            if (element === document.body)
                return '/html/body';
            if (element.id)
                return `//*[@id="${element.id}"]`;
            const parts = [];
            let current = element;
            while (current && current !== document.body) {
                let selector = current.tagName.toLowerCase();
                if (current.id) {
                    selector = `//*[@id="${current.id}"]`;
                    parts.unshift(selector);
                    break;
                }
                const parent = current.parentElement;
                if (parent) {
                    const siblings = [];
                    for (let k = 0; k < parent.children.length; k++) {
                        if (parent.children[k].tagName === current.tagName) {
                            siblings.push(parent.children[k]);
                        }
                    }
                    if (siblings.length > 1) {
                        const index = siblings.indexOf(current) + 1;
                        selector += `[${index}]`;
                    }
                }
                parts.unshift(selector);
                current = parent;
            }
            return '/' + parts.join('/');
        }
    }
    /**
     * 监控慢请求（>1000ms）和错误请求（status >= 400）
     * 将数据同时写入面包屑和行为 Buffer
     */
    function monitorSlowOrErrorRequest(url, method, status, duration, monitor) {
        const isSlow = duration > 1000;
        const isError = status >= 400;
        if (!isSlow && !isError)
            return;
        monitor.addBreadcrumb({
            type: 'http',
            message: `${method} ${url} → ${status} (${duration.toFixed(0)}ms)`,
            data: { method, url, status, duration },
        });
        // 通过 monitor.report 上报 HTTP 行为事件（不在 collect buffer 中，
        // 而是直接通过 report + breadcrumb 附带上下文信息）
        monitor.report({
            type: 'behavior',
            timestamp: Date.now(),
            data: {
                behaviorType: 'http',
                method,
                url: url.length > 500 ? url.substring(0, 500) : url,
                status,
                duration: Math.round(duration),
            },
        });
    }

    /**
     * CustomPlugin — 自定义事件插件
     *
     * 允许用户自定义监控事件，通过 monitor.report() 手动上报
     */
    class CustomPlugin extends ListenerPlugin {
        name = 'custom-plugin';
        version = '0.1.0';
        onSetup(_monitor) {
            // CustomPlugin 本身不需要劫持任何事件
            // 它提供的是用户通过 monitor.report() 手动上报的能力
            // 这个能力已经内建在 Monitor 类中
        }
        onDestroy() {
            // noop
        }
    }

    /**
     * TracePlugin — SSE 流式 Trace 追踪插件
     *
     * 监控 AI Agent SSE 流式响应的完整生命周期：
     *   开始 → 首字节(TTFB) → 数据块流 → 工具调用 → 阶段追踪 → 完成/错误/中断
     *
     * 参考 @jerry_aurora/sky-monitor-sdk 的 Trace 架构设计。
     *
     * 使用方式:
     *   monitor.use(new TracePlugin());
     *   const trace = monitor.createTrace({ aiMessageId: 'msg-1' });
     *   trace.start();
     *   trace.firstChunk();           // 首字节到达
     *   trace.toolStart('search', { query: '...' });
     *   trace.toolEnd('search', { toolCallId, success: true });
     *   trace.complete();
     */
    // ===== Trace 类 =====
    class Trace {
        /** Trace 唯一 ID */
        traceId;
        /** 关联的 AI 消息 ID */
        aiMessageId;
        /** 前一次 Trace ID */
        previousTraceId;
        monitor;
        state = 'idle';
        startTime = null;
        firstChunkTime = null;
        lastChunkTime = null;
        /** 阶段记录: phaseName → startTime */
        phases = new Map();
        /** 工具调用记录: toolCallId → { name, startTime } */
        tools = new Map();
        /** 图片加载记录: imageUrl → startTime */
        imageLoads = new Map();
        /** 停顿检测定时器 */
        stallTimer = null;
        isStalled = false;
        stallThreshold;
        constructor(monitor, options = {}) {
            this.monitor = monitor;
            this.traceId = this.generateId();
            this.aiMessageId = options.aiMessageId;
            this.previousTraceId = options.previousTraceId;
            this.stallThreshold = options.stallThreshold ?? 5000;
        }
        // ===== 生命周期 =====
        /** 标记 Trace 开始 */
        start() {
            if (this.state !== 'idle')
                return;
            this.state = 'started';
            this.startTime = Date.now();
            this.track('sse_start');
            // 如果有关联的前一次 trace，记录重试事件
            if (this.previousTraceId) {
                this.track('user_retry', {
                    previousTraceId: this.previousTraceId,
                });
            }
        }
        /** 首字节到达 — 计算 TTFB */
        firstChunk() {
            if (this.state !== 'started' || this.firstChunkTime !== null)
                return;
            this.firstChunkTime = Date.now();
            const ttfb = this.firstChunkTime - (this.startTime || this.firstChunkTime);
            this.track('sse_first_chunk', { ttfb });
        }
        /** 记录数据块 — 驱动停顿检测 */
        recordChunk() {
            if (this.state !== 'started')
                return;
            const now = Date.now();
            // 从停顿中恢复
            if (this.isStalled && this.lastChunkTime) {
                const stallDuration = now - this.lastChunkTime;
                this.track('sse_resume', { stallDuration });
                this.isStalled = false;
            }
            this.lastChunkTime = now;
            this.startStallDetection();
        }
        /** 流完成 */
        complete() {
            if (this.state !== 'started')
                return;
            this.state = 'ended';
            this.stopStallDetection();
            const ttlb = Date.now() - (this.startTime || Date.now());
            this.track('sse_complete', { ttlb });
        }
        /** 流出错 */
        error(error) {
            if (this.state !== 'started')
                return;
            this.state = 'ended';
            this.stopStallDetection();
            const duration = Date.now() - (this.startTime || Date.now());
            this.track('sse_error', { error, duration });
        }
        /** 流被中断 */
        abort(reason) {
            if (this.state !== 'started')
                return;
            this.state = 'ended';
            this.stopStallDetection();
            const duration = Date.now() - (this.startTime || Date.now());
            this.track('sse_abort', { abortReason: reason, duration });
        }
        // ===== 阶段追踪 =====
        /** 阶段开始 */
        phaseStart(name) {
            if (this.state !== 'started')
                return;
            this.phases.set(name, Date.now());
            this.track('phase_start', { phase: name });
        }
        /** 阶段结束 */
        phaseEnd(name) {
            if (this.state !== 'started')
                return;
            const startTime = this.phases.get(name);
            if (startTime === undefined)
                return;
            const duration = Date.now() - startTime;
            this.phases.delete(name);
            this.track('phase_end', { phase: name, phaseDuration: duration });
        }
        // ===== 工具调用追踪 =====
        /** 工具调用开始 — 返回 toolCallId */
        toolStart(name, args, toolCallId) {
            if (this.state !== 'started')
                return '';
            const id = toolCallId || this.generateId();
            this.tools.set(id, { name, startTime: Date.now() });
            this.track('tool_start', { toolCallId: id, toolName: name, toolArgs: args });
            return id;
        }
        /** 工具调用结束 — 通过 toolCallId 或 name 匹配 */
        toolEnd(identifier, result) {
            if (this.state !== 'started')
                return;
            // 先按 toolCallId 查找，再按 name 查找
            let record = null;
            let resolvedId = '';
            const byId = this.tools.get(identifier);
            if (byId) {
                record = byId;
                resolvedId = identifier;
            }
            else {
                // 按 name 模糊匹配
                for (const [id, r] of this.tools) {
                    if (r.name === identifier) {
                        record = r;
                        resolvedId = id;
                        break;
                    }
                }
            }
            if (!record)
                return;
            const duration = Date.now() - record.startTime;
            this.tools.delete(resolvedId);
            this.track('tool_end', {
                toolCallId: resolvedId,
                toolName: record.name,
                toolSuccess: result.success,
                toolDuration: duration,
                resultCount: result.resultCount,
                error: result.error,
                imageUrl: result.imageUrl,
                imageWidth: result.width,
                imageHeight: result.height,
                sources: result.sources,
            });
        }
        // ===== 图片加载追踪 =====
        imageLoadStart(imageUrl) {
            if (this.state !== 'started')
                return;
            this.imageLoads.set(imageUrl, Date.now());
            this.track('image_load_start', { imageUrl });
        }
        imageLoadEnd(imageUrl, result) {
            if (this.state !== 'started')
                return;
            const startTime = this.imageLoads.get(imageUrl);
            if (startTime === undefined)
                return;
            const duration = Date.now() - startTime;
            this.imageLoads.delete(imageUrl);
            if (result.success) {
                this.track('image_load_complete', { imageUrl, duration, imageSize: result.size });
            }
            else {
                this.track('image_load_error', { imageUrl, duration, error: result.error });
            }
        }
        // ===== 私有方法 =====
        track(type, extra = {}) {
            this.monitor.report({
                type: 'sse',
                timestamp: Date.now(),
                data: {
                    traceId: this.traceId,
                    aiMessageId: this.aiMessageId,
                    sseType: type,
                    ...extra,
                },
            });
        }
        startStallDetection() {
            this.stopStallDetection();
            this.stallTimer = setTimeout(() => this.onStall(), this.stallThreshold);
        }
        stopStallDetection() {
            if (this.stallTimer) {
                clearTimeout(this.stallTimer);
                this.stallTimer = null;
            }
        }
        onStall() {
            if (this.state !== 'started')
                return;
            this.isStalled = true;
            this.track('sse_stall', {
                stallDuration: this.stallThreshold,
                lastChunkTime: this.lastChunkTime || undefined,
            });
            this.startStallDetection(); // 继续检测
        }
        generateId() {
            return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
        }
    }
    // ===== TracePlugin =====
    class TracePlugin extends ListenerPlugin {
        name = 'trace-plugin';
        version = '0.1.0';
        currentTrace = null;
        onSetup(monitor) {
            // 将 Trace 能力注入 Monitor
            const self = this;
            const m = monitor;
            m.createTrace = function (options) {
                const trace = new Trace(monitor, options);
                self.currentTrace = trace;
                return trace;
            };
            m.setCurrentTrace = function (trace) {
                self.currentTrace = trace;
            };
            m.getCurrentTrace = function () {
                return self.currentTrace;
            };
        }
        onDestroy() {
            this.currentTrace = null;
        }
    }

    /**
     * 堆栈解析工具
     *
     * 将压缩后的堆栈字符串解析为结构化数据。
     * 支持 source-map 反解（可选集成）。
     */
    /**
     * 解析错误堆栈字符串
     */
    function parseStackTrace(stack) {
        const lines = stack.split('\n');
        const frames = [];
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
    function parseStackLine(line) {
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
    function formatStackTrace(frames) {
        return frames
            .map((frame) => {
            const fn = frame.functionName || '<anonymous>';
            const file = frame.fileName ? ` (${frame.fileName}:${frame.lineNumber})` : '';
            return `  at ${fn}${file}`;
        })
            .join('\n');
    }

    /**
     * 白屏检测
     *
     * 通过采样页面关键点判断是否出现白屏。
     * 策略：在页面取 N 个采样点，检查是否有可见内容。
     */
    const DEFAULT_CONFIG = {
        samplePoints: 9,
        threshold: 3,
        interval: 3000,
    };
    class WhiteScreenDetector {
        config;
        whiteCount = 0;
        timer = null;
        onWhiteScreen = null;
        constructor(config) {
            this.config = { ...DEFAULT_CONFIG, ...config };
        }
        /** 开始检测 */
        start(callback) {
            this.onWhiteScreen = callback;
            this.timer = setInterval(() => this.check(), this.config.interval);
        }
        /** 停止检测 */
        stop() {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            this.whiteCount = 0;
        }
        /** 执行一次白屏检测 */
        check() {
            if (this.isWhiteScreen()) {
                this.whiteCount++;
                if (this.whiteCount >= this.config.threshold) {
                    this.whiteCount = 0;
                    this.onWhiteScreen?.();
                }
            }
            else {
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
        isWhiteScreen() {
            const { innerWidth, innerHeight } = window;
            if (innerWidth === 0 || innerHeight === 0)
                return false;
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
        getSamplePoints(width, height) {
            const points = [];
            const cols = Math.ceil(Math.sqrt(this.config.samplePoints));
            const rows = Math.ceil(this.config.samplePoints / cols);
            for (let i = 0; i < rows; i++) {
                for (let j = 0; j < cols; j++) {
                    if (points.length >= this.config.samplePoints)
                        break;
                    points.push([
                        Math.floor((width * (j + 0.5)) / cols),
                        Math.floor((height * (i + 0.5)) / rows),
                    ]);
                }
            }
            return points;
        }
    }

    exports.BasePlugin = BasePlugin;
    exports.BehaviorPlugin = BehaviorPlugin;
    exports.CollectorPlugin = CollectorPlugin;
    exports.CustomPlugin = CustomPlugin;
    exports.ErrorPlugin = ErrorPlugin;
    exports.ListenerPlugin = ListenerPlugin;
    exports.Monitor = Monitor;
    exports.PerformancePlugin = PerformancePlugin;
    exports.Pipeline = Pipeline;
    exports.Trace = Trace;
    exports.TracePlugin = TracePlugin;
    exports.Transport = Transport;
    exports.WhiteScreenDetector = WhiteScreenDetector;
    exports.formatStackTrace = formatStackTrace;
    exports.generateErrorId = generateErrorId;
    exports.parseStackTrace = parseStackTrace;

    return exports;

})({});
//# sourceMappingURL=index.iife.js.map
