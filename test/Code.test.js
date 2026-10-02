const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const context = vm.createContext({ Logger: { log() {} } });
vm.runInContext(fs.readFileSync('src/Code.gs', 'utf8'), context);

function recipeTab(tabId, title, content, childTabs) {
  return { tabProperties: { tabId, title }, documentTab: { body: { content } }, childTabs: childTabs || [] };
}

test('catalog returns stable tab IDs for leaf recipe tabs and excludes the contents and category tabs', () => {
  const child = recipeTab('tab.recipe', 'Sauce', [{ paragraph: {} }, { sectionBreak: {} }, { paragraph: {} }]);
  const tabs = [
    recipeTab('tab.toc', 'Table of Recipes', [{ paragraph: {} }, { sectionBreak: {} }]),
    recipeTab('tab.folder', 'Dinner', [], [child]),
    child,
    recipeTab('tab.notes', 'Notes', [{ paragraph: {} }]),
  ];
  const catalog = context.getFamilyAppRecipeCatalogFromTabs_({ revisionId: 'rev-1' }, tabs);
  assert.deepEqual(JSON.parse(JSON.stringify(catalog.map(({ recipeKey, title, sourceRevision }) => ({ recipeKey, title, sourceRevision })))), [
    { recipeKey: 'tab.recipe', title: 'Sauce', sourceRevision: 'rev-1' },
  ]);
});

test('Family App stable keys resolve to the existing parser recipe title', () => {
  const tab = recipeTab('immutable-tab-id', 'Renamed Curry', [{ paragraph: {} }, { sectionBreak: {} }]);
  const resolved = context.resolveFamilyAppRecipeKeys_({}, [tab], ['immutable-tab-id']);
  assert.equal(resolved[0].title, 'Renamed Curry');
  assert.equal(context.resolveFamilyAppRecipeKeys_({}, [tab], ['old-title'])[0], undefined);
});

test('Family App parsing follows the selected immutable tab when recipe titles collide', () => {
  const content = (ingredient) => [
    { paragraph: {} }, { sectionBreak: {} },
    { paragraph: { bullet: {}, elements: [{ textRun: { content: ingredient } }] } },
    { sectionBreak: {} },
  ];
  const first = recipeTab('tab-old', 'Same Title', content('1 cup rice'));
  const renamed = recipeTab('tab-selected', 'Same Title', content('2 cups beans'));
  const result = context.getIngredientsForRecipeTab_([first, renamed], renamed);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), ['2 cups beans']);
});

test('existing parser recursively expands sub-recipes and grouping retains protein quantities and keep items', () => {
  const content = (ingredients) => [
    { paragraph: { elements: [{ textRun: { content: 'Recipe title' } }] } },
    { sectionBreak: {} },
    ...ingredients.map((text) => ({ paragraph: { bullet: {}, elements: [{ textRun: { content: text } }] } })),
    { sectionBreak: {} },
  ];
  const tabs = [
    recipeTab('main', 'Dinner', content(['1 cup rice', 'Use Garlic Sauce'])),
    recipeTab('sauce', 'Garlic Sauce', content(['2 cloves garlic', '1 lb chicken breast'])),
  ];
  const expanded = context.getIngredientsForRecipe(tabs, 'Dinner');
  const grouped = context.groupIngredients(expanded.concat(['3 cups rice', '2 eggs']), ['Rice', 'Paper Towels']);
  const displays = grouped.map((item) => item.display);
  assert.ok(displays.includes('Rice'));
  assert.ok(displays.includes('Garlic'));
  assert.ok(displays.some((name) => name.toLowerCase().includes('chicken breast')));
  assert.ok(displays.includes('Paper Towels'));
  assert.ok(grouped.find((item) => item.display === 'Rice').count >= 2);
});

test('legacy bold recipe selection continues to read bold table entries', () => {
  const boldParagraph = { elements: [{ textRun: { content: 'Dinner', textStyle: { bold: true } } }] };
  const tableParagraph = { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: boldParagraph }] }] }] } };
  const toc = recipeTab('toc', 'Table of Recipes', [tableParagraph]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getSelectedRecipeTitles([toc]))), ['Dinner']);
});
