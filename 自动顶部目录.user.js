// ==UserScript==
// @name         网页顶部层级目录（非悬浮·移动端）
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const TOC_ID = 'gm-toc-top';
    if (document.getElementById(TOC_ID)) return;

    let retry = 0;
    const timer = setInterval(() => {
        const headings = Array.from(
            document.querySelectorAll('h1,h2,h3')
        ).filter(h => h.textContent.trim() && h.offsetParent !== null);

        if (headings.length < 2 && retry++ < 15) return;
        clearInterval(timer);
        if (headings.length < 2) return;

        const toc = document.createElement('nav');
        toc.id = TOC_ID;
        toc.setAttribute('aria-label', '文章目录');
        toc.style.cssText = `
            background: #f7f8fa;
            color: #222;
            font-size: 14px;
            line-height: 1.6;
            padding: 12px 14px;
            margin-bottom: 16px;
            border-bottom: 1px solid #ddd;
        `;

        const rootUl = document.createElement('ul');
        rootUl.style.paddingLeft = '0';
        toc.appendChild(rootUl);

        const stack = [rootUl];

        headings.forEach((h, i) => {
            if (!h.id) h.id = `toc-${i}`;
            const level = +h.tagName[1];

            while (stack.length > level) stack.pop();

            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = `#${h.id}`;
            a.textContent = h.textContent.trim();
            a.style.cssText = `
                color: #005fcc;
                text-decoration: none;
                display: block;
                padding: 3px 0;
            `;
            a.onclick = e => {
                e.preventDefault();
                document.getElementById(h.id)
                    .scrollIntoView({ behavior: 'smooth' });
            };

            li.appendChild(a);
            stack[stack.length - 1].appendChild(li);

            const ul = document.createElement('ul');
            ul.style.paddingLeft = '12px';
            li.appendChild(ul);
            stack.push(ul);
        });

        // ✅ 关键：插入到页面最顶部（非 fixed）
        document.body.insertBefore(toc, document.body.firstChild);
    }, 200);
})();
