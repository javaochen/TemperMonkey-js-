// ==UserScript==
// @name         AI Switcher · 多厂家 AI 一键切换栏
// @namespace    https://github.com/ai-switcher
// @version      1.4.1
// @description  在 AI 聊天页面显示可拖动、可排序的多厂家 AI 快捷图标，点击即在当前标签页切换到该 AI（Ctrl/中键则新标签打开）。支持自定义厂家、快捷键、位置记忆。已兼容 Trusted Types / 严格 CSP（ChatGPT、Gemini 等）。
// @author       javaochen
// @homepageURL  https://github.com/javaochen/js.Tampermonkey
// @supportURL   https://github.com/javaochen/js.Tampermonkey/issues
// @downloadURL  https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/ai-switcher.user.js
// @updateURL    https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/ai-switcher.user.js
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @match        https://gemini.google.com/*
// @match        https://chat.deepseek.com/*
// @match        https://yuanbao.tencent.com/*
// @match        https://www.doubao.com/*
// @match        https://www.kimi.com/*
// @match        https://www.qianwen.com/*
// @match        https://tongyi.aliyun.com/*
// @match        https://chat.qwen.ai/*
// @match        https://chatglm.cn/*
// @match        https://grok.com/*
// @match        https://xinghuo.xfyun.cn/*
// @match        https://copilot.microsoft.com/*
// @match        https://metaso.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * ─────────────────────────────────────────────────────────────
 *  AI Switcher 使用说明
 * ─────────────────────────────────────────────────────────────
 *  交互：
 *    · 拖动左侧 ≡ 把手  → 移动整条图标栏（位置自动记忆）
 *    · 拖动任意图标     → 调整排列顺序（把常用的拖到前列）
 *    · 单击图标         → 当前标签页切换到该 AI
 *    · Ctrl/Cmd+点击 / 鼠标中键点击 → 新标签页打开
 *    · 单击当前 AI 图标 → 聚焦该页面的输入框
 *  快捷键：
 *    · Alt + `        展开 / 收起图标栏
 *    · Alt + 1~9      切换到第 N 个 AI
 *    · Alt + [ / ]    上一个 / 下一个 AI
 *  设置：
 *    · 点击 ⚙ 打开设置面板（增删厂家、改顺序、切换模式、重置位置）
 *    · 或点击油猴菜单中的「AI Switcher 设置」
 *  排错：
 *    · 油猴菜单 →「🩺 诊断当前页面」，会打印 CSP / Trusted Types / 挂载状态
 *
 *  想让它在「指定页面」出现：修改头部 @match / @include 规则即可。
 *  想在所有页面都出现：新增一行 @match 规则，主机与路径两处均用星号通配（match all hosts）。
 * ─────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ═══════════════ 1. 默认配置 ═══════════════ */
  /* 顺序 = 默认排位，可直接在页面上拖动图标调整，也可用设置面板的 ↑↓ */

  const DEFAULT_LIST = [
    { id: 'deepseek',  name: 'DeepSeek', short: 'DS',   color: '#4d6bfe', url: 'https://chat.deepseek.com/',     hosts: ['chat.deepseek.com', 'deepseek.com'], on: true },
    { id: 'gemini',    name: 'Gemini',   short: 'G',    color: '#4285f4', url: 'https://gemini.google.com/app',  hosts: ['gemini.google.com'],                on: true },
    { id: 'doubao',    name: '豆包',     short: '豆',   color: '#4e6ef2', url: 'https://www.doubao.com/chat/',   hosts: ['doubao.com'],                       on: true },
    { id: 'kimi',      name: 'Kimi',     short: 'K',    color: '#1f2328', url: 'https://www.kimi.com/',          hosts: ['kimi.com', 'kimi.moonshot.cn'],    on: true },
    { id: 'qianwen',   name: '千问',     short: '千',   color: '#615ced', url: 'https://www.qianwen.com/',       hosts: ['qianwen.com', 'tongyi.aliyun.com'], on: true },
    { id: 'yuanbao',   name: '元宝',     short: '元',   color: '#0052d9', url: 'https://yuanbao.tencent.com/chat', hosts: ['yuanbao.tencent.com'],            on: true },
    { id: 'chatgpt',   name: 'ChatGPT',  short: 'GPT',  color: '#10a37f', url: 'https://chatgpt.com/',           hosts: ['chatgpt.com', 'chat.openai.com'],   on: true },
    { id: 'metaso',    name: '秘塔搜索', short: '秘',   color: '#3b82f6', url: 'https://metaso.cn/',             hosts: ['metaso.cn'],                        on: true },

    // ↓ 默认不启用，在 ⚙ 设置里勾选即可出现
    { id: 'claude',    name: 'Claude',   short: 'Cl',   color: '#d97757', url: 'https://claude.ai/new',          hosts: ['claude.ai'],                        on: false },
    { id: 'glm',       name: '智谱清言', short: 'GLM',  color: '#3b6cff', url: 'https://chatglm.cn/',            hosts: ['chatglm.cn', 'bigmodel.cn'],       on: false },
    { id: 'grok',      name: 'Grok',     short: 'X',    color: '#111827', url: 'https://grok.com/',              hosts: ['grok.com', 'x.com'],                on: false },
    { id: 'xinghuo',   name: '讯飞星火', short: '火',   color: '#ff7a00', url: 'https://xinghuo.xfyun.cn/',      hosts: ['xinghuo.xfyun.cn'],                 on: false },
    { id: 'copilot',   name: 'Copilot',  short: 'Co',   color: '#0078d4', url: 'https://copilot.microsoft.com/', hosts: ['copilot.microsoft.com'],            on: false },
    { id: 'qwenai',    name: 'Qwen Chat',short: 'Qw',   color: '#7c3aed', url: 'https://chat.qwen.ai/',          hosts: ['chat.qwen.ai'],                     on: false }
  ];

  const K = { list: 'ai_sw_list', pos: 'ai_sw_pos', collapsed: 'ai_sw_collapsed', mode: 'ai_sw_mode', ver: 'ai_sw_ver' };
  const VER = 4; // 配置结构版本号，升级时自动合并新厂家

  /* ═══════════════ 2. 存储（GM_ 优先，回退 localStorage） ═══════════════ */

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const store = {
    get(key, def) {
      try {
        const raw = hasGM ? GM_getValue(key, null) : localStorage.getItem(key);
        if (raw === null || raw === undefined) return def;
        return (hasGM ? raw : JSON.parse(raw));
      } catch (e) { return def; }
    },
    set(key, val) {
      try {
        if (hasGM) GM_setValue(key, val);
        else localStorage.setItem(key, JSON.stringify(val));
      } catch (e) { /* 忽略写入失败 */ }
    }
  };

  /* ═══════════════ 3. 状态 ═══════════════ */

  let list = store.get(K.list, null);
  if (!Array.isArray(list) || !list.length) {
    list = JSON.parse(JSON.stringify(DEFAULT_LIST));
  } else if (store.get(K.ver, 0) < VER) {
    // 版本升级：保留旧顺序与启用状态，仅追加新增厂家
    const byId = new Map(list.map(a => [a.id, a]));
    const merged = list.slice();
    DEFAULT_LIST.forEach(d => { if (!byId.has(d.id)) merged.push(JSON.parse(JSON.stringify(d))); });
    list = merged;
    store.set(K.ver, VER);
  }

  let mode = store.get(K.mode, 'self');
  let collapsed = store.get(K.collapsed, false);
  let pos = store.get(K.pos, null);

  const visibleList = () => list.filter(a => a.on);

  function isCurrent(ai) {
    const host = location.hostname;
    return (ai.hosts || []).some(h => host === h || host.endsWith('.' + h));
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /* ═══════════════ 4. DOM 安全工具（绕开 Trusted Types） ═══════════════ */
  /* Google / OpenAI 等站点开启 require-trusted-types-for 'script'，
     直接写 innerHTML 会抛 TypeError 并让整个脚本静默失效。
     以下统一改用 DOM API，绝不使用 innerHTML / insertAdjacentHTML。 */

  const TT = typeof window !== 'undefined' && ('trustedTypes' in window);

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function setCSS(cssText) {
    // 依次尝试 adoptedStyleSheets → <style>.textContent，两条路都不触发 Trusted Types
    try {
      if ('adoptedStyleSheets' in ShadowRoot.prototype && typeof CSSStyleSheet === 'function') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(cssText);
        sr.adoptedStyleSheets = [sheet];
        return 'adoptedStyleSheets';
      }
    } catch (e) { /* 继续降级 */ }
    const s = document.createElement('style');
    s.textContent = cssText;
    sr.appendChild(s);
    return 'style';
  }

  /* ═══════════════ 5. 样式 ═══════════════ */

  const CSS = `
    :host { all: initial; display: block; }
    .dock {
      position: fixed; z-index: 2147483000;
      display: flex; align-items: center; gap: 6px;
      padding: 6px; border-radius: 16px;
      background: rgba(24, 26, 32, .92);
      box-shadow: 0 10px 30px rgba(0,0,0,.30), 0 2px 8px rgba(0,0,0,.22);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
      user-select: none; -webkit-user-select: none;
      touch-action: none;
      transition: opacity .18s ease;
    }
    .dock.dragging { transition: none; }
    .grip {
      width: 16px; height: 34px; border-radius: 6px; cursor: grab;
      display: flex; align-items: center; justify-content: center;
      color: rgba(255,255,255,.55); font-size: 15px; line-height: 1; flex: none;
    }
    .grip:hover { background: rgba(255,255,255,.10); color: #fff; }
    .grip:active { cursor: grabbing; }
    .items { display: flex; align-items: center; gap: 6px; }
    .item {
      width: 36px; height: 36px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 12px; font-weight: 700; letter-spacing: -.2px;
      cursor: pointer; flex: none; position: relative;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.16);
      transition: transform .14s ease, box-shadow .14s ease, opacity .14s ease;
    }
    .item:hover { transform: translateY(-3px) scale(1.06); }
    .item.active { box-shadow: inset 0 0 0 2px #fff, 0 0 0 3px rgba(255,255,255,.22); }
    .item.dragging { opacity: .45; transform: scale(1.1); cursor: grabbing; }
    .item .dot {
      position: absolute; bottom: -1px; right: -1px; width: 9px; height: 9px;
      border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 2px rgba(24,26,32,.95);
    }
    .sep { width: 1px; height: 22px; background: rgba(255,255,255,.16); flex: none; margin: 0 2px; }
    .tool {
      width: 28px; height: 28px; border-radius: 8px; cursor: pointer; flex: none;
      display: flex; align-items: center; justify-content: center;
      color: rgba(255,255,255,.65); font-size: 14px; background: transparent;
    }
    .tool:hover { background: rgba(255,255,255,.12); color: #fff; }
    .peek {
      position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
      padding: 4px 9px; border-radius: 7px; background: rgba(0,0,0,.88); color: #fff;
      font-size: 12px; white-space: nowrap; pointer-events: none; opacity: 0;
      transition: opacity .14s ease; font-weight: 500;
    }
    .item:hover .peek { opacity: 1; }
    .badge {
      width: 40px; height: 40px; border-radius: 50%; cursor: pointer; flex: none;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 13px; font-weight: 700;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.20), 0 8px 24px rgba(0,0,0,.30);
    }
    .badge:hover { transform: scale(1.06); }

    .panel {
      position: fixed; z-index: 2147483001; width: 390px; max-height: 74vh;
      overflow: auto; padding: 16px; border-radius: 14px;
      background: #1b1d23; color: #e8eaed; box-shadow: 0 20px 60px rgba(0,0,0,.5);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 13px;
    }
    .panel h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
    .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .row input[type=text] {
      flex: 1; min-width: 0; background: #262930; border: 1px solid #363a44; color: #e8eaed;
      border-radius: 7px; padding: 6px 8px; font-size: 12px; font-family: inherit;
    }
    .row input[type=checkbox] { width: 16px; height: 16px; accent-color: #4f7cff; flex: none; }
    .row .swatch { width: 22px; height: 22px; border-radius: 50%; flex: none; border: none; padding: 0; cursor: pointer; }
    .btn-s {
      background: #31353f; color: #e8eaed; border: none; border-radius: 7px;
      padding: 6px 10px; cursor: pointer; font-size: 12px; font-family: inherit; flex: none;
    }
    .btn-s:hover { background: #3b404c; }
    .btn-s.primary { background: #4f7cff; color: #fff; }
    .btn-s.primary:hover { background: #5b86ff; }
    .btn-s.danger { background: transparent; color: #ff6b6b; padding: 6px 7px; }
    .btn-s.danger:hover { background: rgba(255,107,107,.14); }
    .hint { color: #9aa1ad; font-size: 11.5px; line-height: 1.6; margin: 10px 0 0; }
    .seg { display: flex; gap: 6px; margin-bottom: 14px; }
    .seg button { flex: 1; }
    .seg button.on { background: #4f7cff; color: #fff; }
    .foot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
    .toast {
      position: fixed; z-index: 2147483002; left: 50%; bottom: 42px; transform: translateX(-50%);
      background: rgba(20,22,28,.95); color: #fff; padding: 8px 16px; border-radius: 20px;
      font-size: 13px; font-family: -apple-system, "PingFang SC", sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.35); opacity: 0; transition: opacity .2s ease; pointer-events: none;
    }
  `;

  const hostEl = document.createElement('div');
  hostEl.id = 'ai-switcher-root';
  const sr = hostEl.attachShadow({ mode: 'open' });

  const dock = el('div', 'dock');

  const grip = el('div', 'grip', '⋮⋮');
  grip.title = '拖动移动图标栏';

  let cssMode = 'none';
  try { cssMode = setCSS(CSS); } catch (e) { cssMode = 'failed: ' + e.message; }

  /* ═══════════════ 6. 挂载（带守卫：被 SPA 冲掉后自动补回） ═══════════════ */

  function mount() {
    try {
      if (hostEl.isConnected && dock.isConnected) return true;
      if (!hostEl.isConnected) {
        (document.documentElement || document.body || document.head).appendChild(hostEl);
      }
      if (!dock.isConnected) sr.appendChild(dock);
      return true;
    } catch (e) { return false; }
  }

  let guardTries = 0;
  function guard() {
    if (guardTries > 12) return;           // 约 24 秒后停止探测
    guardTries++;
    if (!hostEl.isConnected || !dock.isConnected) {
      if (mount()) render();
    }
    setTimeout(guard, 2000);
  }

  /* ═══════════════ 7. 渲染 ═══════════════ */

  function makeChip(ai) {
    const n = el('div', 'item' + (isCurrent(ai) ? ' active' : ''), ai.short || (ai.name || '?').slice(0, 2));
    n.dataset.id = ai.id;
    n.style.background = ai.color || '#666';
    n.title = ai.name;
    if (isCurrent(ai)) n.appendChild(el('span', 'dot'));
    const peek = el('span', 'peek', ai.name);
    n.appendChild(peek);
    return n;
  }

  function makeTool(txt, title, onClick) {
    const b = el('div', 'tool', txt);
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    try {
      clear(dock);
      const vis = visibleList();

      if (collapsed) {
        const cur = vis.find(isCurrent);
        const ref = cur || vis[0] || { color: '#4f7cff', short: 'AI', name: 'AI 切换栏' };
        const badge = el('div', 'badge', ref.short || 'AI');
        badge.style.background = ref.color || '#4f7cff';
        badge.title = cur ? `当前：${cur.name}（点击展开，Alt+\` 亦可）` : '展开 AI 切换栏';
        badge.addEventListener('click', () => { collapsed = false; store.set(K.collapsed, false); render(); });
        dock.appendChild(badge);
        bindMove(badge);
        applyPos();
        return;
      }

      dock.appendChild(grip);

      const items = el('div', 'items');
      vis.forEach(ai => {
        const chip = makeChip(ai);
        bindItem(chip, ai);
        items.appendChild(chip);
      });
      dock.appendChild(items);

      dock.appendChild(el('div', 'sep'));
      dock.appendChild(makeTool('⚙', '设置', openPanel));
      dock.appendChild(makeTool('−', '收起（Alt+`）', () => {
        collapsed = true; store.set(K.collapsed, true); render();
      }));

      applyPos();
    } catch (e) {
      console.error('[AI Switcher] render 失败：', e);
    }
  }

  function applyPos() {
    try {
      const vw = innerWidth, vh = innerHeight;
      const w = dock.offsetWidth || 200, h = dock.offsetHeight || 48;
      if (!pos) pos = { left: vw - w - 16, top: Math.round(vh * 0.62) };
      pos.left = clamp(pos.left, 8, Math.max(8, vw - w - 8));
      pos.top = clamp(pos.top, 8, Math.max(8, vh - h - 8));
      dock.style.left = pos.left + 'px';
      dock.style.top = pos.top + 'px';
    } catch (e) { /* 忽略 */ }
  }

  /* ═══════════════ 8. 拖动：移动整条（grip 只绑定一次） ═══════════════ */

  bindMove(grip);

  function bindMove(handle) {
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = dock.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      let moved = false;
      dock.classList.add('dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }

      const onMove = ev => {
        const nl = ev.clientX - offX, nt = ev.clientY - offY;
        if (!moved && Math.abs(nl - rect.left) + Math.abs(nt - rect.top) < 4) return;
        moved = true;
        const w = dock.offsetWidth, h = dock.offsetHeight;
        pos = { left: clamp(nl, 8, Math.max(8, innerWidth - w - 8)), top: clamp(nt, 8, Math.max(8, innerHeight - h - 8)) };
        dock.style.left = pos.left + 'px';
        dock.style.top = pos.top + 'px';
      };
      const onUp = () => {
        dock.classList.remove('dragging');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        if (moved) store.set(K.pos, pos);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  /* ═══════════════ 9. 拖动排序 + 点击切换 ═══════════════ */

  function bindItem(node, ai) {
    node.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const startX = e.clientX, startY = e.clientY;
      let moved = false;
      try { node.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }

      const onMove = ev => {
        if (!moved) {
          if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
          moved = true;
          node.classList.add('dragging');
        }
        const container = node.parentElement;
        if (!container) return;
        const others = Array.prototype.filter.call(container.children, c => c !== node);
        for (const o of others) {
          const r = o.getBoundingClientRect();
          if (ev.clientX < r.left + r.width / 2) {
            if (node.nextElementSibling !== o) container.insertBefore(node, o);
            return;
          }
        }
        if (container.lastElementChild !== node) container.appendChild(node);
      };

      const onUp = ev => {
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.removeEventListener('pointercancel', onUp);
        if (moved) {
          node.classList.remove('dragging');
          // DOM 顺序 → 数据顺序（只重排已启用的项，未启用项位置不动）
          const order = Array.prototype.map.call(node.parentElement.children, c => c.dataset.id);
          const enabled = list.filter(a => a.on);
          const reordered = order.map(id => enabled.find(a => a.id === id)).filter(Boolean);
          if (reordered.length === enabled.length) {
            let k = 0;
            list = list.map(a => (a.on ? reordered[k++] : a));
            store.set(K.list, list);
          }
          render();
        } else if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
          go(ai, true);
        } else {
          go(ai, false);
        }
      };

      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onUp);
    });

    node.addEventListener('auxclick', e => {
      if (e.button === 1) { e.preventDefault(); go(ai, true); }
    });
  }

  /* ═══════════════ 10. 切换 ═══════════════ */

  function go(ai, forceNew) {
    if (isCurrent(ai)) { focusInput(); toast(`已在 ${ai.name}`); return; }
    if (forceNew || mode === 'new') {
      try { window.open(ai.url, '_blank', 'noopener'); }
      catch (e) { location.href = ai.url; }
    } else {
      location.href = ai.url;
    }
  }

  function focusInput() {
    try {
      const nodes = Array.prototype.filter.call(
        document.querySelectorAll('textarea, div[contenteditable="true"], input[type="text"]'),
        n => n.offsetParent !== null
      );
      const t = nodes.find(n => n.tagName === 'TEXTAREA') || nodes[0];
      if (t) t.focus();
    } catch (e) { /* 忽略 */ }
  }

  /* ═══════════════ 11. Toast ═══════════════ */

  let toastEl = null;
  function toast(msg) {
    try {
      if (!toastEl || !toastEl.isConnected) {
        toastEl = el('div', 'toast');
        sr.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.style.opacity = '1';
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(() => { toastEl.style.opacity = '0'; }, 1400);
    } catch (e) { /* 忽略 */ }
  }

  /* ═══════════════ 12. 设置面板 ═══════════════ */

  let panelEl = null;

  function closePanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; }
  }

  function openPanel() {
    try {
      if (panelEl) { closePanel(); return; }
      panelEl = el('div', 'panel');
      panelEl.style.right = '20px';
      panelEl.style.top = '20px';

      const h = el('h3', null, 'AI Switcher 设置');
      panelEl.appendChild(h);

      // 切换模式
      const seg = el('div', 'seg');
      const mk = (label, val) => {
        const b = el('button', 'btn-s' + (mode === val ? ' on' : ''), label);
        b.addEventListener('click', () => { mode = val; store.set(K.mode, val); drawSeg(); });
        return b;
      };
      const drawSeg = () => {
        clear(seg);
        seg.appendChild(mk('当前标签页切换', 'self'));
        seg.appendChild(mk('总是新标签打开', 'new'));
      };
      drawSeg();
      panelEl.appendChild(seg);

      const listWrap = el('div');
      panelEl.appendChild(listWrap);

      const drawList = () => {
        clear(listWrap);
        list.forEach((ai, i) => {
          const row = el('div', 'row');

          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.checked = !!ai.on; cb.title = '显示';
          cb.addEventListener('change', () => { ai.on = cb.checked; save(); });

          const sw = document.createElement('input');
          sw.type = 'color'; sw.className = 'swatch'; sw.value = ai.color || '#666';
          sw.addEventListener('input', () => { ai.color = sw.value; save(); });

          const nm = document.createElement('input');
          nm.type = 'text'; nm.value = ai.name || '';
          nm.addEventListener('change', () => { ai.name = nm.value.trim() || ai.id; save(); });

          const sh = document.createElement('input');
          sh.type = 'text'; sh.value = ai.short || '';
          sh.style.maxWidth = '48px'; sh.style.flex = '0 0 48px';
          sh.addEventListener('change', () => { ai.short = sh.value.trim() || (ai.name || '').slice(0, 2); save(); });

          const up = el('button', 'btn-s', '↑');
          up.addEventListener('click', () => {
            if (i === 0) return;
            list.splice(i - 1, 0, list.splice(i, 1)[0]); save(); drawList();
          });

          const dn = el('button', 'btn-s', '↓');
          dn.addEventListener('click', () => {
            if (i === list.length - 1) return;
            list.splice(i + 1, 0, list.splice(i, 1)[0]); save(); drawList();
          });

          const del = el('button', 'btn-s danger', '✕');
          del.addEventListener('click', () => { list.splice(i, 1); save(); drawList(); });

          row.appendChild(cb); row.appendChild(sw); row.appendChild(nm);
          row.appendChild(sh); row.appendChild(up); row.appendChild(dn); row.appendChild(del);
          listWrap.appendChild(row);

          const row2 = el('div', 'row');
          const url = document.createElement('input');
          url.type = 'text'; url.value = ai.url || ''; url.placeholder = 'https://…';
          url.addEventListener('change', () => { ai.url = url.value.trim(); save(); });
          const hs = document.createElement('input');
          hs.type = 'text'; hs.value = (ai.hosts || []).join(','); hs.placeholder = '域名，逗号分隔';
          hs.style.flex = '0 0 132px';
          hs.addEventListener('change', () => {
            ai.hosts = hs.value.split(',').map(s => s.trim()).filter(Boolean); save();
          });
          row2.appendChild(url); row2.appendChild(hs);
          listWrap.appendChild(row2);
        });
      };
      drawList();

      const addBtn = el('button', 'btn-s', '+ 添加厂家');
      addBtn.style.marginTop = '8px';
      addBtn.addEventListener('click', () => {
        list.push({ id: 'ai_' + Date.now(), name: '新 AI', short: 'AI', color: '#4f7cff', url: 'https://', hosts: [], on: true });
        save(); drawList();
      });
      panelEl.appendChild(addBtn);

      const foot = el('div', 'foot');
      const resetPos = el('button', 'btn-s', '重置位置');
      resetPos.addEventListener('click', () => { pos = null; store.set(K.pos, null); render(); toast('位置已重置'); });
      const resetAll = el('button', 'btn-s', '恢复默认');
      resetAll.addEventListener('click', () => {
        list = JSON.parse(JSON.stringify(DEFAULT_LIST)); save(); drawList(); render(); toast('已恢复默认');
      });
      const done = el('button', 'btn-s primary', '完成');
      done.addEventListener('click', () => { closePanel(); render(); });
      foot.appendChild(resetPos); foot.appendChild(resetAll); foot.appendChild(done);
      panelEl.appendChild(foot);

      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = '拖动图标栏左侧 ⋮⋮ 移动位置；拖动图标调整顺序。快捷键：Alt+` 收展，Alt+1~9 直切，Alt+[ / ] 前后切换。';
      panelEl.appendChild(hint);

      sr.appendChild(panelEl);
    } catch (e) {
      console.error('[AI Switcher] 面板打开失败：', e);
    }
  }

  function save() { store.set(K.list, list); }

  /* ═══════════════ 13. 快捷键 ═══════════════ */

  document.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const vis = visibleList();

    if (e.code === 'Backquote') {
      e.preventDefault();
      collapsed = !collapsed;
      store.set(K.collapsed, collapsed);
      render();
      return;
    }
    if (e.key === '[' || e.key === ']') {
      if (!vis.length) return;
      const idx = vis.findIndex(isCurrent);
      const next = idx < 0 ? 0 : (idx + (e.key === ']' ? 1 : -1) + vis.length) % vis.length;
      e.preventDefault();
      go(vis[next], false);
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && vis[n - 1]) {
      e.preventDefault();
      go(vis[n - 1], false);
    }
  }, true);

  /* ═══════════════ 14. 视口变化 & 菜单 ═══════════════ */

  let rz;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(applyPos, 120);
  });

  function diag() {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const info = {
      URL: location.href,
      'Trusted Types 已启用': TT,
      '页面 CSP meta': meta ? String(meta.content).slice(0, 120) : '无（响应头 CSP 请查 Network 面板）',
      '样式注入方式': cssMode,
      '挂载点': hostEl.parentElement ? hostEl.parentElement.tagName : '未挂载',
      'dock 已连接': dock.isConnected,
      '当前渲染图标数': sr.querySelectorAll('.item').length,
      '本页识别为': (visibleList().find(isCurrent) || {}).name || '未识别（不影响使用）'
    };
    console.log('%c[AI Switcher 诊断]', 'font-weight:700;color:#4f7cff');
    console.table(info);
    const msg = dock.isConnected
      ? `正常，已渲染 ${sr.querySelectorAll('.item').length} 个图标（详见控制台）`
      : '图标栏未挂载，请查看控制台诊断表';
    toast(msg);
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙ AI Switcher 设置', openPanel);
    GM_registerMenuCommand('↺ 重置 AI Switcher 位置', () => { pos = null; store.set(K.pos, null); render(); });
    GM_registerMenuCommand('🩺 诊断当前页面', diag);
  }

  /* ═══════════════ 15. 启动 ═══════════════ */

  try {
    if (mount()) render();
    guard();
    store.set(K.ver, VER);
  } catch (e) {
    console.error('[AI Switcher] 启动失败：', e);
  }
})();
