import { test, expect } from '../tests/fixtures';
import { auditOverlay, auditVariantPicker } from '../tests/a11y-dynamic';
import { A11Y_CHECKS, auditA11yExtras, type A11yCheck } from '../tests/a11y-extras';

const good = `<!doctype html><html lang="bg"><head><title>Добра страница</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>a:focus-visible,button:focus-visible{outline:3px solid #005fcc}</style></head><body>
<a href="#content">Към съдържанието</a>
<header><nav aria-label="Основна"><a href="/a">Начало</a><a href="/b">Каталог</a></nav></header>
<main id="content"><h1>Магазин</h1><a href="/p" aria-label="Прочети повече за продукта">Прочети повече</a>
<button aria-label="Добави в количката">Добави</button></main>
<footer><nav aria-label="Футър"><a href="/c">Контакти</a></nav></footer></body></html>`;

const bad = `<!doctype html><html lang="en"><head><title>Bad</title>
<meta name="viewport" content="width=device-width, user-scalable=no">
<style>a:focus,button:focus{outline:none}a,button{display:block}body{min-width:900px}</style></head><body>
<a href="#nowhere">Skip to content</a>
<nav><a href="/a">Home</a></nav><nav><a href="/b">Shop</a></nav>
<div><a href="/p">Read more</a><a href="/q" tabindex="3">Details</a>
<button aria-label="Buy now">Add</button></div></body></html>`;

test('good page has no extra accessibility problems; bad page trips every static check', async ({
  page,
}) => {
  await page.route('**/*', route =>
    route.fulfill({
      contentType: 'text/html',
      body: route.request().url().includes('bad') ? bad : good,
    }),
  );
  await page.goto('http://127.0.0.1:45993/good');
  const ok = await auditA11yExtras(page, 'bg-BG');
  expect(ok).toEqual(Object.fromEntries(Object.keys(A11Y_CHECKS).map(k => [k, []])));

  await page.goto('http://127.0.0.1:45993/bad');
  const broken = await auditA11yExtras(page, 'bg-BG');
  for (const check of [
    'landmarks',
    'skipLinks',
    'language',
    'zoom',
    'tabindex',
    'linkPurpose',
    'labelInName',
    'focusVisible',
    'reflow',
  ] as A11yCheck[])
    expect(broken[check].length, check).toBeGreaterThan(0);
});

const overlayPage = (
  good: boolean,
) => `<!doctype html><html lang="en"><head><title>Overlay</title><style>a,button,input{min-width:44px;min-height:44px;display:inline-block;margin:4px}</style></head><body>
<header><button id="open" ${good ? 'aria-expanded="false"' : ''}>Menu</button></header>
<main><h1>Shop</h1>
<fieldset><legend>Size</legend>
<label><input type="radio" name="size" value="s" checked> Small</label>
<label><input type="radio" name="size" value="m"> Medium</label></fieldset>
<div ${good ? '' : 'data-bad'}><label><input type="radio" name="color" value="r" checked> Red</label>
<label><input type="radio" name="color" value="g"> Green</label></div></main>
<div id="dlg" role="dialog" aria-modal="true" ${good ? 'aria-label="Menu"' : ''} hidden>
<a href="#a" id="first">One</a><a href="#b">Two</a></div>
<script>
const open=document.getElementById('open'),dlg=document.getElementById('dlg');
open.addEventListener('click',()=>{dlg.hidden=false;${good ? "open.setAttribute('aria-expanded','true');" : ''}${good ? "document.getElementById('first').focus();" : ''}});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&${good}){dlg.hidden=true;open.setAttribute('aria-expanded','false');open.focus();}
  if(e.key==='Tab'&&${good}&&!dlg.hidden){const l=[...dlg.querySelectorAll('a')];const i=l.indexOf(document.activeElement);
    e.preventDefault();l[(i+(e.shiftKey?-1:1)+l.length)%l.length].focus();}
});
</script></body></html>`;

test('overlay and variant audits pass a well-built page and flag a broken one', async ({
  page,
}) => {
  for (const good of [true, false]) {
    await page.route('**/*', route =>
      route.fulfill({ contentType: 'text/html', body: overlayPage(good) }),
    );
    await page.goto(`http://127.0.0.1:45993/${good ? 'good' : 'bad'}-overlay`);
    const overlay = await auditOverlay(page, page.locator('#open'));
    const variants = await auditVariantPicker(page);
    expect(overlay.applicable).toBe(true);
    if (good) {
      expect(overlay.problems).toEqual([]);
      expect(variants.problems.filter(p => p.includes('Option group "size"'))).toEqual([]);
    } else {
      expect(overlay.problems.join('\n')).toMatch(/aria-expanded/);
      expect(overlay.problems.join('\n')).toMatch(/accessible name/);
      expect(overlay.problems.join('\n')).toMatch(/Focus did not move/);
      expect(overlay.problems.join('\n')).toMatch(/Escape/);
    }
    expect(variants.problems.some(p => p.includes('Option group "color"'))).toBe(
      !good ? true : true,
    );
    await page.unroute('**/*');
  }
});
