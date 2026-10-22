// ==UserScript==
// @name         最新问题→标签页标题
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  在 chatMode=temp 的 AI 对话界面，把用户最新问题提取为页面标题
// @homepageURL  https://github.com/javaochen/js.Tampermonkey
// @supportURL   https://github.com/javaochen/js.Tampermonkey/issues
// @downloadURL  https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/tab-title.user.js
// @updateURL    https://raw.githubusercontent.com/javaochen/js.Tampermonkey/main/tab-title.user.js
// @match        *://yuanbao.tencent.com/*chatMode=temp*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // 👇👇👇 改成你页面上"用户消息"对应的选择器
  // 常见写法举例：
  //   元宝: '[class*="user-message"]'  或  '.question-content'
  //   ChatGPT: '[data-message-author-role="user"]'
  //   DeepSeek: '.user-message'
  //   MiniMax: 左侧对话区域里的用户 bubble
  const USER_MSG_SELECTOR = '.hyc-content-text';
  // 👆👆👆

  const MAX_TITLE_LEN = 40;            // 标题最长字符数，超出截断
  let debounceTimer = null;
  let lastTitle = '';

  // 1. 提取"最新一条"用户问题
  function getLatestUserQuestion() {
    const nodes = document.querySelectorAll(USER_MSG_SELECTOR);
    if (!nodes.length) return '';
    // 取最后一条 = 最新问题
    const last = nodes[nodes.length - 1];
    let text = (last.innerText || last.textContent || '').trim();
    // 清理换行、多余空格
    text = text.replace(/\s+/g, ' ').trim();
    // 截断
    if (text.length > MAX_TITLE_LEN) {
      text = text.slice(0, MAX_TITLE_LEN) + '…';
    }
    return text;
  }

  // 2. 同步到 document.title
  function syncTitle() {
    const q = getLatestUserQuestion();
    if (q && q !== lastTitle) {
      lastTitle = q;
      document.title = q;
      console.log('[最新问题→标题]', q);
    }
  }

  // 3. 防抖执行（避免 MutationObserver 高频触发）
  function scheduleSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncTitle, 300);
  }

  // 4. 监听整个 body 的变化（AI 页面大多是 SPA，动态渲染）
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // 5. 首次运行 + 定时兜底（防止 observer 漏掉特殊情况）
  setTimeout(syncTitle, 1000);
  setInterval(syncTitle, 3000);

})();
