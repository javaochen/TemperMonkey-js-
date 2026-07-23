// ==UserScript==
// @name         网页顶部层级目录（非悬浮·AI对话页安全·自动更新·强制置顶·可折叠）
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  在页面顶部插入 h1~h3 目录，AI对话页安全不插到中间，随内容自动更新，支持折叠/展开
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const TOC_ID = 'gm-toc-top';
    const TOC_STORAGE_KEY = 'gm-toc-collapsed';
    let rebuildTimer = null;
    let lastHeadingSig = '';

    /* ========== 工具函数 ========== */

    const getHeadings = () =>
        Array.from(document.querySelectorAll('h1,h2,h3'))
            .filter(h => h.textContent.trim() && h.offsetParent !== null);

    const getHeadingSig = () =>
        getHeadings().map(h => h.tagName + ':' + h.textContent.trim().slice(0, 40)).join('||');

    const looksLikeAIChat = () => {
        const text = document.body.innerText.slice(0, 3000).toLowerCase();
        const clues = [
            '[class*="chat"]',
            '[class*="message"]',
            '[class*="conversation"]',
            '[class*="thread"]',
            '[data-testid*="chat"]',
            '[data-testid*="message"]',
            '[role="log"]',
            '[role="region"]'
        ];
        const hasChatNode = clues.some(sel => document.querySelector(sel));
        const hasChatText = /chatgpt|claude|poe|gemini|bard|通义|文心|豆包|kimi|deepseek/.test(text);
        return hasChatNode || hasChatText;
    };

    // 读取折叠状态
    const isCollapsed = () => {
        try { return localStorage.getItem(TOC_STORAGE_KEY) === '1'; }
        catch (e) { return false; }
    };

    // 保存折叠状态
    const setCollapsed = (val) => {
        try { localStorage.setItem(TOC_STORAGE_KEY, val ? '1' : '0'); }
        catch (e) {}
    };

    /* ========== 找到插入点 ========== */

    const findInsertPoint = () => {
        const mainSelectors = [
            'main', '[role="main"]', '#main', '#content',
            '.main', '.content', '.article', '.post', '.thread',
            '[data-testid="thread"]', '[data-testid="conversation"]'
        ];
        for (const sel of mainSelectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetHeight > 100 && el.offsetParent !== null) {
                return { parent: el.parentNode, before: el, method: 'before-main' };
            }
        }
        const allDivs = Array.from(document.querySelectorAll('div, section, article'));
        const visible = allDivs.filter(d =>
            d.offsetHeight > 50 && d.offsetWidth > 200 &&
            d.offsetParent !== null && !d.closest('#' + TOC_ID)
        );
        if (visible.length > 0) {
            visible.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            const topEl = visible[0];
            if (topEl.getBoundingClientRect().top < 80) {
                return { parent: topEl.parentNode, before: topEl, method: 'before-top-el' };
            }
        }
        const bodyChildren = Array.from(document.body.children).filter(
            c => c.id !== TOC_ID && c.offsetHeight > 100
        );
        if (bodyChildren.length > 0) {
            return { parent: document.body, before: bodyChildren[0], method: 'body-first' };
        }
        return { parent: document.body, before: document.body.firstChild, method: 'body-fallback' };
    };

    /* ========== 折叠/展开控制 ========== */

    const applyCollapseState = (toc, collapsed) => {
        const body = toc.querySelector('.gm-toc-body');
        const btn = toc.querySelector('.gm-toc-toggle');
        if (!body || !btn) return;
        if (collapsed) {
            body.style.display = 'none';
            btn.textContent = '▶';
            btn.title = '展开目录';
            toc.classList.add('gm-toc-collapsed');
        } else {
            body.style.display = '';
            btn.textContent = '▼';
            btn.title = '折叠目录';
            toc.classList.remove('gm-toc-collapsed');
        }
    };

    const toggleTOC = (toc) => {
        const collapsed = !toc.classList.contains('gm-toc-collapsed');
        setCollapsed(collapsed);
        applyCollapseState(toc, collapsed);
    };

    /* ========== 构建目录 DOM ========== */

    const buildTOC = () => {
        const headings = getHeadings();
        if (headings.length < 2) {
            const old = document.getElementById(TOC_ID);
            if (old) old.remove();
            lastHeadingSig = '';
            return;
        }

        const sig = getHeadingSig();
        if (sig === lastHeadingSig) {
            // 即使没变化，也确保折叠按钮事件正常（防止 DOM 被外部替换）
            const existing = document.getElementById(TOC_ID);
            if (existing) {
                const btn = existing.querySelector('.gm-toc-toggle');
                if (btn && !btn.onclick) {
                    btn.onclick = () => toggleTOC(existing);
                }
            }
            return;
        }
        lastHeadingSig = sig;

        const old = document.getElementById(TOC_ID);
        if (old) old.remove();

        const collapsed = isCollapsed();

        // 容器
        const toc = document.createElement('nav');
        toc.id = TOC_ID;
        toc.setAttribute('aria-label', '文章目录');
        toc.style.cssText = `
            background: #f7f8fa !important;
            color: #222 !important;
            font-size: 14px !important;
            line-height: 1.6 !important;
            padding: 0 !important;
            margin: 0 0 16px 0 !important;
            border-bottom: 1px solid #ddd !important;
            border-top: 3px solid #005fcc !important;
            box-sizing: border-box !important;
            width: 100% !important;
            max-width: 100% !important;
            position: relative !important;
            z-index: 2147483646 !important;
            order: -9999 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        `;

        // 头部（标题 + 折叠按钮）
        const header = document.createElement('div');
        header.className = 'gm-toc-header';
        header.style.cssText = `
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 10px 14px !important;
            cursor: pointer !important;
            user-select: none !important;
            background: #eef2f7 !important;
            border-bottom: ${collapsed ? 'none' : '1px solid #ddd'} !important;
        `;

        const title = document.createElement('span');
        title.textContent = '📑 目录';
        title.style.cssText = `
            font-weight: 700 !important;
            color: #005fcc !important;
            font-size: 15px !important;
        `;

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'gm-toc-toggle';
        toggleBtn.type = 'button';
        toggleBtn.textContent = collapsed ? '▶' : '▼';
        toggleBtn.title = collapsed ? '展开目录' : '折叠目录';
        toggleBtn.style.cssText = `
            background: #fff !important;
            border: 1px solid #ccc !important;
            border-radius: 4px !important;
            width: 26px !important;
            height: 24px !important;
            line-height: 1 !important;
            font-size: 12px !important;
            font-weight: bold !important;
            color: #555 !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 0 !important;
            transition: background 0.15s !important;
        `;
        toggleBtn.onmouseover = () => { toggleBtn.style.background = '#e8eef5 !important'; };
        toggleBtn.onmouseout = () => { toggleBtn.style.background = '#fff !important'; };
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            toggleTOC(toc);
        };

        header.appendChild(title);
        header.appendChild(toggleBtn);

        // 点击头部也可以切换
        header.onclick = () => toggleTOC(toc);

        toc.appendChild(header);

        // 目录主体（可折叠区域）
        const body = document.createElement('div');
        body.className = 'gm-toc-body';
        body.style.cssText = `
            padding: 10px 14px 12px 14px !important;
            ${collapsed ? 'display: none !important;' : ''}
        `;

        const rootUl = document.createElement('ul');
        rootUl.style.cssText = `
            padding-left: 0 !important;
            margin: 0 !important;
            list-style: none !important;
        `;
        body.appendChild(rootUl);

        const stack = [{ ul: rootUl, level: 0 }];

        headings.forEach((h, i) => {
            if (!h.id) h.id = `toc-h-${i}-${Date.now()}`;
            const level = Math.min(+h.tagName[1], 6);

            while (stack.length > 1 && stack[stack.length - 1].level >= level) {
                stack.pop();
            }

            const li = document.createElement('li');
            li.style.cssText = `list-style: none !important; margin: 0 !important; padding: 0 !important;`;

            const a = document.createElement('a');
            a.href = `#${h.id}`;
            a.textContent = h.textContent.trim();
            a.style.cssText = `
                color: ${level === 1 ? '#005fcc' : level === 2 ? '#1a73e8' : '#555'} !important;
                text-decoration: none !important;
                display: block !important;
                padding: 3px 0 3px ${Math.min((level - 1) * 14, 42)}px !important;
                font-size: ${level === 1 ? '14px' : level === 2 ? '13.5px' : '13px'} !important;
                font-weight: ${level === 1 ? '600' : '400'} !important;
                border-left: ${level > 1 ? '2px solid #e0e0e0' : 'none'} !important;
                transition: color 0.15s !important;
            `;
            a.onclick = e => {
                e.preventDefault();
                const target = document.getElementById(h.id);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    const origBg = target.style.backgroundColor;
                    target.style.backgroundColor = '#fff3cd';
                    target.style.transition = 'background-color 0.5s';
                    setTimeout(() => { target.style.backgroundColor = origBg; }, 1500);
                }
            };
            a.onmouseover = () => { a.style.textDecoration = 'underline !important'; a.style.color = '#005fcc !important'; };
            a.onmouseout = () => { a.style.textDecoration = 'none !important'; };

            li.appendChild(a);

            const parentUl = stack[stack.length - 1].ul;
            parentUl.appendChild(li);

            const newUl = document.createElement('ul');
            newUl.style.cssText = `padding-left: 0 !important; margin: 0 !important; list-style: none !important;`;
            li.appendChild(newUl);
            stack.push({ ul: newUl, level });
        });

        toc.appendChild(body);

        if (collapsed) {
            toc.classList.add('gm-toc-collapsed');
        }

        /* ========== 插入策略 ========== */

        const point = findInsertPoint();

        if (looksLikeAIChat()) {
            if (point.method === 'body-fallback' || point.method === 'body-first') {
                const beforeEl = point.before;
                if (beforeEl && (
                    beforeEl.classList?.toString().includes('message') ||
                    beforeEl.classList?.toString().includes('chat') ||
                    beforeEl.querySelector?.('[class*="message"]')
                )) {
                    return;
                }
            }
        }

        if (point.parent && point.before) {
            point.parent.insertBefore(toc, point.before);
        } else if (point.parent) {
            point.parent.appendChild(toc);
        }
    };

    /* ========== 防抖更新 ========== */

    const scheduleRebuild = () => {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(buildTOC, 400);
    };

    /* ========== MutationObserver ========== */

    const observer = new MutationObserver(scheduleRebuild);
    observer.observe(document.body, { childList: true, subtree: true });
    if (document.head) {
        observer.observe(document.head, { childList: true, subtree: true });
    }

    /* ========== 初始构建 + 延迟重试 ========== */

    scheduleRebuild();
    [500, 1500, 3000, 5000, 10000].forEach(delay => {
        setTimeout(scheduleRebuild, delay);
    });

    /* ========== SPA 路由监听 ========== */

    window.addEventListener('popstate', () => {
        lastHeadingSig = '';
        setTimeout(scheduleRebuild, 300);
        setTimeout(scheduleRebuild, 1000);
    });

    const patchHistory = (method) => {
        const orig = history[method];
        history[method] = function (...args) {
            const ret = orig.apply(this, args);
            lastHeadingSig = '';
            setTimeout(scheduleRebuild, 300);
            setTimeout(scheduleRebuild, 1500);
            return ret;
        };
    };
    patchHistory('pushState');
    patchHistory('replaceState');

    /* ========== 清理 ========== */

    window.addEventListener('beforeunload', () => observer.disconnect());

})();
