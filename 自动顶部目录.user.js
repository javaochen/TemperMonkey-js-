// ==UserScript==
// @name         网页顶部层级目录（按钮触发·容器感知·移动端）
// @namespace    https://github.com/
// @version      2.0.0
// @description  在已有语义容器后插入目录按钮，点击后生成/切换层级目录
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    /* ============================================================
     * 0. 常量与全局状态
     * ============================================================ */
    const TOC_NS = 'gm-toc';
    const TOC_BUTTON_ID = `${TOC_NS}-btn`;
    const TOC_PANEL_ID  = `${TOC_NS}-panel`;

    /** @type {{
     *   button: HTMLButtonElement | null,
     *   panel: HTMLElement | null,
     *   container: HTMLElement | null,
     *   headings: HTMLElement[],
     *   built: boolean,
     *   visible: boolean,
     *   scrollLock: boolean
     * }}
     */
    const state = {
        button: null,
        panel: null,
        container: null,
        headings: [],
        built: false,
        visible: false,
        scrollLock: false,
    };

    /* ============================================================
     * 1. 容器探测 —— 优先级链 + 可见性校验
     * ============================================================ */
    const CONTAINER_SELECTORS = [
        'main',
        'article',
        '[role="main"]',
        '.post', '.post-content', '.post-body',
        '.article', '.article-content', '.article-body',
        '.content', '.content-body',
        '.entry', '.entry-content',
        '.markdown-body', '.md-body',
    ];

    /**
     * 判断元素是否可见且有实际尺寸
     * 多层兜底：rect → computedStyle → offsetParent → clientRects
     * @param {HTMLElement} el
     * @returns {boolean}
     */
    function isVisible(el) {
        if (!el) return false;

        // 最严格的检查：有实际渲染尺寸
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const style = window.getComputedStyle(el);
            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0'
            );
        }

        // 兜底1：offsetParent 不为 null（说明在渲染树中且非 fixed 隐藏）
        if (el.offsetParent !== null) return true;

        // 兜底2：getClientRects 有结果（处理 inline 元素）
        const rects = el.getClientRects();
        if (rects.length > 0) return true;

        // 兜底3：SSR / 无头环境 —— 只要有文本内容就信任
        if (el.textContent && el.textContent.trim().length > 0) {
            const style = window.getComputedStyle(el);
            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden'
            );
        }

        return false;
    }

    /**
     * 找到最合适的挂载容器
     * 策略：按选择器优先级遍历 → 退化到第一个可见 heading 的祖先链 → body
     * @returns {HTMLElement | null}
     */
    function findContainer() {
        // 主策略：按优先级链找第一个可见的语义容器
        for (const sel of CONTAINER_SELECTORS) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                if (isVisible(el)) return el;
            }
        }

        // 退化策略1：找第一个可见 heading 的祖先链中最近的语义标签
        const SEMANTIC_TAGS = ['MAIN', 'ARTICLE', 'SECTION', 'DIV'];
        const allHeadings = document.querySelectorAll(HEADING_SELECTOR);
        for (const h of allHeadings) {
            if (!isVisible(h)) continue;
            let parent = h.parentElement;
            while (parent && parent !== document.body) {
                if (SEMANTIC_TAGS.includes(parent.tagName)) {
                    // 验证该容器内有多个 heading（说明是正文区）
                    const containerHeadings = parent.querySelectorAll(HEADING_SELECTOR);
                    const visibleCount = Array.from(containerHeadings).filter(isVisible).length;
                    if (visibleCount >= 2) return parent;
                }
                parent = parent.parentElement;
            }
            // 至少返回 h 的直接父元素
            if (h.parentElement) return h.parentElement;
            break;
        }

        // 最终退化：body
        return document.body;
    }

    /* ============================================================
     * 2. Heading 采集 —— 去重 / 过滤 / 可见性
     * ============================================================ */
    const HEADING_SELECTOR = 'h1, h2, h3, h4';

    /**
     * 判断 heading 是否值得收录
     * @param {HTMLElement} h
     * @returns {boolean}
     */
    function isValidHeading(h) {
        const text = h.textContent.trim();
        if (!text) return false;
        if (text.length > 120) return false; // 排除异常长文本（如隐藏模板）
        if (!isVisible(h)) return false;

        // 排除自身 TOC 内部的 heading
        if (h.closest(`#${TOC_PANEL_ID}`)) return false;

        return true;
    }

    /**
     * 扫描并缓存 heading 列表
     * @returns {HTMLElement[]}
     */
    function collectHeadings() {
        const all = Array.from(document.querySelectorAll(HEADING_SELECTOR));
        const filtered = all.filter(isValidHeading);

        // 确保唯一 id
        filtered.forEach((h, i) => {
            if (!h.id || document.querySelectorAll(`[id="${h.id}"]`).length > 1) {
                let base = (h.textContent.trim().slice(0, 20) || 'heading')
                    .toLowerCase()
                    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
                    .replace(/^-|-$/g, '');
                if (!base) base = 'heading';
                let candidate = `${base}-${i}`;
                let n = 0;
                while (document.getElementById(candidate)) {
                    n++;
                    candidate = `${base}-${i}-${n}`;
                }
                h.id = candidate;
            }
        });

        state.headings = filtered;
        return filtered;
    }

    /* ============================================================
     * 3. 层级校正 —— 处理跳级 / 非规范结构
     * ============================================================ */

    /**
     * 将 heading 列表转为嵌套 ul 树
     * 规则：level 只增 1 或重置，不允许跳级
     * @param {HTMLElement[]} headings
     * @returns {HTMLUListElement}
     */
    function buildTree(headings) {
        const rootUl = document.createElement('ul');
        rootUl.className = `${TOC_NS}-list`;
        rootUl.setAttribute('data-level', '0');

        // stack 存放 { ul, level }
        const stack = [{ ul: rootUl, level: 0 }];

        headings.forEach((h) => {
            let level = parseInt(h.tagName[1], 10); // 1-4

            // 层级校正：不允许跳级
            const top = stack[stack.length - 1];
            if (level > top.level + 1) {
                level = top.level + 1;
            }

            // 弹出比当前 level 深的所有层
            while (stack.length > 1 && stack[stack.length - 1].level >= level) {
                stack.pop();
            }

            const parent = stack[stack.length - 1].ul;

            const li = document.createElement('li');
            li.className = `${TOC_NS}-item`;
            li.setAttribute('data-level', String(level));

            const a = document.createElement('a');
            a.href = `#${h.id}`;
            a.textContent = h.textContent.trim();
            a.className = `${TOC_NS}-link`;
            a.setAttribute('data-target', h.id);

            a.addEventListener('click', (e) => {
                e.preventDefault();
                const target = document.getElementById(h.id);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                // 移动端点击后自动收起
                if (window.innerWidth < 768) {
                    togglePanel(false);
                }
            });

            li.appendChild(a);

            const childUl = document.createElement('ul');
            childUl.className = `${TOC_NS}-list`;
            childUl.setAttribute('data-level', String(level));
            li.appendChild(childUl);

            parent.appendChild(li);

            stack.push({ ul: childUl, level });
        });

        return rootUl;
    }

    /* ============================================================
     * 4. Panel 构建
     * ============================================================ */
    function buildPanel() {
        const panel = document.createElement('nav');
        panel.id = TOC_PANEL_ID;
        panel.setAttribute('aria-label', '文章目录');
        panel.className = `${TOC_NS}-panel`;

        const tree = buildTree(state.headings);
        panel.appendChild(tree);

        state.panel = panel;
        state.built = true;
        return panel;
    }

    /* ============================================================
     * 5. Panel 显隐控制
     * ============================================================ */
    function togglePanel(force) {
        if (!state.panel) return;

        const willShow = typeof force === 'boolean' ? force : !state.visible;

        if (willShow) {
            state.panel.classList.add(`${TOC_NS}-panel--open`);
            state.panel.setAttribute('aria-hidden', 'false');
            state.button?.setAttribute('aria-expanded', 'true');
            // 可选：锁定 body 滚动
            // document.body.style.overflow = 'hidden';
        } else {
            state.panel.classList.remove(`${TOC_NS}-panel--open`);
            state.panel.setAttribute('aria-hidden', 'true');
            state.button?.setAttribute('aria-expanded', 'false');
            // document.body.style.overflow = '';
        }

        state.visible = willShow;
    }

    /* ============================================================
     * 6. 按钮构建
     * ============================================================ */
    function buildButton() {
        const btn = document.createElement('button');
        btn.id = TOC_BUTTON_ID;
        btn.type = 'button';
        btn.className = `${TOC_NS}-btn`;
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', TOC_PANEL_ID);

        const icon = document.createElement('span');
        icon.className = `${TOC_NS}-icon`;
        icon.textContent = '📑';

        const label = document.createElement('span');
        label.className = `${TOC_NS}-label`;
        label.textContent = '目录';

        btn.appendChild(icon);
        btn.appendChild(label);

        btn.addEventListener('click', () => {
            if (!state.built) {
                // 首次点击：采集 + 构建 + 插入
                const headings = collectHeadings();
                if (headings.length < 2) {
                    label.textContent = '无目录';
                    btn.disabled = true;
                    return;
                }
                const panel = buildPanel();
                // 插入到按钮之后（相邻兄弟）
                btn.parentNode?.insertBefore(panel, btn.nextSibling);
            }
            togglePanel();
            label.textContent = state.visible ? '收起' : '目录';
        });

        state.button = btn;
        return btn;
    }

    /* ============================================================
     * 7. 样式注入 —— 隔离 + 响应式 + 暗色模式
     * ============================================================ */
    const STYLE_ID = `${TOC_NS}-style`;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const css = `
.${TOC_NS}-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    margin: 12px 0;
    border: 1px solid #d0d5dd;
    border-radius: 999px;
    background: #ffffff;
    color: #344054;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.4;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.2s, box-shadow 0.2s;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.${TOC_NS}-btn:hover {
    background: #f9fafb;
}
.${TOC_NS}-btn:active {
    background: #f2f4f7;
}
.${TOC_NS}-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.${TOC_NS}-icon {
    font-size: 16px;
    line-height: 1;
}
.${TOC_NS}-label {
    white-space: nowrap;
}

.${TOC_NS}-panel {
    display: none;
    background: #f9fafb;
    color: #1d2939;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.7;
    padding: 14px 16px;
    margin: 8px 0 16px;
    border: 1px solid #e4e7ec;
    border-radius: 8px;
    max-height: 70vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    scroll-margin-top: 16px;
}
.${TOC_NS}-panel--open {
    display: block;
}

.${TOC_NS}-panel .${TOC_NS}-list {
    list-style: none;
    padding-left: 0;
    margin: 0;
}
.${TOC_NS}-panel .${TOC_NS}-list .${TOC_NS}-list {
    padding-left: 16px;
    margin-top: 2px;
    border-left: 2px solid #e4e7ec;
    margin-left: 4px;
}

.${TOC_NS}-panel .${TOC_NS}-item {
    margin: 0;
    padding: 0;
}

.${TOC_NS}-panel .${TOC_NS}-link {
    display: block;
    padding: 4px 8px;
    color: #475467;
    text-decoration: none;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
    word-break: break-word;
}
.${TOC_NS}-panel .${TOC_NS}-link:hover,
.${TOC_NS}-panel .${TOC_NS}-link:focus {
    background: #eef2ff;
    color: #3538cd;
    outline: none;
}
.${TOC_NS}-panel .${TOC_NS}-link:active {
    background: #e0e7ff;
}

/* 层级缩进视觉增强 */
.${TOC_NS}-panel .${TOC_NS}-item[data-level="1"] > .${TOC_NS}-link {
    font-weight: 600;
    color: #1d2939;
}
.${TOC_NS}-panel .${TOC_NS}-item[data-level="2"] > .${TOC_NS}-link {
    font-weight: 500;
}
.${TOC_NS}-panel .${TOC_NS}-item[data-level="3"] > .${TOC_NS}-link,
.${TOC_NS}-panel .${TOC_NS}-item[data-level="4"] > .${TOC_NS}-link {
    font-size: 13px;
    color: #667085;
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
    .${TOC_NS}-btn {
        background: #1d2939;
        color: #e4e7ec;
        border-color: #344054;
        box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    .${TOC_NS}-btn:hover { background: #2a3a50; }
    .${TOC_NS}-btn:active { background: #334155; }

    .${TOC_NS}-panel {
        background: #111827;
        color: #e4e7ec;
        border-color: #344054;
    }
    .${TOC_NS}-panel .${TOC_NS}-list .${TOC_NS}-list {
        border-left-color: #344054;
    }
    .${TOC_NS}-panel .${TOC_NS}-link {
        color: #98a2b3;
    }
    .${TOC_NS}-panel .${TOC_NS}-link:hover,
    .${TOC_NS}-panel .${TOC_NS}-link:focus {
        background: #312e81;
        color: #c7d2fe;
    }
    .${TOC_NS}-panel .${TOC_NS}-item[data-level="1"] > .${TOC_NS}-link {
        color: #f3f4f6;
    }
    .${TOC_NS}-panel .${TOC_NS}-item[data-level="3"] > .${TOC_NS}-link,
    .${TOC_NS}-panel .${TOC_NS}-item[data-level="4"] > .${TOC_NS}-link {
        color: #667085;
    }
}

/* 移动端微调 */
@media (max-width: 767px) {
    .${TOC_NS}-btn {
        padding: 10px 18px;
        font-size: 15px;
    }
    .${TOC_NS}-panel {
        font-size: 15px;
        padding: 12px 14px;
        max-height: 60vh;
    }
    .${TOC_NS}-panel .${TOC_NS}-list .${TOC_NS}-list {
        padding-left: 12px;
    }
}

/* 目标锚点偏移 —— 防止被浏览器地址栏/固定栏遮挡 */
.${TOC_NS}-panel .${TOC_NS}-link[href] {
    scroll-margin-top: 16px;
}
h1[id], h2[id], h3[id], h4[id] {
    scroll-margin-top: 20px;
}
        `.trim();

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.setAttribute('data-namespace', TOC_NS);
        style.textContent = css;
        document.head.appendChild(style);
    }

    /* ============================================================
     * 8. 初始化 & 异步重试
     * ============================================================ */
    function init() {
        // 防止重复注入
        if (document.getElementById(TOC_BUTTON_ID)) return;

        injectStyles();

        const container = findContainer();
        if (!container) return;

        state.container = container;

        const btn = buildButton();

        // 插入策略：作为容器的第一个子元素之前
        // 按钮排在容器前面（自然文档流，不悬浮、不遮挡）
        container.insertBefore(btn, container.firstChild);

        // 暴露调试接口
        window.__TOC__ = {
            state,
            collectHeadings,
            togglePanel,
            rebuild() {
                state.built = false;
                state.panel?.remove();
                state.panel = null;
                collectHeadings();
                const panel = buildPanel();
                state.button?.parentNode?.insertBefore(panel, state.button.nextSibling);
            },
        };
    }

    // ---------- 启动策略 ----------
    let retry = 0;
    const MAX_RETRY = 20;
    const RETRY_INTERVAL = 300;

    function tryInit() {
        // 至少需要有一些正文内容
        const hasContent = document.body && document.body.children.length > 0;

        if (!hasContent && retry < MAX_RETRY) {
            retry++;
            setTimeout(tryInit, RETRY_INTERVAL);
            return;
        }

        init();

        // 如果初次没找到容器（SPA 异步渲染），继续观察
        if (!state.container && retry < MAX_RETRY * 2) {
            retry++;
            setTimeout(tryInit, RETRY_INTERVAL);
        }
    }

    // 延迟启动，避免阻塞首屏
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryInit, 100));
    } else {
        setTimeout(tryInit, 100);
    }

    // ---------- SPA 路由变化监听 ----------
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            // 重置状态
            state.built = false;
            state.visible = false;
            state.headings = [];
            state.panel?.remove();
            state.panel = null;
            state.button?.remove();
            state.button = null;
            state.container = null;
            retry = 0;
            tryInit();
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

})();
