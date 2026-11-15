// Regression checks for Content (plugin/mod/datapack) 25-per-page pagination.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.error('FAIL', name); }
};

const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'css', '05-market.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', '01-content.js'), 'utf8');

ok('index.html has #contentPager inside .content-listwrap', /id="contentPager"/.test(html) && /id="contentPrevPage"/.test(html) && /id="contentPageLabel"/.test(html) && /id="contentNextPage"/.test(html));
ok('05-market.css styles .content-pager and .content-pager[hidden]', /\.content-pager\{/.test(css) && /\.content-pager\[hidden\]\{display:none\}/.test(css));
ok('01-content.js sets CONTENT_PAGE_SIZE = 25', /const CONTENT_PAGE_SIZE\s*=\s*25\b/.test(js));
ok('01-content.js wires #contentPrevPage and #contentNextPage', /#contentPrevPage[\s\S]*stepContentPage\(-1\)/.test(js) && /#contentNextPage[\s\S]*stepContentPage\(1\)/.test(js));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
