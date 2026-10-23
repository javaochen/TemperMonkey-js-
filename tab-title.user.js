// ==UserScript==
// @name         最新问题→标签页标题
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  在 chatMode=temp 的 AI 对话界面，把用户最新问题提取为页面标题
// @homepageURL  https://github.com/javaochen/js.Tampermonkey
// @supportURL   https://github.com/javaochen/js.Tampermonkey/issues
// @downloadURL  https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/tab-title.user.js
// @updateURL    https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/tab-title.user.js
// @include      *://yuanbao.tencent.com/*chatMode=temp*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // 站点改版时只需要改这里
  const USER_MSG_SELECTOR = '.hyc-content-text';
  const MAX_TITLE_LEN = 40;
  const DEBOUNCE_MS = 400;
  const ENSURE_MS = 2000;   // 只比较 document.title，不查询 DOM

  let wanted = '';          // 当前要显示的标题（空 = 不覆盖）
  let siteTitle = document.title;
  let debounceTimer = 0;
  let lastNode = null;
  let lastRaw = '';

  /** 读取最后一条用户消息，内容未变化时直接复用缓存 */
  function latestQuestion() {
    const nodes = document.querySelectorAll(USER_MSG_SELECTOR);
    const last = nodes.length ? nodes[nodes.length - 1] : null;

    if (last !== lastNode) {
      lastNode = last;
      lastRaw = last ? (last.textContent || '') : '';
    } else if (last) {
      const current = last.textContent || '';
      if (current !== lastRaw) lastRaw = current;
    }

    let text = lastRaw.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length > MAX_TITLE_LEN) text = text.slice(0, MAX_TITLE_LEN) + '…';
    return text;
  }

  function applyTitle() {
    const question = latestQuestion();

    if (question) {
      if (question !== wanted) {
        // 首次覆盖前记住站点自己的标题，供新会话时恢复
        if (!wanted) siteTitle = document.title;
        wanted = question;
      }
      if (document.title !== wanted) document.title = wanted;
      return;
    }

    // 没有用户消息（新会话/空对话）→ 还原站点标题
    if (wanted) {
      wanted = '';
      if (document.title !== siteTitle) document.title = siteTitle;
    }
  }

  function schedule() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyTitle, DEBOUNCE_MS);
  }

  /** 站点可能自己改标题：记住它，再把问题压回去 */
  function watchTitle() {
    const titleEl = document.querySelector('title');
    if (!titleEl) return;

    new MutationObserver(() => {
      if (!wanted) {
        siteTitle = document.title;
        return;
      }
      if (document.title !== wanted) {
        siteTitle = document.title;
        document.title = wanted;
      }
    }).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  // 只订阅结构变化：AI 流式输出是 characterData，订阅它会让回调疯狂触发
  if (document.body) {
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // 兜底：站点在别处改了标题时压回去，但不做 DOM 查询
  setInterval(() => {
    if (wanted && document.title !== wanted) document.title = wanted;
  }, ENSURE_MS);

  /* ---- SPA 路由：新会话时恢复标题 ---- */
  let lastUrl = location.href;

  function onNavigate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    if (wanted) {
      wanted = '';
      if (document.title !== siteTitle) document.title = siteTitle;
    }
    lastNode = null;
    lastRaw = '';
    schedule();
  }

  const HISTORY_HOOK = '__tab_title_history_hook';
  const HISTORY_PATCHED = '__tab_title_history_patched';
  history[HISTORY_HOOK] = onNavigate;
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

  watchTitle();
  schedule();
  setTimeout(applyTitle, 1200);   // 首屏渲染较慢时的兜底
})();
