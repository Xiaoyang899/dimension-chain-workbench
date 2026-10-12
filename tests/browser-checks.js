async (page) => {
  const results = [];
  const url = page.url(), errors = [], externalRequests = [];
  const onError = error => errors.push(error.message);
  const onConsole = message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); };
  const onRequest = request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); };
  page.on('pageerror', onError); page.on('console', onConsole); page.on('request', onRequest);
  page.setDefaultTimeout(4000);
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  async function reset() {
    await page.emulateMedia({ media: null });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(() => { window.confirm = () => true; });
  }
  async function run(name, body) {
    try { await reset(); await body(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message }); }
  }
  const tab = name => page.getByRole('tab', { name, exact: true }).click();
  async function inViewport(selectors) {
    const geometry = await page.evaluate(selectors => {
      const rects = selectors.map(selector => {
        const el = document.querySelector(selector), r = el?.getBoundingClientRect();
        return { selector, visible: !!el?.checkVisibility(), x: r?.x, y: r?.y, right: r?.right, bottom: r?.bottom };
      });
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, rects };
    }, selectors);
    check(geometry.scrollWidth <= geometry.width + 1 && geometry.scrollHeight <= geometry.height + 1, JSON.stringify(geometry));
    check(geometry.rects.every(r => r.visible && r.x >= 0 && r.y >= 0 && r.right <= geometry.width + 1 && r.bottom <= geometry.height + 1), JSON.stringify(geometry));
  }
  async function paste25() {
    await page.locator('#paste-button').click();
    await page.locator('#paste-text').fill(Array.from({ length: 25 }, (_, i) => `环${i + 1}\t0\t+\t0.1\t-0.1`).join('\n'));
    await page.locator('#import-paste').click();
    await page.locator('#target-lower').fill('-1'); await page.locator('#target-upper').fill('1');
  }
  await run('direct tolerance entry edits only the selected ring and synchronizes both charts and slider', async () => {
    await tab('质量分析');
    const input = page.getByRole('spinbutton', { name: '所选组成环公差全宽数值', exact: true });
    check(await input.isVisible(), 'Direct tolerance input is missing');
    await page.locator('#quality-row-select').selectOption({ label: 'A2' });
    check(Number(await input.inputValue()) === .3, 'Input does not follow ring selection');
    const before = await page.locator('#probability-chart path').first().getAttribute('d');
    await input.fill('0');
    check(JSON.stringify(await page.locator('.closure-results output').allTextContents()) === '["4.2500","4.7500","4.3342","4.6658"]', 'Direct entry did not update both intervals');
    check(await page.locator('#wc-min').textContent() === '4.2500' && await page.locator('#probability-chart path').first().getAttribute('d') !== before, 'Direct entry did not redraw both charts');
    check(await page.locator('#tolerance-slider').inputValue() === '0' && await input.evaluate(el => el === document.activeElement), 'Input lost focus or failed to synchronize slider');
    await tab('组成环与建模');
    check(JSON.stringify(await page.locator('[data-field="upperDeviation"]').evaluateAll(els => els.map(el => el.value))) === '["0.05","0","0.05","0.15"]', 'Entry changed another ring');
    await tab('质量分析');
    await page.locator('#tolerance-slider').focus(); await page.keyboard.press('End');
    check(Number(await input.inputValue()) === 10, 'Slider does not synchronize numeric entry');
    await page.keyboard.press('ArrowLeft');
    check(Number(await input.inputValue()) === 9.9999, 'Slider fine step not reflected in entry');
  });
  await run('direct tolerance entry rejects widths above the 10 mm cap and preserves imported data and precision', async () => {
    await page.locator('#paste-button').click();
    await page.locator('#paste-text').fill('大公差环\t10\t+\t80\t-40\n小公差环\t0\t+\t0\t0');
    await page.locator('#import-paste').click(); await tab('质量分析');
    const input = page.locator('#tolerance-value');
    check(await input.isVisible(), 'Direct tolerance input is missing');
    check(Number(await input.inputValue()) === 120, 'Large imported width was clamped on display');
    check(await page.locator('#tolerance-slider').inputValue() === '10' && await page.locator('#width-warning').isVisible(), 'Large width needs a bounded slider and warning');
    const saved = await page.evaluate(() => localStorage.getItem('chainlab-project-v1'));
    await input.fill('140');
    check(await input.getAttribute('aria-invalid') === 'true', 'Width above the 10 mm cap was accepted');
    await input.press('Tab');
    check(await page.locator('[data-field="upperDeviation"]').first().inputValue() === '80' && await page.locator('[data-field="lowerDeviation"]').first().inputValue() === '-40', 'Rejected over-cap entry moved the asymmetric midpoint');
    check(Number(await input.inputValue()) === 120 && await page.evaluate(() => localStorage.getItem('chainlab-project-v1')) === saved, 'Rejected over-cap entry rewrote the imported width or autosave');
    await input.fill('10.0001');
    check(await input.getAttribute('aria-invalid') === 'true', 'Width just above the cap was accepted');
    await input.fill('10'); await input.press('Tab');
    check(await page.locator('[data-field="upperDeviation"]').first().inputValue() === '25' && await page.locator('[data-field="lowerDeviation"]').first().inputValue() === '15', 'Cap boundary width did not keep the asymmetric midpoint');
    await page.locator('#quality-row-select').selectOption({ label: '小公差环' });
    await page.locator('#quality-row-select').selectOption({ label: '大公差环' });
    check(Number(await input.inputValue()) === 10 && !await page.locator('#width-warning').isVisible(), 'Selection changed a capped width or kept a stale warning');
    await input.fill('0.12345678'); await input.press('Tab');
    check(Math.abs(Number(await input.inputValue()) - .12345678) < 1e-12, 'Input was rounded to display precision or slider step');
    await page.locator('#save-button').click();
    const row = JSON.parse(await page.locator('#export-text').inputValue()).rows[0];
    check(Math.abs(row.upperDeviation - 20.06172839) < 1e-12 && Math.abs(row.lowerDeviation - 19.93827161) < 1e-12, 'Saved deviations lost entered precision or center');
    await page.locator('#confirm-saved').click();
  });
  await run('unrepresentable positive width at a nonzero midpoint is rejected without changing the model or preview', async () => {
    await page.locator('#paste-button').click();
    await page.locator('#paste-text').fill('偏置环\t10\t+\t80\t-40');
    await page.locator('#import-paste').click();
    await page.locator('#target-lower').fill('29.9'); await page.locator('#target-upper').fill('30.1');
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    check(await page.locator('#apply-allocation').isEnabled(), 'Offset fixture needs a valid allocation preview');
    const saved = await page.evaluate(() => localStorage.getItem('chainlab-project-v1'));
    await tab('质量分析');
    const input = page.locator('#tolerance-value');
    await input.fill('1e-16');
    check(await input.getAttribute('aria-invalid') === 'true', 'Unrepresentable positive width was silently accepted');
    check(await page.locator('[data-field="upperDeviation"]').inputValue() === '80' && await page.locator('[data-field="lowerDeviation"]').inputValue() === '-40', 'Unrepresentable entry collapsed actual deviations');
    check(await page.locator('#apply-allocation').isEnabled() && await page.evaluate(() => localStorage.getItem('chainlab-project-v1')) === saved, 'Rejected entry modified preview or autosave');
    await input.press('Tab');
    check(Number(await input.inputValue()) === 120, 'Rejected entry did not restore actual width');
    await input.fill('0'); await input.press('Tab');
    check(await page.locator('[data-field="upperDeviation"]').inputValue() === '20' && await page.locator('[data-field="lowerDeviation"]').inputValue() === '20', 'Explicit zero width must still be allowed');
  });
  await run('invalid and unchanged numeric tolerances preserve model state while real edits invalidate consent and preview', async () => {
    await page.locator('[data-field="distribution"]').first().selectOption('uniform');
    await tab('质量分析'); await page.locator('#accept-approximation').check();
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    check(await page.locator('#apply-allocation').isEnabled(), 'Preview fixture missing');
    await tab('质量分析');
    const input = page.locator('#tolerance-value');
    check(await input.isVisible(), 'Direct tolerance input is missing');
    const saved = await page.evaluate(() => localStorage.getItem('chainlab-project-v1'));
    await input.fill('0.1000'); await input.press('Tab');
    for (const value of ['', '-1', '1e309', '1e12', '1e-151', '10.0001', '99']) {
      await input.fill(value);
      check(await input.getAttribute('aria-invalid') === 'true', `Invalid numeric entry not identified: ${value}`);
      check(await page.evaluate(() => localStorage.getItem('chainlab-project-v1')) === saved, 'Invalid or unchanged input modified saved model');
      await input.press('Tab');
      check(Number(await input.inputValue()) === .1 && !await page.locator('#validation-errors').isVisible(), 'Invalid draft did not restore last valid width');
      check(await page.locator('#accept-approximation').isChecked() && await page.locator('#apply-allocation').isEnabled(), 'Invalid or unchanged entry discarded consent/preview');
    }
    await input.fill('0.2');
    check(!await page.locator('#accept-approximation').isChecked() && await page.locator('#apply-allocation').isDisabled(), 'Real width change kept stale consent/preview');
  });
  await run('quality slider occupies one quarter of desktop width with its numeric input on the left', async () => {
    await tab('质量分析');
    check(await page.locator('#tolerance-slider').getAttribute('max') === '10', 'Slider drag range is not capped at 10 mm');
    check((await page.locator('.slider-note').innerText()).includes('0–10 mm'), 'Drag range note does not state the 10 mm cap');
    for (const size of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      const slider = await page.locator('#tolerance-slider').boundingBox();
      check(Math.abs(slider.width - size.width / 4) <= 2, `Slider not quarter-width: ${slider.width} at ${size.width}`);
      const input = await page.locator('#tolerance-value').boundingBox();
      check(input && input.x + input.width <= slider.x && Math.abs(input.y + input.height / 2 - slider.y - slider.height / 2) < 2, 'Numeric input is not at slider left');
      await inViewport(['#tolerance-value', '#tolerance-slider', '#quality-row-select', '#worst-chart', '#probability-chart', '#export-button']);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#tolerance-value').fill('0.5'); await page.locator('#tolerance-value').press('Tab');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Numeric input creates narrow-screen overflow');
    check(Number(await page.locator('#tolerance-value').inputValue()) === .5, 'Narrow-screen entry inaccessible');
  });
  await run('ring description column follows the identifier and draws a left-aligned second line in the chain diagram', async () => {
    const headers = await page.locator('.component-table thead th').allTextContents();
    check(JSON.stringify(headers.slice(0, 4)) === '["#","环标识","环描述","基本尺寸 mm"]', `Description column is not directly after the identifier: ${headers.join(',')}`);
    const description = page.locator('[data-field="description"]').first();
    check(await description.evaluate(el => el.closest('td').previousElementSibling.querySelector('[data-field="label"]') !== null), 'Description cell is not immediately right of the identifier cell');
    await page.locator('[data-field="distribution"]').first().selectOption('uniform');
    await tab('质量分析'); await page.locator('#accept-approximation').check();
    await tab('组成环与建模');
    await description.fill('轴承座宽度');
    check(await page.locator('#accept-approximation').isChecked(), 'Description edit invalidated non-normal consent');
    const lines = await page.locator('.chain-ring').first().locator('text').allTextContents();
    check(lines.length === 2 && lines[0].startsWith('A1') && lines[1] === '轴承座宽度', `Diagram does not stack identifier and description: ${lines}`);
    const geometry = await page.locator('.chain-ring').first().evaluate(group => {
      const [label, desc] = group.querySelectorAll('text');
      const labelBox = label.getBoundingClientRect(), descBox = desc.getBoundingClientRect();
      return { left: labelBox.x, descLeft: descBox.x, labelY: Number(label.getAttribute('y')), descY: Number(desc.getAttribute('y')), anchor: desc.getAttribute('text-anchor') };
    });
    check(geometry.anchor === 'start' && Math.abs(geometry.descLeft - geometry.left) <= 1, `Description is not left-aligned with the identifier: ${JSON.stringify(geometry)}`);
    check(geometry.descY - geometry.labelY >= 8 && geometry.descY - geometry.labelY <= 14, `Description line spacing is wrong: ${JSON.stringify(geometry)}`);
    await page.locator('#save-button').click();
    check(JSON.parse(await page.locator('#export-text').inputValue()).rows[0].description === '轴承座宽度', 'Description missing from saved project file');
    await page.locator('#confirm-saved').click();
  });
  await run('projects saved before ring descriptions existed restore with an empty description column', async () => {
    await page.locator('#save-button').click();
    const saved = JSON.parse(await page.locator('#export-text').inputValue());
    await page.locator('#confirm-saved').click();
    delete saved.rows[0].description;
    await page.evaluate(data => localStorage.setItem('chainlab-project-v1', data), JSON.stringify(saved));
    await page.reload();
    await page.evaluate(() => { window.confirm = () => true; });
    check(await page.locator('#recovery-banner').isVisible(), 'Legacy autosave did not offer recovery');
    await page.locator('#restore-button').click();
    check(await page.locator('[data-field="description"]').first().inputValue() === '', 'Legacy project did not default the description to empty');
    check(!await page.locator('#validation-errors').isVisible(), 'Legacy project failed validation after restore');
    check(await page.locator('.chain-ring').first().locator('text').count() === 1, 'Legacy ring drew an empty description line');
  });
  await run('ring descriptions follow identifiers into quality, allocation and print outputs', async () => {
    await page.locator('[data-field="description"]').nth(0).fill('轴承座宽度');
    await page.locator('[data-field="description"]').nth(1).fill('垫片压缩量');
    await tab('质量分析');
    const options = await page.locator('#quality-row-select option').allTextContents();
    check(options[0] === 'A1 · 轴承座宽度' && options[1] === 'A2 · 垫片压缩量' && options[2] === 'A3', `Quality select omits ring descriptions: ${JSON.stringify(options)}`);
    await page.locator('#quality-row-select').selectOption({ label: 'A2 · 垫片压缩量' });
    check(await page.locator('#quality-row-select').evaluate(select => select.options[select.selectedIndex].textContent) === 'A2 · 垫片压缩量', 'Quality select cannot choose a described ring');
    await tab('公差反算');
    const described = page.locator('.contribution-row').filter({ hasText: '轴承座宽度' });
    check(await described.count() === 1 && await described.first().evaluate(button => button.textContent.startsWith('A1轴承座宽度')), 'Contribution list omits ring description after identifier');
    check(await page.locator('.contribution-row em').count() === 2, 'Contribution list drew descriptions for undescribed rings');
    await page.locator('#preview-allocation').click();
    const cells = await page.locator('#allocation-rows tr td:first-child').allTextContents();
    check(cells.includes('A1 · 轴承座宽度') && cells.includes('A2 · 垫片压缩量') && cells.includes('A3'), `Candidate table omits ring descriptions: ${JSON.stringify(cells)}`);
    await page.emulateMedia({ media: 'print' });
    try {
      const heads = await page.locator('#print-inputs thead th').allTextContents();
      check(heads[0] === '组成环' && heads[1] === '环描述', `Print header lacks description column: ${JSON.stringify(heads)}`);
      const row = await page.locator('#print-rows tr').first().locator('td').allTextContents();
      check(row[0] === 'A1' && row[1] === '轴承座宽度' && row[5] === '-0.05', `Print row misplaces description: ${JSON.stringify(row)}`);
    } finally { await page.emulateMedia({ media: null }); }
  });
  await run('AEME tabs isolate panels without changing saved model or dirty state', async () => {
    await page.locator('#save-button').click(); const before = await page.locator('#export-text').inputValue();
    await page.locator('#confirm-saved').click();
    const state = await page.locator('#edit-state').textContent();
    await tab('质量分析');
    check(await page.locator('#quality').isVisible() && !await page.locator('#components').isVisible() && !await page.locator('#allocation').isVisible(), 'Tabs do not isolate panels');
    await page.getByRole('tab', { name: '质量分析', exact: true }).press('ArrowRight');
    check(await page.locator('#allocation').isVisible(), 'Arrow navigation failed');
    await page.getByRole('tab', { name: '公差反算', exact: true }).press('Home');
    check(await page.locator('#components').isVisible(), 'Home navigation failed');
    check(await page.locator('#edit-state').textContent() === state, 'Navigation dirties project');
    const downloadPromise = page.waitForEvent('download'); await page.locator('#save-button').click();
    check((await downloadPromise).suggestedFilename().startsWith('AEME-'), 'Old visible download brand');
    check(await page.locator('#export-text').inputValue() === before, 'Navigation changed serialization');
    await page.locator('#confirm-saved').click();
  });
  await run('shared dual charts stay above quality slider and refresh only on apply or undo', async () => {
    await page.locator('#new-button').click();
    await page.locator('#target-lower').fill('-0.05'); await page.locator('#target-upper').fill('0.05');
    await page.locator('#target-upper').fill('0.1');
    await tab('质量分析');
    const charts = await page.locator('.charts-grid').elementHandle();
    const worst = await page.locator('#worst-chart').boundingBox(), probability = await page.locator('#probability-chart').boundingBox(), slider = await page.locator('#tolerance-slider').boundingBox();
    check(slider.y >= Math.max(worst.y + worst.height, probability.y + probability.height), 'Slider must be below both charts');
    await tab('公差反算');
    check(await charts.evaluate(el => el.closest('#allocation') !== null), 'Charts not reparented into allocation');
    await inViewport(['#target-lower', '#target-upper', '#closure-worst-lower', '#closure-statistical-upper', '#worst-chart', '#probability-chart', '#preview-allocation', '#apply-allocation', '#undo-allocation']);
    const before = await page.locator('#probability-chart path').first().getAttribute('d');
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    check(await page.locator('#probability-chart path').first().getAttribute('d') === before && await page.locator('#closure-worst-lower').textContent() === '-0.1000', 'Preview changed applied chart/results');
    await tab('质量分析'); await tab('公差反算');
    check(await page.locator('#apply-allocation').isEnabled(), 'Navigation discarded preview');
    await page.locator('#apply-allocation').click();
    check(await page.locator('#closure-worst-lower').textContent() === '-0.0500' && await page.locator('#probability-chart path').first().getAttribute('d') !== before, 'Apply did not refresh charts and limits');
    await tab('组成环与建模'); await tab('公差反算'); await page.locator('#undo-allocation').click();
    check(await page.locator('#closure-worst-lower').textContent() === '-0.1000' && await page.locator('#probability-chart path').first().getAttribute('d') === before, 'Undo did not restore charts and limits');
  });
  await run('25-row desktop pagination preserves last-row editing and complete print across tabs', async () => {
    await page.setViewportSize({ width: 1280, height: 720 }); await paste25();
    check(await page.locator('#component-rows tr').count() === 25, 'Pagination removed model DOM rows');
    for (let i = 0; i < 25 && !await page.locator('[data-field="nominal"]').nth(24).isVisible(); i++) await page.locator('#components-next').click();
    await page.locator('[data-field="nominal"]').nth(24).fill('0.25');
    check(await page.locator('#metric-nominal').textContent() === '0.2500', 'Last page edit excluded from full-chain math');
    check((await page.locator('#chain-range').textContent()).includes('25'), 'Diagram lacks full-chain range label');
    for (const size of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      for (const name of ['组成环与建模', '质量分析', '公差反算']) {
        await tab(name);
        if (name === '公差反算') {
          await page.locator('#preview-allocation').click();
          check(await page.locator('#allocation-rows tr:visible').count() >= 3, 'Default desktop candidate table should show at least three rows');
        }
        await inViewport(['#target-lower', '#target-upper', '#closure-worst-upper', '#save-button', ...(name === '组成环与建模' ? ['#add-row', '#row-settings', '#components-next', '#chain-svg'] : ['#worst-chart', '#probability-chart', ...(name === '质量分析' ? ['#tolerance-slider', '#export-button'] : ['#preview-allocation', '#apply-allocation', '#undo-allocation'])])]);
      }
    }
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    check(await page.locator('#allocation-rows tr').count() === 25, 'Candidate lost off-page rows');
    for (const name of ['组成环与建模', '质量分析', '公差反算']) {
      await tab(name);
      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      await page.emulateMedia({ media: 'print' });
      check(await page.locator('#print-rows tr').count() === 25 && await page.locator('.chain-ring').count() === 25, 'Print lost full-chain rows');
      check(await page.locator('.contribution-row:visible').count() === 25 && await page.locator('#allocation-rows tr:visible').count() === 25, 'Print retained screen pagination');
      check(await page.locator('#quality #worst-chart:visible').count() === 1, 'Print shared charts missing');
      await page.emulateMedia({ media: null }); await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      check(await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected') === 'true' && await page.locator('#apply-allocation').isEnabled(), 'Print changed UI/preview state');
    }
    await tab('组成环与建模');
    await page.locator('#save-button').click();
    check(JSON.parse(await page.locator('#export-text').inputValue()).rows[24].nominal === .25, 'Save lost last row');
    await page.locator('#confirm-saved').click();
  });
  await run('recovery, warnings and off-page validation preserve accessible desktop controls', async () => {
    await paste25();
    await page.locator('#project-name').fill('待恢复'); await page.reload(); await page.evaluate(() => { window.confirm = () => true; });
    await page.locator('#restore-button').click(); await page.reload(); await page.evaluate(() => { window.confirm = () => true; });
    await page.locator('#restore-button').click();
    await page.locator('[data-field="distribution"]').first().selectOption('uniform');
    await page.locator('#project-name').fill('长名称'.repeat(35));
    await page.locator('#precision').selectOption('8');
    await tab('质量分析'); await page.locator('#quality-row-select').selectOption({ label: '环25' }); await tab('组成环与建模');
    const last = page.locator('[data-field="lowerDeviation"]').nth(24);
    await last.fill('');
    check(await last.evaluate(el => el === document.activeElement), 'Invalid edit lost focus');
    await page.locator('#components-prev').click();
    check(!await last.isVisible(), 'Pagination did not hide last row');
    await page.locator('#show-errors').click(); await page.locator('#error-list button').first().click();
    check(await last.isVisible() && await last.evaluate(el => el === document.activeElement), 'Error did not locate off-page field');
    const [pageNow, rest] = (await page.locator('#components-page').textContent()).split(' / ');
    check(pageNow === rest.split(' ')[0], 'Error navigated wrong table page');
    await last.fill('-0.1');
    check(await last.evaluate(el => el === document.activeElement), 'Correction lost focus');
    await page.reload(); await page.evaluate(() => { window.confirm = () => true; });
    check(await page.locator('#recovery-banner').isVisible(), 'Recovery scenario missing');
    await page.locator('[data-field="distribution"]').first().selectOption('uniform');
    await page.locator('[data-field="lowerDeviation"]').first().fill('');
    for (const name of ['组成环与建模', '质量分析', '公差反算']) {
      await tab(name);
      await inViewport(['#recovery-banner', '#validation-errors', '#target-lower', '#target-upper', '#closure-worst-lower', ...(name === '组成环与建模' ? ['#add-row', '#row-settings'] : ['#worst-chart', '#probability-chart', ...(name === '公差反算' ? ['#apply-allocation', '#undo-allocation'] : ['#tolerance-slider', '#show-warnings'])])]);
    }
  });
  await run('allocation candidates fit their panel and navigation retains locked rows and consent', async () => {
    await paste25(); await page.locator('[data-field="locked"]').first().check();
    await page.locator('[data-field="distribution"]').first().selectOption('uniform');
    await tab('质量分析'); await page.locator('#accept-approximation').check();
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    for (let i = 0; i < 3; i++) {
      await page.locator('#candidates-next').click(); await page.locator('#contributions-next').click();
      await tab('组成环与建模'); await page.locator(await page.locator('#components-next').isEnabled() ? '#components-next' : '#components-prev').click();
      await tab('质量分析'); await page.locator('#quality-row-select').selectOption({ label: '环25' }); await tab('公差反算');
    }
    check(await page.locator('#apply-allocation').isEnabled() && await page.locator('#accept-approximation').isChecked(), 'Pure UI changes discarded candidate or consent');
    const rowsFit = await page.locator('.allocation-table-scroll').evaluate(el => [...el.querySelectorAll('tr')].filter(row => row.checkVisibility()).every(row => row.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1));
    check(rowsFit, 'Visible candidate rows exceed their allocated panel');
    await inViewport(['#allocation-check', '#candidates-next', '#apply-allocation', '#undo-allocation', '#worst-chart', '#probability-chart']);
    await page.locator('#apply-allocation').click();
    check(await page.locator('[data-field="upperDeviation"]').first().inputValue() === '0.1', 'Locked row modified');
    await tab('质量分析'); await tab('公差反算'); await page.locator('#undo-allocation').click();
    check(await page.locator('#accept-approximation').isChecked(), 'Undo lost original consent');
    await page.locator('#target-lower').fill('0'); await page.locator('#target-upper').fill('0');
    await page.locator('#preview-allocation').click();
    await inViewport(['#allocation-message', '#apply-allocation', '#undo-allocation', '#worst-chart', '#probability-chart']);
  });
  await run('shared chart zoom survives navigation, pan and resized target drag invalidate only real changes', async () => {
    await tab('质量分析');
    const before = await page.locator('#worst-chart .chart-tick').allTextContents();
    await page.locator('#worst-chart').hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
    const zoomed = await page.locator('#worst-chart .chart-tick').allTextContents();
    check(JSON.stringify(before) !== JSON.stringify(zoomed), 'Chart did not zoom');
    await tab('公差反算'); await tab('质量分析');
    check(JSON.stringify(await page.locator('#worst-chart .chart-tick').allTextContents()) === JSON.stringify(zoomed), 'Reparent reset chart zoom');
    await page.setViewportSize({ width: 1440, height: 900 }); await tab('公差反算');
    await page.locator('#preview-allocation').click();
    const chart = page.locator('#worst-chart'), box = await chart.boundingBox();
    await page.mouse.move(box.x + 25, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 40, box.y + 60); await page.mouse.up();
    check(await page.locator('#apply-allocation').isEnabled(), 'Chart pan discarded preview');
    await page.locator('#reset-worst').click();
    const coords = await chart.evaluate(el => {
      const line = el.querySelector('[data-bound="upper"] line');
      return new DOMPoint(+line.getAttribute('x1'), (+line.getAttribute('y1') + +line.getAttribute('y2')) / 2).matrixTransform(el.getScreenCTM()).toJSON();
    });
    const target = await page.locator('#target-upper').inputValue();
    await page.mouse.move(coords.x, coords.y); await page.mouse.down(); await page.mouse.move(coords.x - 10, coords.y, { steps: 3 }); await page.mouse.up();
    check(await page.locator('#target-upper').inputValue() !== target && await page.locator('#apply-allocation').isDisabled(), 'Resized allocation target drag failed or retained stale preview');
    check(await page.locator('#worst-chart').count() === 1 && await page.locator('#plot-worst').count() === 1, 'Shared charts duplicated IDs');
  });
  await run('printing fits full charts then restores zoom, focus, selected tab and 25-row preview', async () => {
    await paste25(); await tab('公差反算'); await page.locator('#preview-allocation').click();
    const full = await page.locator('#worst-chart .chart-tick').allTextContents();
    await page.locator('#worst-chart').hover(); await page.keyboard.down('Control');
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    const zoomed = await page.locator('#worst-chart .chart-tick').allTextContents();
    check(JSON.stringify(full) !== JSON.stringify(zoomed), 'Print fixture not zoomed');
    await page.locator('#target-lower').focus();
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.emulateMedia({ media: 'print' });
    const printTicks = await page.locator('#worst-chart .chart-tick').allTextContents();
    check(Number(printTicks[0]) <= -3 && printTicks.some(text => Number(text) >= 3), 'Print retained zoom instead of fitting full-chain limits');
    check(await page.locator('.chain-ring').count() === 25 && await page.locator('#allocation-rows tr:visible').count() === 25, 'Printed content truncated');
    await page.emulateMedia({ media: null }); await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    check(JSON.stringify(await page.locator('#worst-chart .chart-tick').allTextContents()) === JSON.stringify(zoomed), 'Print did not restore screen zoom');
    check(await page.locator('#target-lower').evaluate(el => el === document.activeElement) && await page.locator('#allocation').isVisible() && await page.locator('#apply-allocation').isEnabled(), 'Print changed focus/tab/preview');
    for (const name of ['组成环与建模', '质量分析', '公差反算']) {
      await tab(name); const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      check(pdf.length > 20000 && pdf.subarray(0, 4).toString() === '%PDF', 'Missing full print PDF');
      check(await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected') === 'true', 'Native print did not restore selected tab');
    }
  });
  await run('quality row selector changes only selected deviations and both live intervals', async () => {
    await tab('质量分析');
    const before = await page.locator('#probability-chart path').first().getAttribute('d');
    await page.locator('#quality-row-select').selectOption({ label: 'A2' });
    await page.locator('#tolerance-slider').focus(); await page.keyboard.press('Home');
    check(JSON.stringify(await page.locator('.closure-results output').allTextContents()) === '["4.2500","4.7500","4.3342","4.6658"]', 'Selected ring did not update both methods');
    check(await page.locator('#wc-min').textContent() === '4.2500' && await page.locator('#probability-chart path').first().getAttribute('d') !== before, 'Both graphs did not refresh');
    await tab('组成环与建模');
    check(JSON.stringify(await page.locator('[data-field="upperDeviation"]').evaluateAll(els => els.map(el => el.value))) === '["0.05","0","0.05","0.15"]', 'Slider changed nonselected ring');
  });
  await run('small-screen and zoom-equivalent fallback keep all three pages operable', async () => {
    for (const size of [{ width: 390, height: 844 }, { width: 640, height: 360 }]) {
      await page.setViewportSize(size);
      for (const name of ['组成环与建模', '质量分析', '公差反算']) {
        await tab(name);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal document overflow on ${name}`);
        if (name === '组成环与建模') { await page.locator('#row-settings').click(); await page.locator('[data-close="row-dialog"]').click(); }
        if (name === '质量分析') { await page.locator('#tolerance-slider').focus(); await page.keyboard.press('ArrowRight'); }
        if (name === '公差反算') { await page.locator('#preview-allocation').click(); await page.locator('#apply-allocation').click(); await page.locator('#undo-allocation').click(); }
      }
    }
  });
  await run('dragging beyond the right endpoint caps tolerance at 10 and remains reversible', async () => {
    await page.locator('#new-button').click();
    await tab('质量分析');
    const slider = page.locator('#tolerance-slider');
    await slider.focus(); await page.keyboard.press('Home');
    const box = await slider.boundingBox(), y = box.y + box.height / 2;
    await page.mouse.move(box.x + 8, y); await page.mouse.down();
    try {
      await page.mouse.move(box.x + box.width + 20, y, { steps: 10 });
      for (let i = 0; i < 60; i++) await page.mouse.move(box.x + box.width + 20 + i % 2, y);
      check(Number(await page.locator('#tolerance-value').inputValue()).toFixed(4) === '10.0000', 'Continuous right drag did not stop at 10');
      check(await page.locator('[data-field="upperDeviation"]').first().inputValue() === '5' && await page.locator('[data-field="lowerDeviation"]').first().inputValue() === '-5', 'Capped drag did not preserve the midpoint');
      check(await slider.isEnabled() && !await page.locator('#validation-errors').isVisible(), 'Endpoint drag left the model invalid or slider disabled');
      await page.mouse.move(box.x + 8, y, { steps: 10 });
      check(Number(await page.locator('#tolerance-value').inputValue()).toFixed(4) === '0.0000', 'Cannot drag back from the upper endpoint');
    } finally { await page.mouse.up(); }
    await page.locator('#project-name').fill('边界拖动后仍可编辑');
    check(await page.locator('#print-project').textContent() === '边界拖动后仍可编辑 · 版本 A', 'Page no longer responds after endpoint drag');
  });
  await run('unchanged capped slider events preserve allocation preview and fine keyboard adjustment', async () => {
    await page.locator('#new-button').click();
    await page.locator('#target-lower').fill('-0.05'); await page.locator('#target-upper').fill('0.05');
    await tab('质量分析');
    const slider = page.locator('#tolerance-slider');
    await slider.focus(); await page.keyboard.press('End');
    check(Number(await page.locator('#tolerance-value').inputValue()).toFixed(4) === '10.0000', 'Keyboard endpoint does not set a width of 10');
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    check(await page.locator('#apply-allocation').isEnabled(), 'No allocation preview at the capped width');
    await tab('质量分析');
    await slider.evaluate(el => {
      for (const value of ['10', '11', '1000']) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    check(Number(await page.locator('#tolerance-value').inputValue()).toFixed(4) === '10.0000' && await page.locator('#apply-allocation').isEnabled(), 'Unchanged or overshooting events changed tolerance or discarded the valid preview');
    await slider.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('End');
    check(Number(await page.locator('#tolerance-value').inputValue()).toFixed(4) === '10.0000', 'Repeated End presses increased the maximum');
    await page.keyboard.press('ArrowLeft');
    check(Number(await page.locator('#tolerance-value').inputValue()).toFixed(4) === '9.9999' && await page.locator('#apply-allocation').isDisabled(), 'Fine adjustment failed or retained a stale preview');
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    check(Number(await page.locator('#tolerance-value').inputValue()).toFixed(4) === '0.0001', 'Small tolerances cannot be adjusted precisely');
  });
  await run('preexisting widths above 10 remain intact until a bounded slider edit', async () => {
    await page.locator('#paste-button').click();
    await page.locator('#paste-text').fill('大公差环\t10\t+\t80\t-40\n小公差环\t0\t+\t0\t0');
    await page.locator('#import-paste').click();
    const upper = page.locator('[data-field="upperDeviation"]').first(), lower = page.locator('[data-field="lowerDeviation"]').first();
    await page.locator('[data-field="nominal"]').nth(1).focus(); await upper.focus();
    await tab('质量分析');
    const slider = page.locator('#tolerance-slider');
    check(await upper.inputValue() === '80' && await lower.inputValue() === '-40' && Number(await page.locator('#tolerance-value').inputValue()).toFixed(4) === '120.0000', 'Selecting a wide tolerance silently changed entered data');
    check(await slider.isEnabled() && await page.locator('#width-warning').isVisible(), 'Existing tolerance above 10 disables the slider or hides the warning');
    await slider.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('End');
    check(await upper.inputValue() === '25' && await lower.inputValue() === '15', 'Bounded adjustment exceeded 10 or moved the asymmetric midpoint');
    check(await page.locator('#wc-min').textContent() === '25.0000' && await page.locator('#wc-max').textContent() === '35.0000', 'Capped asymmetric limits are not reflected in calculations');
    await page.keyboard.press('Home');
    check(await upper.inputValue() === '20' && await lower.inputValue() === '20', 'Returning to zero width lost the asymmetric midpoint');
  });
  await run('live closure limits follow asymmetric edits without replacing fixed acceptance targets', async () => {
    const limits = page.locator('.closure-results output');
    check(JSON.stringify(await limits.allTextContents()) === '["4.1000","4.9000","4.2764","4.7236"]', 'Live closure limits are missing or not calculated from the sample');
    await page.locator('[data-field="upperDeviation"]').first().fill('0.2');
    check(JSON.stringify(await limits.allTextContents()) === '["3.9500","5.0500","4.2042","4.7958"]', 'Upper deviation did not update both live intervals');
    await page.locator('[data-field="lowerDeviation"]').first().fill('-0.3');
    check(JSON.stringify(await limits.allTextContents()) === '["3.9500","5.1500","4.2183","4.8817"]', 'Asymmetric lower deviation did not update both live intervals');
    check(await page.locator('#target-lower').inputValue() === '4.2' && await page.locator('#target-upper').inputValue() === '4.8', 'Calculated limits overwrote fixed targets');
    check(await page.locator('#worst-status').textContent() === '区间超出规格', 'Moving results falsely passed fixed acceptance requirements');
    await page.locator('#sample-select').selectOption('1');
    check(JSON.stringify(await limits.allTextContents()) === '["-0.5500","0.3500","-0.3062","0.1062"]', 'Replacing the project left stale closure limits or lost the signed nominal');
  });
  await run('live closure limits suppress invalid or unqualified results and honor confidence and display precision', async () => {
    await page.locator('#new-button').click();
    await page.locator('[data-field="nominal"]').first().fill('10');
    const upper = page.locator('[data-field="upperDeviation"]').first();
    const limits = page.locator('.closure-results output');
    await upper.fill('0.3');
    check(JSON.stringify(await limits.allTextContents()) === '["9.7000","10.3000","9.7000","10.3000"]', 'Missing-target project cannot show calculated intervals');
    await upper.fill('');
    check(JSON.stringify(await limits.allTextContents()) === '["—","—","—","—"]', 'Invalid input retains usable live limits');
    await upper.fill('0.3');
    await page.locator('[data-field="distribution"]').first().selectOption('uniform');
    check(JSON.stringify(await limits.allTextContents()) === '["9.7000","10.3000","—","—"]', 'Unqualified non-normal model displays statistical limits');
    await tab('质量分析'); await page.locator('#statistics-mode').selectOption('manual');
    check(JSON.stringify(await limits.allTextContents()) === '["9.7000","10.3000","9.5675","10.4325"]', 'Manual k0 did not update the statistical interval');
    await tab('质量分析'); await page.locator('#statistics-mode').selectOption('preset');
    await tab('质量分析'); await page.locator('#accept-approximation').check();
    await page.locator('#confidence').selectOption('95');
    check(JSON.stringify(await limits.allTextContents()) === '["9.7000","10.3000","9.6586","10.3414"]', 'Confidence change left a stale statistical interval');
    await page.locator('#precision').selectOption('2');
    check(JSON.stringify(await limits.allTextContents()) === '["9.70","10.30","9.66","10.34"]' && await upper.inputValue() === '0.3', 'Display precision alters inputs or fails to format live results');
    await tab('组成环与建模');
    await page.locator('[data-field="lowerDeviation"]').first().fill('0.4');
    check(JSON.stringify(await limits.allTextContents()) === '["—","—","—","—"]', 'Reversed deviations retain live limits');
    await page.locator('[data-field="lowerDeviation"]').first().fill('-0.3');
    check(JSON.stringify(await limits.allTextContents()) === '["9.70","10.30","—","—"]', 'Corrected inputs do not recover or wrongly retain non-normal consent');
  });
  await run('live closure limits follow slider allocation and undo while fixed targets stay unchanged', async () => {
    await page.locator('#new-button').click();
    await page.locator('#target-lower').fill('-0.05');
    await page.locator('#target-upper').fill('0.05');
    const limits = page.locator('.closure-results output');
    await tab('质量分析'); await page.locator('#tolerance-slider').focus();
    await page.keyboard.press('Home');
    check(JSON.stringify(await limits.allTextContents()) === '["0.0000","0.0000","0.0000","0.0000"]', 'Slider zero tolerance is not shown as a deterministic interval');
    await page.keyboard.press('End');
    check(JSON.stringify(await limits.allTextContents()) === '["-5.0000","5.0000","-5.0000","5.0000"]', 'Slider did not update live closure limits');
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    check(JSON.stringify(await limits.allTextContents()) === '["-5.0000","5.0000","-5.0000","5.0000"]', 'Preview silently changed current calculated limits');
    await page.locator('#apply-allocation').click();
    check(JSON.stringify(await limits.allTextContents()) === '["-0.0500","0.0500","-0.0500","0.0500"]', 'Applied allocation did not update live closure limits');
    await page.locator('#undo-allocation').click();
    check(JSON.stringify(await limits.allTextContents()) === '["-5.0000","5.0000","-5.0000","5.0000"]', 'Undo left allocated limits on screen');
    check(await page.locator('#target-lower').inputValue() === '-0.05' && await page.locator('#target-upper').inputValue() === '0.05', 'Slider or allocation overwrote fixed targets');
  });
  await run('direct lower deviation edits update both calculations and survive project round trips', async () => {
    const lower = page.locator('[data-field="lowerDeviation"]').first();
    const upper = page.locator('[data-field="upperDeviation"]').first();
    const symmetric = page.locator('[data-field="symmetric"]').first();
    check(await lower.isEditable(), 'Default sample lower deviation is disabled');
    await page.locator('#new-button').click();
    await page.locator('[data-field="nominal"]').first().fill('10');
    await lower.fill('-0.2');
    check(await lower.evaluate(el => el === document.activeElement), 'Editing lower deviation loses focus');
    check(await upper.inputValue() === '0.1' && !await symmetric.isChecked(), 'Lower edit overwrote upper deviation or retained symmetry');
    check(await page.locator('#wc-min').textContent() === '9.8000' && await page.locator('#wc-max').textContent() === '10.1000', 'Positive-direction WC ignores lower deviation');
    check(await page.locator('#stat-mean').textContent() === '9.9500' && await page.locator('#stat-sigma').textContent() === '0.05000', 'Statistics ignore asymmetric lower deviation');
    check(await page.locator('#metric-statistical').textContent() === '0.3000', 'Statistical tolerance ignores lower deviation');
    await page.locator('[data-field="direction"]').first().selectOption('-1');
    check(await page.locator('#wc-min').textContent() === '-10.1000' && await page.locator('#wc-max').textContent() === '-9.8000', 'Negative-direction WC ignores lower deviation');
    check(await page.locator('#stat-mean').textContent() === '-9.9500', 'Negative-direction mean is stale');
    check((await page.locator('#print-rows tr').first().locator('td').allTextContents())[5] === '-0.2', 'Print report omits edited lower deviation');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#save-button').click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    const saved = JSON.parse(await page.locator('#export-text').inputValue());
    check(saved.rows[0].lowerDeviation === -0.2 && saved.rows[0].upperDeviation === 0.1 && !saved.rows[0].symmetric, 'JSON did not preserve independent lower deviation');
    await page.locator('#confirm-saved').click();
    await page.locator('#new-button').click();
    await page.locator('#project-file').setInputFiles(savedPath);
    await page.waitForFunction(() => document.querySelector('[data-field="lowerDeviation"]').value === '-0.2');
    check(await lower.isEditable() && await page.locator('#stat-mean').textContent() === '-9.9500', 'Reopened lower deviation is locked or not calculated');
    await upper.fill('0.3');
    check(await lower.inputValue() === '-0.2', 'Upper edit silently restores symmetric lower deviation');
  });
  await run('lower deviation validates empty and reversed bounds while preserving explicit symmetry controls', async () => {
    await page.locator('#new-button').click();
    const lower = page.locator('[data-field="lowerDeviation"]').first();
    const upper = page.locator('[data-field="upperDeviation"]').first();
    const symmetric = page.locator('[data-field="symmetric"]').first();
    check(await lower.isEditable(), 'New row lower deviation is disabled');
    await lower.fill('');
    check(await page.locator('#validation-errors').isVisible() && await page.locator('#save-button').isDisabled(), 'Empty lower deviation permits calculation or save');
    check(await page.locator('#metric-worst').textContent() === '—' && await lower.inputValue() === '', 'Empty lower deviation was coerced or stale result remains');
    await lower.fill('0.2');
    check(await page.locator('#validation-errors').isVisible() && await upper.inputValue() === '0.1', 'EI > ES is accepted or upper deviation changed');
    await lower.fill('0');
    check(!await page.locator('#validation-errors').isVisible() && await page.locator('#metric-worst').textContent() === '0.1000', 'Zero lower deviation is not calculated');
    await lower.fill('0.05');
    check(await page.locator('#wc-min').textContent() === '0.0500', 'Valid positive lower deviation rejected');
    await page.evaluate(() => { window.confirm = () => false; });
    await symmetric.click();
    check(!await symmetric.isChecked() && await lower.inputValue() === '0.05', 'Cancelled symmetry conversion overwrites lower deviation');
    await page.evaluate(() => { window.confirm = () => true; });
    await symmetric.check();
    check(await lower.inputValue() === '-0.1' && await lower.isEditable(), 'Explicit symmetry conversion does not normalize or relocks lower deviation');
    await upper.fill('0.2');
    check(await lower.inputValue() === '-0.2' && await symmetric.isChecked(), 'Explicit symmetric upper edit no longer mirrors');
    await lower.fill('-0.2');
    check(await symmetric.isChecked(), 'Reentering the same lower deviation unnecessarily disables symmetry');
    await lower.fill('-0.15');
    check(!await symmetric.isChecked() && await upper.inputValue() === '0.2', 'Independent lower edit did not leave symmetry');
    await page.locator('#add-row').click();
    check(await page.locator('[data-field="lowerDeviation"]').nth(1).isEditable(), 'Added row lower deviation is disabled');
  });
  await run('lower deviation edits invalidate allocation previews and non-normal model consent', async () => {
    await page.locator('[data-field="distribution"]').first().selectOption('uniform');
    await tab('质量分析'); await page.locator('#accept-approximation').check();
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    check(await page.locator('#allocation-preview').isVisible(), 'No allocation preview before edit');
    const lower = page.locator('[data-field="lowerDeviation"]').first();
    check(await lower.isEditable(), 'Lower deviation cannot be changed after preview');
    await tab('组成环与建模'); await lower.fill('-0.1');
    check(!await page.locator('#accept-approximation').isChecked() && await page.locator('#metric-yield').textContent() === '—', 'Lower edit retained non-normal quality consent');
    check(await page.locator('#apply-allocation').isDisabled() && !await page.locator('#allocation-preview').isVisible(), 'Lower edit retained stale allocation preview');
  });
  await run('allocation placeholder stays compact rather than stretching its icon', async () => {
    await tab('公差反算');
    const initial = await page.locator('#allocation-message svg').boundingBox();
    check(initial.width <= 32 && initial.height <= 32, `Oversized initial allocation icon: ${JSON.stringify(initial)}`);
    await tab('组成环与建模'); await page.locator('[data-field="upperDeviation"]').first().fill('0.1');
    await tab('公差反算');
    const updated = await page.locator('#allocation-message > svg').boundingBox();
    check(updated.width <= 32 && updated.height <= 32, `Oversized updated allocation icon: ${JSON.stringify(updated)}`);
  });
  await run('cancelled download preserves unsaved replacement confirmation', async () => {
    await page.locator('#project-name').fill('下载保护回归');
    await page.evaluate(() => { URL.createObjectURL = () => { throw new Error('download blocked'); }; });
    await page.locator('#save-button').click();
    await page.locator('[data-close="export-dialog"]').first().click();
    await page.evaluate(() => { window.confirm = () => false; });
    await page.locator('#new-button').click();
    check(await page.locator('#project-name').inputValue() === '下载保护回归', 'Cancelled download removed unsaved protection');
  });
  await run('pending recovery survives edits and explicit project replacement', async () => {
    await page.locator('#project-name').fill('待恢复的重要项目');
    await page.reload();
    await page.evaluate(() => { window.confirm = () => true; });
    check(await page.locator('#recovery-banner').isVisible(), 'Recovery not offered');
    await page.locator('#project-name').fill('当前草稿');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chainlab-project-v1')).name);
    check(saved === '待恢复的重要项目', 'Pending autosave was overwritten by draft edit');
    await page.locator('#sample-select').selectOption('0');
    check(await page.locator('#recovery-banner').isVisible(), 'Sample selection silently dismissed recovery');
    await page.locator('#restore-button').click();
    check(await page.locator('#project-name').inputValue() === '待恢复的重要项目', 'Original recovery did not restore');
  });
  await run('allocation invalidates non-normal consent and undo restores exact inputs', async () => {
    await page.locator('[data-field="distribution"]').first().selectOption('uniform');
    await tab('质量分析'); await page.locator('#accept-approximation').check();
    const old = await page.locator('[data-field="upperDeviation"]').first().inputValue();
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    await page.locator('#apply-allocation').click();
    check(!await page.locator('#accept-approximation').isChecked(), 'Old consent survived changed tolerances');
    check(await page.locator('#metric-yield').textContent() === '—', 'Unconfirmed non-normal quality was displayed');
    await page.locator('#undo-allocation').click();
    check(await page.locator('[data-field="upperDeviation"]').first().inputValue() === old, 'Undo did not restore inputs');
  });
  await run('chain zoom and highest layer retain every arrow within the canvas', async () => {
    await page.locator('#chain-scale').selectOption('2');
    await page.locator('#row-settings').click();
    await page.locator('#row-layer').fill('24');
    await page.locator('[data-close="row-dialog"]').click();
    await page.locator('#reset-chain').click();
    const bounds = await page.locator('#chain-svg').evaluate(svg => {
      const vb = svg.viewBox.baseVal;
      return [...svg.querySelectorAll('line[marker-end]')].map(line => {
        const matrix = svg.getScreenCTM().inverse().multiply(line.getScreenCTM());
        const a = new DOMPoint(+line.getAttribute('x1'), +line.getAttribute('y1')).matrixTransform(matrix);
        const b = new DOMPoint(+line.getAttribute('x2'), +line.getAttribute('y2')).matrixTransform(matrix);
        return { x1: a.x, x2: b.x, y: a.y, width: vb.width, height: vb.height };
      });
    });
    check(bounds.length > 0 && bounds.every(b => b.x1 >= 0 && b.x2 >= 0 && b.x1 <= b.width && b.x2 <= b.width && b.y < b.height), JSON.stringify(bounds));
    await page.locator('.chain-ring').first().focus(); await page.keyboard.press('Enter');
    check(await page.locator('.chain-ring').first().evaluate(el => el === document.activeElement), 'Diagram selection loses keyboard focus');
    const state = await page.locator('#edit-state').textContent();
    await page.locator('#chain-scale').selectOption('2');
    const drawing = page.locator('#chain-svg > g');
    const before = await drawing.getAttribute('transform'), canvas = await page.locator('#chain-svg').boundingBox();
    await page.mouse.move(canvas.x + 20, canvas.y + 20); await page.mouse.down(); await page.mouse.move(canvas.x + 80, canvas.y + 60); await page.mouse.up();
    check(await drawing.getAttribute('transform') !== before && await page.locator('#edit-state').textContent() === state, 'Chain pan failed or dirtied model');
    await page.locator('#reset-chain').click();
  });
  await run('print states consent explicitly and includes every coefficient and note', async () => {
    await page.locator('[data-field="distribution"]').first().selectOption('rayleigh');
    await page.locator('#row-settings').click();
    await page.locator('#row-note').fill('报告必须保留的备注');
    await page.locator('[data-close="row-dialog"]').click();
    await page.emulateMedia({ media: 'print' });
    try {
      check(await page.locator('#print-inputs').count() === 1, 'Static print input table is missing');
      const report = await page.locator('#print-inputs').innerText();
      check(report.includes('报告必须保留的备注') && report.includes('-0.28') && report.includes('1.14'), report);
      check((await page.locator('#print-model').innerText()).includes('未接受'), 'Missing explicit unaccepted model state');
      check(!await page.locator('#approximation-notice label').isVisible(), 'Print still says I accept without checkbox state');
    } finally { await page.emulateMedia({ media: null }); }
  });
  await run('dragged lower limit cannot exceed a high precision upper limit', async () => {
    await page.locator('#new-button').click();
    await page.locator('#target-lower').fill('0');
    await page.locator('#target-upper').fill('0.1000000000006');
    await tab('质量分析');
    const svg = page.locator('#worst-chart');
    await svg.scrollIntoViewIfNeeded();
    const coords = await svg.evaluate(el => {
      const handle = el.querySelector('[data-bound="lower"] line');
      const ctm = el.getScreenCTM();
      return [new DOMPoint(+handle.getAttribute('x1'), 100).matrixTransform(ctm), new DOMPoint(el.viewBox.baseVal.width - 50, 100).matrixTransform(ctm)].map(p => ({ x:p.x,y:p.y }));
    });
    await page.mouse.move(coords[0].x, coords[0].y); await page.mouse.down();
    await page.mouse.move(coords[1].x, coords[1].y, { steps: 4 }); await page.mouse.up();
    const lower = Number(await page.locator('#target-lower').inputValue());
    const upper = Number(await page.locator('#target-upper').inputValue());
    check(lower <= upper && !await page.locator('#validation-errors').isVisible(), `${lower} > ${upper}`);
  });
  await run('golden path edits, locks, allocates, downloads, reimports and prints', async () => {
    await page.locator('[data-field="upperDeviation"]').first().fill('0.1');
    check(await page.locator('[data-field="lowerDeviation"]').first().inputValue() === '-0.1', 'Symmetric lower deviation is stale');
    check(await page.locator('#metric-worst').textContent() === '0.9000', 'Edited WC width mismatch');
    await page.locator('[data-field="locked"]').nth(0).check();
    await page.locator('[data-field="locked"]').nth(1).check();
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    check(await page.locator('#allocation-preview').isVisible(), 'No preview');
    await page.locator('#apply-allocation').click();
    check(await page.locator('[data-field="upperDeviation"]').nth(0).inputValue() === '0.1', 'Locked ring changed');
    check(await page.locator('#worst-status').textContent() === '区间满足规格', 'Applied allocation failed WC');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#save-button').click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    const saved = await page.locator('#export-text').inputValue();
    check(savedPath && download.suggestedFilename().endsWith('.json'), 'JSON download unavailable');
    await page.locator('#confirm-saved').click();
    await page.locator('#new-button').click();
    await page.locator('#project-file').setInputFiles(savedPath);
    await page.waitForFunction(() => document.getElementById('project-name').value === '轴套定位尺寸分析');
    check(await page.locator('#worst-status').textContent() === '区间满足规格', 'Restored result differs');
    await page.locator('#save-button').click();
    check(await page.locator('#export-text').inputValue() === saved, 'Saved project round trip changed inputs');
    await page.locator('#confirm-saved').click();
    const csvPromise = page.waitForEvent('download'); await tab('质量分析'); await page.locator('#export-button').click();
    const csvDownload = await csvPromise;
    check(csvDownload.suggestedFilename().startsWith('AEME-') && csvDownload.suggestedFilename().endsWith('.csv'), 'AEME CSV download not produced');
    let csv = ''; for await (const chunk of await csvDownload.createReadStream()) csv += chunk.toString('utf8');
    check(csv.includes('"AEME尺寸链计算结果"') && csv.includes('"GB/T 5847—2004"'), 'CSV report branding or basis missing');
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    check(pdf.length > 20000 && pdf.subarray(0, 4).toString() === '%PDF', 'Printed report is empty');
  });
  await run('invalid edits suppress stale results and recover without losing text', async () => {
    const upper = page.locator('[data-field="upperDeviation"]').first();
    await upper.fill('');
    check(await page.locator('#metric-worst').textContent() === '—' && await page.locator('#save-button').isDisabled(), 'Invalid input shows usable stale output');
    check(await upper.inputValue() === '', 'Empty tolerance coerced to zero');
    await upper.fill('0.05');
    await page.locator('[data-field="symmetric"]').first().uncheck();
    await page.locator('[data-field="lowerDeviation"]').first().fill('0.2');
    check(await page.locator('#validation-errors').isVisible(), 'ES<EI was accepted');
    await page.locator('[data-field="lowerDeviation"]').first().fill('-0.05');
    check(!await page.locator('#validation-errors').isVisible(), 'Valid correction remains invalid');
    await tab('公差反算'); await page.locator('#preview-allocation').click();
    await page.locator('#target-upper').fill('4.7');
    check(await page.locator('#apply-allocation').isDisabled() && !await page.locator('#allocation-preview').isVisible(), 'Stale preview survives edited target');
    await page.locator('#target-lower').fill('5');
    check(await page.locator('#preview-allocation').isDisabled(), 'Reversed target permits allocation');
  });
  await run('non-normal eligibility requires explicit consent and rechecks model edits', async () => {
    await page.locator('[data-field="distribution"]').first().selectOption('skewExternal');
    check(await page.locator('#metric-statistical').textContent() === '—' && await page.locator('#metric-yield').textContent() === '—', 'Unqualified non-normal model was used');
    await tab('质量分析'); await page.locator('#statistics-mode').selectOption('manual');
    check(await page.locator('#metric-statistical').textContent() !== '—' && await page.locator('#metric-yield').textContent() === '—', 'Manual k0 bypassed quality consent');
    await tab('质量分析'); await page.locator('#accept-approximation').check();
    check(await page.locator('#metric-yield').textContent() !== '—', 'Explicit consent did not enable estimates');
    await tab('组成环与建模'); await page.locator('[data-field="nominal"]').first().fill('2');
    check(!await page.locator('#accept-approximation').isChecked() && await page.locator('#metric-yield').textContent() === '—', 'Model edit retained consent');
  });
  await run('TSV samples, malformed files, zero dimensions and empty rows', async () => {
    await page.locator('#sample-select').selectOption('0');
    check(await page.locator('#wc-min').textContent() === '0.1000' && await page.locator('#wc-max').textContent() === '0.4500', 'Sample1 mismatch');
    await page.locator('#sample-select').selectOption('1');
    check(await page.locator('#metric-nominal').textContent() === '-0.1000', 'Signed Sample2 mismatch');
    await page.locator('#project-file').evaluate(input => {
      const transfer = new DataTransfer(); transfer.items.add(new File(['{bad'], '损坏.json', { type: 'application/json' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('JSON'));
    check(await page.locator('#metric-nominal').textContent() === '-0.1000', 'Broken import overwrote current project');
    await page.locator('#project-file').setInputFiles([]);
    await page.locator('#paste-button').click();
    await page.locator('#paste-text').fill('固定环\t0\t+\t0\t0');
    await page.locator('#import-paste').click();
    await page.locator('#target-lower').fill('0'); await page.locator('#target-upper').fill('0');
    check(await page.locator('#metric-yield').textContent() === '100.0000' && await page.locator('#quality-cp').textContent() === '—', 'Zero sigma handling mismatch');
    await page.locator('.delete-row').click();
    check(await page.locator('#validation-errors').isVisible() && await page.locator('#save-button').isDisabled(), 'Empty chain not rejected');
    await page.locator('#add-row').click();
    check(!await page.locator('#validation-errors').isVisible(), 'Cannot recover from empty chain');
  });
  await run('zero-budget allocation warns about manufacturing before applying zero tolerance', async () => {
    await page.locator('#new-button').click();
    await page.locator('#target-lower').fill('0'); await page.locator('#target-upper').fill('0');
    for (const method of ['worst', 'statistical']) {
      await tab('公差反算'); await page.locator('#allocation-method').selectOption(method);
      await tab('公差反算'); await page.locator('#preview-allocation').click();
      check((await page.locator('#allocation-message').innerText()).includes('零公差'), 'Zero allocation has no manufacturing warning');
      await page.locator('#apply-allocation').click();
      check(await page.locator('[data-field="upperDeviation"]').first().inputValue() === '0', 'Zero allocation not applied');
      check(await page.locator('#metric-yield').textContent() === '100.0000', 'Deterministic allocated result mismatch');
      await page.locator('#undo-allocation').click();
      check(await page.locator('[data-field="upperDeviation"]').first().inputValue() === '0.1', 'Zero allocation undo lost input');
    }
  });
  await run('contribution selection, tolerance slider and chart keyboard zoom work', async () => {
    await tab('公差反算'); await page.locator('.contribution-row').first().click();
    check(await page.locator('#selected-row-name').textContent() === 'A2', 'Contribution selection is not linked');
    check(await page.locator('.contribution-row.selected').evaluate(el => el === document.activeElement), 'Contribution selection loses keyboard focus');
    const nominal = await page.locator('#metric-nominal').textContent();
    await tab('质量分析'); await page.locator('#tolerance-slider').focus(); await page.keyboard.press('ArrowRight');
    const upper = Number(await page.locator('[data-field="upperDeviation"]').nth(1).inputValue());
    const lower = Number(await page.locator('[data-field="lowerDeviation"]').nth(1).inputValue());
    check(upper > .15 && upper === -lower && await page.locator('#metric-nominal').textContent() === nominal, 'Slider did not preserve center/nominal');
    const handle = page.locator('#worst-chart [data-bound="lower"]');
    await handle.focus(); const old = Number(await page.locator('#target-lower').inputValue());
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    check(Number(await page.locator('#target-lower').inputValue()) > old, 'Keyboard target control failed');
    const ticks = await page.locator('#worst-chart .chart-tick').allTextContents();
    await page.locator('#worst-chart').hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
    check(JSON.stringify(await page.locator('#worst-chart .chart-tick').allTextContents()) !== JSON.stringify(ticks), 'Chart zoom did not update axis');
    await page.locator('#reset-worst').click();
    check(JSON.stringify(await page.locator('#worst-chart .chart-tick').allTextContents()) === JSON.stringify(ticks), 'Chart reset mismatch');
  });
  await run('25 rows fit narrow screen and retain complete print inputs', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#paste-button').click();
    await page.locator('#paste-text').fill(Array.from({ length: 25 }, (_, i) => `环${i+1}\t${i % 2}\t${i % 2 ? '-' : '+'}\t0.1\t-0.1`).join('\n'));
    await page.locator('#import-paste').click();
    check(await page.locator('#component-rows tr').count() === 25 && await page.locator('#add-row').isDisabled(), '25-row limit failed');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflows horizontally');
    await page.setViewportSize({ width: 1440, height: 1040 });
    await page.emulateMedia({ media: 'print' });
    try {
      check(await page.locator('#print-rows tr').count() === 25, 'Print lost rows');
      check((await page.locator('.diagram-panel').boundingBox()).height < 650, 'Long chain diagram exceeds the printable page height');
      check((await page.locator('.contribution-panel').boundingBox()).height < 600, 'Contribution list creates avoidable overflow pages');
    } finally { await page.emulateMedia({ media: null }); }
  });
  page.off('pageerror', onError); page.off('console', onConsole); page.off('request', onRequest);
  return { browser: page.context().browser().version(), url, results, errors, externalRequests };
}
