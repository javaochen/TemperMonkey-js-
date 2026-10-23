// ==UserScript==
// @name         网页悬浮目录（按钮可移动·容器感知·移动端）
// @namespace    https://github.com/
// @version      4.3.0
// @description  右下角悬浮按钮，点击展开层级目录面板；按钮可拖拽或点选放置到屏幕任意位置，位置自动记忆、可一键复位
// @homepageURL  https://github.com/javaochen/js.Tampermonkey
// @supportURL   https://github.com/javaochen/js.Tampermonkey/issues
// @downloadURL  https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/toc.user.js
// @updateURL    https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/toc.user.js
// @match        *://*/*
// @grant        none
// @run-at       document-end
// @noframes
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

    const STORAGE_KEY = `${TOC_NS}:btn-pos`;   // 按钮位置持久化
    const EDGE_MARGIN = 8;                     // 贴边安全距离
    const DRAG_THRESHOLD = 5;                  // 超过该像素才算拖动（否则视为点击）
    const GAP = 12;                            // 面板与按钮间距
    const HAS_POINTER = 'PointerEvent' in window;

    /** 创建元素（避免 innerHTML，兼容 Trusted Types） */
    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    const state = {
        root: null,
        button: null,
        panel: null,
        container: null,
        headings: [],
        built: false,
        visible: false,
        pos: null,        // {left, top} 视口坐标
        dragging: false,
        placer: null,     // 点选放置模式遮罩
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

    function safeIdOf(h) {
        const raw = (h.textContent.trim().slice(0, 20) || 'heading')
            .toLowerCase()
            .replace(/[^a-z0-9一-龥]+/g, '-')
            .replace(/^-|-$/g, '');
        return raw || 'heading';
    }

    function collectHeadings() {
        const all = Array.from(document.querySelectorAll(HEADING_SELECTOR));
        const filtered = all.filter(isValidHeading);

        filtered.forEach((h, i) => {
            // getElementById 返回第一个匹配项：不是自己就说明 id 重复
            if (!h.id || document.getElementById(h.id) !== h) {
                const base = safeIdOf(h);
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
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
     * 4. 按钮位置：计算 / 约束 / 吸附 / 持久化
     * ============================================================ */
    function btnSize() {
        return window.innerWidth < 768 ? 44 : 48;
    }
    function baseMargin() {
        return window.innerWidth < 768 ? 14 : 20;
    }

    function loadPos() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            if (p && typeof p.left === 'number' && typeof p.top === 'number') return p;
        } catch (e) { /* localStorage 不可用时静默降级 */ }
        return null;
    }

    function savePos(p) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) { /* noop */ }
    }

    /** 限制在视口内 */
    function clampPos(p) {
        const size = btnSize();
        const m = EDGE_MARGIN;
        const maxL = Math.max(m, window.innerWidth - size - m);
        const maxT = Math.max(m, window.innerHeight - size - m);
        return {
            left: Math.min(Math.max(p.left, m), maxL),
            top: Math.min(Math.max(p.top, m), maxT),
        };
    }

    /** 默认位置：右下角 */
    function defaultPos() {
        const size = btnSize();
        const m = baseMargin();
        return {
            left: window.innerWidth - size - m,
            top: window.innerHeight - size - m,
        };
    }

    /** 松手后吸附到最近的水平边缘 */
    function snapPos(p) {
        const size = btnSize();
        const centerX = p.left + size / 2;
        const toRight = centerX > window.innerWidth / 2;
        return clampPos({
            left: toRight ? window.innerWidth - size - EDGE_MARGIN : EDGE_MARGIN,
            top: p.top,
        });
    }

    /** 写入 DOM（不落盘），面板可见时同步跟随 */
    function applyPos(p) {
        state.pos = p;
        if (state.button) {
            state.button.style.left = `${p.left}px`;
            state.button.style.top = `${p.top}px`;
        }
        if (state.visible) positionPanel();
    }

    /** 写入 DOM + 落盘 */
    function setPos(p, opts) {
        const useSnap = !!(opts && opts.snap);
        const next = useSnap ? snapPos(p) : clampPos(p);
        applyPos(next);
        savePos(next);
        return next;
    }

    function resetPos() {
        setPos(defaultPos(), { snap: false });
    }

    /* ============================================================
     * 5. 面板跟随按钮定位（上下/左右自动避让）
     * ============================================================ */
    function panelWidth() {
        const narrow = window.innerWidth < 768;
        return narrow ? window.innerWidth - 16 : Math.min(320, window.innerWidth - 16);
    }

    function positionPanel() {
        const panel = state.panel;
        const p = state.pos;
        if (!panel || !p || !panel.parentNode) return;

        const size = btnSize();
        const m = EDGE_MARGIN;
        const narrow = window.innerWidth < 768;
        const width = panelWidth();

        panel.style.width = `${width}px`;

        const upSpace = p.top - GAP - m;
        const downSpace = window.innerHeight - (p.top + size) - GAP - m;
        const placeAbove = upSpace >= 200 || upSpace >= downSpace;

        const limit = Math.max(placeAbove ? upSpace : downSpace, 160);
        panel.style.maxHeight = `${Math.min(window.innerHeight * 0.6, limit)}px`;

        const ph = panel.offsetHeight || Math.min(window.innerHeight * 0.6, limit);

        // 垂直：优先放按钮上方，空间不足翻到下方
        let top = placeAbove ? p.top - GAP - ph : p.top + size + GAP;
        if (placeAbove && top < m) top = p.top + size + GAP;
        if (!placeAbove && top + ph > window.innerHeight - m) top = p.top - GAP - ph;
        top = Math.min(Math.max(top, m), Math.max(m, window.innerHeight - ph - m));

        // 水平：按钮在右半屏则右对齐，左半屏则左对齐
        let left;
        if (narrow) {
            left = 8;
        } else {
            const btnCenter = p.left + size / 2;
            left = btnCenter > window.innerWidth / 2 ? p.left + size - width : p.left;
            left = Math.min(Math.max(left, m), Math.max(m, window.innerWidth - width - m));
        }

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    }

    /* ============================================================
     * 6. Panel 构建
     * ============================================================ */
    function buildPanel() {
        const panel = document.createElement('nav');
        panel.id = TOC_PANEL_ID;
        panel.setAttribute('aria-label', '文章目录');
        panel.className = `${TOC_NS}-panel`;

        // 头部工具条：移动 / 复位
        const head = document.createElement('div');
        head.className = `${TOC_NS}-head`;

        const title = document.createElement('span');
        title.className = `${TOC_NS}-title`;
        title.textContent = '目录';

        const actions = document.createElement('div');
        actions.className = `${TOC_NS}-actions`;

        const moveBtn = document.createElement('button');
        moveBtn.type = 'button';
        moveBtn.className = `${TOC_NS}-act`;
        moveBtn.setAttribute('data-act', 'move');
        moveBtn.textContent = '移动位置';
        moveBtn.title = '点击页面任意位置，把按钮放到那里';

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = `${TOC_NS}-act`;
        resetBtn.setAttribute('data-act', 'reset');
        resetBtn.textContent = '复位';
        resetBtn.title = '恢复到右下角默认位置';

        actions.appendChild(moveBtn);
        actions.appendChild(resetBtn);
        head.appendChild(title);
        head.appendChild(actions);

        const body = document.createElement('div');
        body.className = `${TOC_NS}-body`;
        body.appendChild(buildTree(state.headings));

        head.addEventListener('click', (e) => {
            const act = e.target.closest('[data-act]');
            if (!act) return;
            e.preventDefault();
            e.stopPropagation();
            if (act.getAttribute('data-act') === 'move') enterPlacer();
            else resetPos();
        });

        panel.appendChild(head);
        panel.appendChild(body);

        state.panel = panel;
        state.built = true;
        return panel;
    }

    /* ============================================================
     * 7. 面板显隐
     * ============================================================ */
    function togglePanel(force) {
        const willShow = typeof force === 'boolean' ? force : !state.visible;

        if (willShow) {
            if (state.panel && !state.panel.parentNode) state.root.appendChild(state.panel);
            state.visible = true;
            positionPanel();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    state.panel && state.panel.classList.add(`${TOC_NS}-panel--open`);
                });
            });
            state.panel && state.panel.setAttribute('aria-hidden', 'false');
            state.button && state.button.setAttribute('aria-expanded', 'true');
            state.button && state.button.classList.add(`${TOC_NS}-btn--active`);
        } else {
            state.panel && state.panel.classList.remove(`${TOC_NS}-panel--open`);
            state.panel && state.panel.setAttribute('aria-hidden', 'true');
            state.button && state.button.setAttribute('aria-expanded', 'false');
            state.button && state.button.classList.remove(`${TOC_NS}-btn--active`);
            state.visible = false;
        }
    }

    /* ============================================================
     * 8. 点选放置模式：点哪放哪
     * ============================================================ */
    function enterPlacer() {
        if (state.placer || !state.root) return;

        const ov = document.createElement('div');
        ov.className = `${TOC_NS}-placer`;

        const tip = el('div', `${TOC_NS}-placer-tip`);
        tip.appendChild(document.createTextNode('点击页面任意位置，把目录按钮放到这里'));
        tip.appendChild(document.createElement('br'));
        tip.appendChild(el('span', null, '按 Esc 取消'));

        const ghost = document.createElement('div');
        ghost.className = `${TOC_NS}-ghost`;
        const size = btnSize();
        ghost.style.width = `${size}px`;
        ghost.style.height = `${size}px`;

        ov.appendChild(tip);
        ov.appendChild(ghost);
        state.root.appendChild(ov);
        state.placer = ov;

        const onMove = (e) => {
            ghost.style.left = `${e.clientX}px`;
            ghost.style.top = `${e.clientY}px`;
            ghost.style.display = 'block';
        };
        const onPick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            setPos({ left: e.clientX - size / 2, top: e.clientY - size / 2 }, { snap: true });
            exitPlacer();
        };
        const onKey = (e) => { if (e.key === 'Escape') exitPlacer(); };

        ov.addEventListener('pointermove', onMove);
        ov.addEventListener('pointerdown', onPick);
        ov.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
        document.addEventListener('keydown', onKey, true);

        state.placerCleanup = () => {
            ov.removeEventListener('pointermove', onMove);
            ov.removeEventListener('pointerdown', onPick);
            document.removeEventListener('keydown', onKey, true);
        };
    }

    function exitPlacer() {
        if (!state.placer) return;
        state.placerCleanup && state.placerCleanup();
        state.placer.remove();
        state.placer = null;
        state.placerCleanup = null;
    }

    /* ============================================================
     * 9. 按钮构建 + 拖拽
     * ============================================================ */
    function buildButton() {
        const btn = document.createElement('button');
        btn.id = TOC_BUTTON_ID;
        btn.type = 'button';
        btn.className = `${TOC_NS}-btn`;
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', TOC_PANEL_ID);
        btn.title = '目录（拖动可移动位置，双击复位）';

        // 用 DOM API 构造 SVG：不触发 Trusted Types，也不依赖 emoji 字体
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', `${TOC_NS}-btn-icon`);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        [
            [8, 6, 21, 6],
            [8, 12, 21, 12],
            [8, 18, 21, 18],
            [3, 6, 3.01, 6],
            [3, 12, 3.01, 12],
            [3, 18, 3.01, 18],
        ].forEach(([x1, y1, x2, y2]) => {
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', String(x1));
            line.setAttribute('y1', String(y1));
            line.setAttribute('x2', String(x2));
            line.setAttribute('y2', String(y2));
            svg.appendChild(line);
        });
        btn.appendChild(svg);

        let suppressClick = false;

        btn.addEventListener('click', (e) => {
            if (suppressClick) return;          // 刚刚是拖动，不触发展开
            if (e.detail >= 2) { resetPos(); return; } // 双击 → 复位

            // 已经展开时只负责收起，不重复采集
            if (state.visible) { togglePanel(false); return; }

            // 每次展开都重新采集：兼容动态加载、无限滚动和 SPA 页面
            const headings = collectHeadings();
            if (headings.length < 2) {
                if (state.panel) { state.panel.remove(); state.panel = null; }
                state.built = false;
                btn.classList.add(`${TOC_NS}-btn--disabled`);
                btn.title = '当前页面无可用目录';
                return;
            }

            btn.classList.remove(`${TOC_NS}-btn--disabled`);
            btn.title = '目录（拖动可移动位置，双击复位）';
            if (state.panel) { state.panel.remove(); state.panel = null; }
            state.built = false;
            buildPanel();
            togglePanel(true);
        });

        // 拖动结束后抑制紧随其后的 click，避免误展开面板
        if (HAS_POINTER) attachDrag(btn, () => {
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 200);
        });

        state.button = btn;
        return btn;
    }

    /** 指针拖拽：阈值区分点击与拖动，松手吸附+记忆 */
    function attachDrag(btn, markDragged) {
        let active = false;
        let startX = 0, startY = 0;
        let origin = { left: 0, top: 0 };
        let pending = null;
        let raf = 0;

        const flush = () => {
            raf = 0;
            if (!pending) return;
            applyPos(clampPos(pending));
            pending = null;
        };

        const onMove = (e) => {
            if (!active) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!state.dragging) {
                if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
                state.dragging = true;
                btn.classList.add(`${TOC_NS}-btn--dragging`);
                exitPlacer();
            }
            pending = { left: origin.left + dx, top: origin.top + dy };
            if (!raf) raf = requestAnimationFrame(flush);
        };

        const onUp = (e) => {
            if (!active) return;
            active = false;
            document.removeEventListener('pointermove', onMove, true);
            document.removeEventListener('pointerup', onUp, true);
            document.removeEventListener('pointercancel', onUp, true);

            if (raf) { cancelAnimationFrame(raf); flush(); }

            if (state.dragging) {
                const snapped = snapPos(state.pos);
                btn.classList.add(`${TOC_NS}-btn--snap`);
                applyPos(snapped);
                savePos(snapped);
                setTimeout(() => btn.classList.remove(`${TOC_NS}-btn--snap`), 240);
                markDragged && markDragged();   // 抑制本次 click
            }

            state.dragging = false;
            btn.classList.remove(`${TOC_NS}-btn--dragging`);
            try { btn.releasePointerCapture && e.pointerId != null && btn.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
        };

        btn.addEventListener('pointerdown', (e) => {
            if (e.button != null && e.button !== 0) return;
            if (state.placer) return;
            active = true;
            state.dragging = false;
            startX = e.clientX;
            startY = e.clientY;
            origin = { left: state.pos.left, top: state.pos.top };
            try { btn.setPointerCapture && e.pointerId != null && btn.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
            document.addEventListener('pointermove', onMove, true);
            document.addEventListener('pointerup', onUp, true);
            document.addEventListener('pointercancel', onUp, true);
        });
    }

    /* ============================================================
     * 10. 样式注入 —— 全部 fixed 定位，彻底脱离文档流
     * ============================================================ */
    const STYLE_ID = `${TOC_NS}-style`;
    let styleMode = 'none';

    function injectStyles() {
        if (styleMode !== 'none') return;

        const css = `
/* ---- 根容器：样式隔离 ---- */
#${TOC_ROOT_ID} {
    all: initial;
    position: fixed;
    left: 0; top: 0; width: 0; height: 0;
    z-index: 2147483640;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

/* ---- 按钮：位置由 JS 控制（left/top 内联），此处不写 !important 以免覆盖 ---- */
#${TOC_ROOT_ID} .${TOC_NS}-btn {
    all: initial;
    position: fixed !important;
    left: 0; top: 0;
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
    cursor: grab !important;
    box-shadow: 0 4px 12px rgba(79,70,229,0.4), 0 2px 4px rgba(0,0,0,0.15) !important;
    transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease !important;
    padding: 0 !important;
    margin: 0 !important;
    font-size: 0 !important;
    line-height: 1 !important;
    touch-action: none !important;
    user-select: none !important;
    -webkit-user-select: none !important;
    -webkit-tap-highlight-color: transparent !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-btn:hover {
    background: #4338ca !important;
    transform: scale(1.08) !important;
    box-shadow: 0 6px 20px rgba(79,70,229,0.5), 0 2px 6px rgba(0,0,0,0.2) !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-btn--active {
    background: #4338ca !important;
    box-shadow: 0 6px 18px rgba(79,70,229,0.55), 0 0 0 4px rgba(79,70,229,0.18) !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-btn--dragging {
    cursor: grabbing !important;
    transform: scale(1.14) !important;
    box-shadow: 0 12px 30px rgba(79,70,229,0.55), 0 2px 8px rgba(0,0,0,0.25) !important;
    opacity: 0.96 !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-btn--snap {
    transition: left 0.18s cubic-bezier(.22,.61,.36,1), top 0.18s cubic-bezier(.22,.61,.36,1), transform 0.2s ease !important;
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
    pointer-events: none !important;
}

/* ---- 面板：位置与尺寸由 JS 控制 ---- */
#${TOC_ROOT_ID} .${TOC_NS}-panel {
    all: initial;
    position: fixed !important;
    z-index: 2147483641 !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    background: #ffffff !important;
    color: #1d2939 !important;
    font-size: 14px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
    line-height: 1.7 !important;
    margin: 0 !important;
    border: 1px solid #e4e7ec !important;
    border-radius: 12px !important;
    box-shadow: 0 10px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08) !important;
    opacity: 0 !important;
    transform: translateY(12px) scale(0.96) !important;
    pointer-events: none !important;
    transition: opacity 0.22s ease, transform 0.22s ease !important;
    visibility: visible !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-panel--open {
    opacity: 1 !important;
    transform: translateY(0) scale(1) !important;
    pointer-events: auto !important;
}

/* ---- 面板头部 ---- */
#${TOC_ROOT_ID} .${TOC_NS}-head {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 8px !important;
    padding: 9px 12px !important;
    border-bottom: 1px solid #e4e7ec !important;
    flex: 0 0 auto !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-title {
    font-size: 13px !important;
    font-weight: 600 !important;
    color: #1d2939 !important;
    line-height: 1.4 !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-actions {
    display: flex !important;
    gap: 6px !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-act {
    all: initial;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
    font-size: 12px !important;
    line-height: 1 !important;
    padding: 6px 9px !important;
    border: 1px solid #e4e7ec !important;
    border-radius: 6px !important;
    background: #f9fafb !important;
    color: #475467 !important;
    cursor: pointer !important;
    white-space: nowrap !important;
    -webkit-tap-highlight-color: transparent !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-act:hover {
    background: #eef2ff !important;
    color: #3538cd !important;
    border-color: #c7d2fe !important;
}

/* ---- 面板正文（滚动区） ---- */
#${TOC_ROOT_ID} .${TOC_NS}-body {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    overflow-y: auto !important;
    padding: 12px 14px !important;
    -webkit-overflow-scrolling: touch !important;
    overscroll-behavior: contain !important;
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
    line-height: 1.7 !important;
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

/* ---- 点选放置模式 ---- */
#${TOC_ROOT_ID} .${TOC_NS}-placer {
    position: fixed !important;
    left: 0 !important; top: 0 !important;
    width: 100vw !important; height: 100vh !important;
    z-index: 2147483645 !important;
    background: rgba(79,70,229,0.08) !important;
    cursor: crosshair !important;
    touch-action: none !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-placer-tip {
    position: fixed !important;
    left: 50% !important; top: 22px !important;
    transform: translateX(-50%) !important;
    max-width: 84vw !important;
    padding: 10px 14px !important;
    border-radius: 10px !important;
    background: #1e293b !important;
    color: #ffffff !important;
    font-size: 13px !important;
    line-height: 1.6 !important;
    text-align: center !important;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3) !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-placer-tip span {
    font-size: 12px !important;
    opacity: 0.75 !important;
}
#${TOC_ROOT_ID} .${TOC_NS}-ghost {
    position: fixed !important;
    display: none !important;
    border-radius: 50% !important;
    border: 2px dashed #4f46e5 !important;
    background: rgba(79,70,229,0.18) !important;
    transform: translate(-50%, -50%) !important;
    pointer-events: none !important;
}

/* ---- 暗色模式 ---- */
@media (prefers-color-scheme: dark) {
    #${TOC_ROOT_ID} .${TOC_NS}-btn { background: #6366f1 !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-btn:hover { background: #818cf8 !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-btn--active { background: #818cf8 !important; box-shadow: 0 6px 18px rgba(99,102,241,0.5), 0 0 0 4px rgba(99,102,241,0.22) !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-panel {
        background: #1e293b !important;
        color: #e2e8f0 !important;
        border-color: #334155 !important;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3) !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-head { border-bottom-color: #334155 !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-title { color: #f1f5f9 !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-act {
        background: #0f172a !important;
        color: #94a3b8 !important;
        border-color: #334155 !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-act:hover { background: #312e81 !important; color: #c7d2fe !important; border-color: #4338ca !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-list .${TOC_NS}-list { border-left-color: #334155 !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-link { color: #94a3b8 !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-link:hover,
    #${TOC_ROOT_ID} .${TOC_NS}-link:focus { background: #312e81 !important; color: #c7d2fe !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-item[data-level="1"] > .${TOC_NS}-link { color: #f1f5f9 !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-item[data-level="3"] > .${TOC_NS}-link,
    #${TOC_ROOT_ID} .${TOC_NS}-item[data-level="4"] > .${TOC_NS}-link { color: #64748b !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-placer { background: rgba(99,102,241,0.12) !important; }
    #${TOC_ROOT_ID} .${TOC_NS}-ghost { border-color: #818cf8 !important; background: rgba(129,140,248,0.2) !important; }
}

/* ---- 移动端 ---- */
@media (max-width: 767px) {
    #${TOC_ROOT_ID} .${TOC_NS}-btn {
        width: 44px !important;
        height: 44px !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-btn-icon {
        width: 20px !important;
        height: 20px !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-panel {
        font-size: 15px !important;
    }
    #${TOC_ROOT_ID} .${TOC_NS}-act {
        padding: 7px 10px !important;
        font-size: 12.5px !important;
    }
}

/* ---- 滚动锚点偏移 ---- */
h1[id], h2[id], h3[id], h4[id] {
    scroll-margin-top: 20px;
}
        `.trim();

        // constructed stylesheet 不受页面 CSP 的 inline-style 限制
        try {
            if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in Document.prototype) {
                const sheet = new CSSStyleSheet();
                sheet.replaceSync(css);
                document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
                styleMode = 'adopted';
                return;
            }
        } catch (e) { /* 浏览器不支持或被拦截，继续降级 */ }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.setAttribute('data-namespace', TOC_NS);
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
        styleMode = 'style';
    }

    /* ============================================================
     * 11. 初始化
     * ============================================================ */
    function init() {
        if (document.getElementById(TOC_ROOT_ID)) return;

        injectStyles();

        const root = document.createElement('div');
        root.id = TOC_ROOT_ID;
        root.setAttribute('data-toc', '1');

        const btn = buildButton();
        root.appendChild(btn);
        document.body.appendChild(root);

        state.root = root;
        state.container = findContainer();

        // 初始位置：记忆位置 → 否则右下角
        applyPos(clampPos(loadPos() || defaultPos()));

        // 窗口尺寸变化：重新约束位置并让面板跟随
        let rt = 0;
        window.addEventListener('resize', () => {
            clearTimeout(rt);
            rt = setTimeout(() => {
                if (!state.pos) return;
                applyPos(clampPos(state.pos));
                savePos(state.pos);
                if (state.visible) positionPanel();
            }, 120);
        });
        window.addEventListener('orientationchange', () => {
            setTimeout(() => { applyPos(clampPos(state.pos || defaultPos())); }, 300);
        });

        // 暴露调试接口
        window.__TOC__ = {
            state,
            collectHeadings,
            togglePanel,
            setPos,
            resetPos,
            rebuild() {
                state.built = false;
                state.panel && state.panel.remove();
                state.panel = null;
                collectHeadings();
                buildPanel();
                if (state.visible) {
                    state.root.appendChild(state.panel);
                    state.visible = true;
                    positionPanel();
                    requestAnimationFrame(() => {
                        state.panel && state.panel.classList.add(`${TOC_NS}-panel--open`);
                    });
                }
            },
        };
    }

    /* ============================================================
     * 12. 启动 + SPA 监听
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

    // SPA 路由变化 → 重置目录（保留按钮与位置）
    let lastUrl = location.href;

    function resetForSpa() {
        if (state.placer) exitPlacer();
        state.built = false;
        state.visible = false;
        state.headings = [];
        if (state.panel) { state.panel.remove(); state.panel = null; }
        if (state.button) {
            state.button.setAttribute('aria-expanded', 'false');
            state.button.classList.remove(`${TOC_NS}-btn--active`);
        }
        state.container = findContainer();
    }

    function onNavigate() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        resetForSpa();
    }

    // 用 history 钩子代替全文档 MutationObserver：只在真正换页时触发
    const HISTORY_HOOK = `__${TOC_NS}_history_hook`;
    const HISTORY_PATCHED = `__${TOC_NS}_history_patched`;
    history[HISTORY_HOOK] = onNavigate;   // 始终指向当前实例
    if (!history[HISTORY_PATCHED]) {
        history[HISTORY_PATCHED] = true;
        ['pushState', 'replaceState'].forEach((method) => {
            const original = history[method];
            history[method] = function (...args) {
                const result = original.apply(this, args);
                queueMicrotask(() => {
                    const hook = history[HISTORY_HOOK];
                    if (typeof hook === 'function') hook();
                });
                return result;
            };
        });
    }
    window.addEventListener('popstate', onNavigate);
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
        window.navigation.addEventListener('navigatesuccess', onNavigate);
    }

    // 点击页面其他区域关闭面板
    document.addEventListener('click', (e) => {
        if (!state.visible || !state.root) return;
        if (e.target.closest && e.target.closest(`#${TOC_ROOT_ID}`)) return;
        togglePanel(false);
    }, true);

    // Esc 关闭面板
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !state.visible) return;
        e.preventDefault();
        togglePanel(false);
    });

})();
