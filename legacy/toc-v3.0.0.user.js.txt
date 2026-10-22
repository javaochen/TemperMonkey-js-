// ==UserScript==
// @name         网页悬浮目录（按钮触发·容器感知·移动端）
// @namespace    https://github.com/
// @version      3.0.0
// @description  右下角悬浮按钮，点击展开/收起层级目录面板，完全脱离文档流
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
    const TOC_ROOT_ID = `${TOC_NS}-root`;
    const TOC_BUTTON_ID = `${TOC_NS}-btn`;
    const TOC_PANEL_ID  = `${TOC_NS}-panel`;

    const state = {
        root: null,
        button: null,
        panel: null,
        container: null,
        headings: [],
        built: false,
        visible: false,
    };

    /* ============================================================
     * 1. 容器探测
     * ============================================================ */
    const CONTAINER_SELECTORS = [
        'main', 'article', '[role="main"]',
        '.post', '.post-content', '.post-body',
        '.article', '.article-content', '.article-body',
        '.content', '.content-body',
        '.entry', '.entry-content',
        '.markdown-body', '.md-body',
    ];

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
        }
        if (el.offsetParent !== null) return true;
        if (el.getClientRects().length > 0) return true;
        if (el.textContent && el.textContent.trim().length > 0) {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden';
        }
        return false;
    }

    function findContainer() {
        for (const sel of CONTAINER_SELECTORS) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                if (isVisible(el)) return el;
            }
        }
        return document.body;
    }

    /* ============================================================
     * 2. Heading 采集
     * ============================================================ */
    const HEADING_SELECTOR = 'h1, h2, h3, h4';

    function isValidHeading(h) {
        const text = h.textContent.trim();
        if (!text || text.length > 120 || !isVisible(h)) return false;
        if (h.closest(`#${TOC_ROOT_ID}`)) return false;
        return true;
    }

    function collectHeadings() {
        const all = Array.from(document.querySelectorAll(HEADING_SELECTOR));
        const filtered = all.filter(isValidHeading);

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
     * 3. 层级校正 → 嵌套树
     * ============================================================ */
    function buildTree(headings) {
        const rootUl = document.createElement('ul');
        rootUl.className = `${TOC_NS}-list`;
        rootUl.setAttribute('data-level', '0');

        const stack = [{ ul: rootUl, level: 0 }];

        headings.forEach((h) => {
            let level = parseInt(h.tagName[1], 10);
            const top = stack[stack.length - 1];
            if (level > top.level + 1) level = top.level + 1;

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
                if (window.innerWidth < 768) togglePanel(false);
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
     * 4. Panel 构建（不在文档流中，挂在 root 下）
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
     * 5. Panel 显隐
     * ============================================================ */
    function togglePanel(force) {
        const willShow = typeof force === 'boolean' ? force : !state.visible;

        if (willShow) {
            if (state.panel && !state.panel.parentNode) {
                state.root.appendChild(state.panel);
            }
            // 双 RAF 确保 DOM 插入后再加动画类
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    state.panel?.classList.add(`${TOC_NS}-panel--open`);
                });
            });
            state.panel?.setAttribute('aria-hidden', 'false');
            state.button?.setAttribute('aria-expanded', 'true');
        } else {
            state.panel?.classList.remove(`${TOC_NS}-panel--open`);
            state.panel?.setAttribute('aria-hidden', 'true');
            state.button?.setAttribute('aria-expanded', 'false');
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
        btn.title = '目录';

        // 用 SVG 图标，不依赖 emoji 字体
        btn.innerHTML = `
            <svg class="${TOC_NS}-btn-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
        `;

        btn.addEventListener('click', () => {
            if (!state.built) {
                const headings = collectHeadings();
                if (headings.length < 2) {
                    btn.classList.add(`${TOC_NS}-btn--disabled`);
                    btn.title = '当前页面无可用目录';
                    return;
                }
                buildPanel();
            }
            togglePanel();
        });

        state.button = btn;
        return btn;
    }

    /* ============================================================
     * 7. 样式注入 —— 全部 fixed 定位，彻底脱离文档流
     * ============================================================ */
    const STYLE_ID = `${TOC_NS}-style`;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const css = `
/* ---- Reset 隔离：所有样式 scoped 到 #gm-toc-root ---- */
#${TOC_ROOT_ID} {
    all: initial;
    position: fixed;
    z-index: 2147483640;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

/* ---- 按钮：右下角悬浮圆形 ---- */
#${TOC_ROOT_ID} .${TOC_NS}-btn {
    all: initial;
    position: fixed !important;
    right: 20px !important;
    bottom: 20px !important;
    z-index: 2147483641 !important;
    width: 48px !important;
    height: 48px !important;
    border-radius: 50% !important;
    border: none !important;
    background: #4f46e5 !important;
    color: #ffffff !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer !important;
    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4), 0 2px 4px rgba(0,0,0,0.15) !important;
    transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease !important;
    padding: 0 !important;
    margin: 0 !important;
    font-size: 0 !important;
    line-height: 1 !important;
    -webkit-tap-highlight-color: transparent !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-btn:hover {
    background: #4338ca !important;
    transform: scale(1.08) !important;
    box-shadow: 0 6px 20px rgba(79, 70, 229, 0.5), 0 2px 6px rgba(0,0,0,0.2) !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-btn:active {
    transform: scale(0.95) !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-btn--disabled {
    background: #9ca3af !important;
    cursor: not-allowed !important;
    box-shadow: none !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-btn-icon {
    width: 22px !important;
    height: 22px !important;
    flex-shrink: 0 !important;
}

/* ---- 面板：按钮上方弹出 ---- */
#${TOC_ROOT_ID} .${TOC_NS}-panel {
    all: initial;
    position: fixed !important;
    right: 20px !important;
    bottom: 80px !important;
    z-index: 2147483641 !important;
    width: 320px !important;
    max-height: 60vh !important;
    overflow-y: auto !important;
    background: #ffffff !important;
    color: #1d2939 !important;
    font-size: 14px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
    line-height: 1.7 !important;
    padding: 16px 18px !important;
    margin: 0 !important;
    border: 1px solid #e4e7ec !important;
    border-radius: 12px !important;
    box-shadow: 0 10px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08) !important;
    -webkit-overflow-scrolling: touch !important;
    opacity: 0 !important;
    transform: translateY(12px) scale(0.96) !important;
    pointer-events: none !important;
    transition: opacity 0.22s ease, transform 0.22s ease !important;
    display: block !important;
    visibility: visible !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-panel--open {
    opacity: 1 !important;
    transform: translateY(0) scale(1) !important;
    pointer-events: auto !important;
}

/* ---- 目录列表 ---- */
#${TOC_ROOT_ID} .${TOC_NS}-list {
    list-style: none !important;
    padding: 0 !important;
    margin: 0 !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-list .${TOC_NS}-list {
    padding-left: 14px !important;
    margin-top: 2px !important;
    border-left: 2px solid #e4e7ec !important;
    margin-left: 4px !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-item {
    margin: 0 !important;
    padding: 0 !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-link {
    display: block !important;
    padding: 4px 8px !important;
    color: #475467 !important;
    text-decoration: none !important;
    border-radius: 4px !important;
    transition: background 0.15s, color 0.15s !important;
    word-break: break-word !important;
    font-size: 13px !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-link:hover,
#${TOC_ROOT_ID} .${TOC_NS}-link:focus {
    background: #eef2ff !important;
    color: #3538cd !important;
    outline: none !important;
}

/* 层级视觉 */
#${TOC_ROOT_ID} .${TOC_NS}-item[data-level="1"] > .${TOC_NS}-link {
    font-weight: 600 !important;
    color: #1d2939 !important;
    font-size: 14px !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-item[data-level="2"] > .${TOC_NS}-link {
    font-weight: 500 !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-item[data-level="3"] > .${TOC_NS}-link,
#${TOC_ROOT_ID} .${TOC_NS}-item[data-level="4"] > .${TOC_NS}-link {
    font-size: 12.5px !important;
    color: #667085 !important;
}

/* ---- 暗色模式 ---- */
@media (prefers-color-scheme: dark) {
    #${TOC_ROOT_ID} .${TOC_NS}-btn {
        background: #6366f1 !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-btn:hover {
        background: #818cf8 !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-panel {
        background: #1e293b !important;
        color: #e2e8f0 !important;
        border-color: #334155 !important;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3) !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-list .${TOC_NS}-list {
        border-left-color: #334155 !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-link {
        color: #94a3b8 !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-link:hover,
    #${TOC_NS}-link:focus {
        background: #312e81 !important;
        color: #c7d2fe !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-item[data-level="1"] > .${TOC_NS}-link {
        color: #f1f5f9 !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-item[data-level="3"] > .${TOC_NS}-link,
    #${TOC_ROOT_ID} .${TOC_NS}-item[data-level="4"] > .${TOC_NS}-link {
        color: #64748b !important;
    }
}

/* ---- 移动端 ---- */
@media (max-width: 767px) {
    #${TOC_ROOT_ID} .${TOC_NS}-btn {
        right: 14px !important;
        bottom: 14px !important;
        width: 44px !important;
        height: 44px !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-btn-icon {
        width: 20px !important;
        height: 20px !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-panel {
        right: 8px !important;
        left: 8px !important;
        bottom: 68px !important;
        width: auto !important;
        max-height: 55vh !important;
        font-size: 15px !important;
        padding: 14px 16px !important;
    }
}

/* ---- 滚动锚点偏移 ---- */
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
     * 8. 初始化
     * ============================================================ */
    function init() {
        if (document.getElementById(TOC_ROOT_ID)) return;

        injectStyles();

        // 创建根容器 —— 唯一挂到 body 的节点
        const root = document.createElement('div');
        root.id = TOC_ROOT_ID;
        root.setAttribute('aria-hidden', 'true');

        const btn = buildButton();
        root.appendChild(btn);

        document.body.appendChild(root);
        state.root = root;

        // 采集容器信息（仅用于判断页面是否有正文）
        state.container = findContainer();

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
                buildPanel();
                if (state.visible) {
                    state.root.appendChild(state.panel);
                    requestAnimationFrame(() => {
                        state.panel?.classList.add(`${TOC_NS}-panel--open`);
                    });
                }
            },
        };
    }

    /* ============================================================
     * 9. 启动 + SPA 监听
     * ============================================================ */
    let retry = 0;
    const MAX_RETRY = 20;
    const RETRY_INTERVAL = 300;

    function tryInit() {
        const hasContent = document.body && document.body.children.length > 0;
        if (!hasContent && retry < MAX_RETRY) {
            retry++;
            setTimeout(tryInit, RETRY_INTERVAL);
            return;
        }
        init();
        if (!state.root && retry < MAX_RETRY * 2) {
            retry++;
            setTimeout(tryInit, RETRY_INTERVAL);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryInit, 100));
    } else {
        setTimeout(tryInit, 100);
    }

    // SPA 路由变化 → 重置
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            state.built = false;
            state.visible = false;
            state.headings = [];
            state.panel?.remove();
            state.panel = null;
            state.container = null;
            retry = 0;
            tryInit();
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 点击页面其他区域关闭面板
    document.addEventListener('click', (e) => {
        if (!state.visible || !state.root) return;
        if (e.target.closest(`#${TOC_ROOT_ID}`)) return;
        togglePanel(false);
    }, true);

})();
