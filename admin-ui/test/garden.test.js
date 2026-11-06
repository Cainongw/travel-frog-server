import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecipeParcel, furnitureLabel } from '../src/garden.js';

const recipe = {
  paper_item_id: 300,
  material: [{ item_id: 100, count: 3 }, { item_id: 110, count: 1 }],
  tool: [200, 201, 202],
};

test('a missing alternative tool adds only the first kind to a recipe parcel', () => {
  const parcel = buildRecipeParcel(recipe);
  assert.deepEqual(parcel, [
    { item_id: 100, count: 3 }, { item_id: 110, count: 1 },
    { item_id: 300, count: 1 }, { item_id: 200, count: 1 },
  ]);
  assert.equal(parcel.some(item => item.item_id === 201 || item.item_id === 202), false);
});

test('any already owned alternative tool satisfies the tool requirement', () => {
  const parcel = buildRecipeParcel(recipe, [{ item_id: 201, count: 1 }, { item_id: 300, count: 1 }]);
  assert.deepEqual(parcel, [{ item_id: 100, count: 3 }, { item_id: 110, count: 1 }]);
  const fromBench = buildRecipeParcel(recipe, [{ item_id: 300, count: 1 }], [202, -1, -1, -1, -1]);
  assert.deepEqual(fromBench, parcel);
});

test('special material on the workbench is not gifted again and partial stock is deducted', () => {
  const inventory = [{ item_id: 100, count: 2 }, { item_id: 300, count: 1 }];
  const bench = [200, -1, -1, -1, -1, 110, -1, -1, -1, -1];
  assert.deepEqual(buildRecipeParcel(recipe, inventory, bench), [{ item_id: 100, count: 1 }]);
  assert.deepEqual(buildRecipeParcel(recipe, [...inventory, { item_id: 100, count: 1 }], bench), []);
});

test('the full furniture catalog resolves default furniture and takes priority over recipes', () => {
  const catalog = { allFurniture: [{ id: 1, name: '原有小桌' }], furniture: [{ id: 1, name: '配方名' }, { id: 2, name: '新家具' }] };
  assert.equal(furnitureLabel(catalog, 1), '原有小桌');
  assert.equal(furnitureLabel(catalog, 2), '新家具');
  assert.equal(furnitureLabel(catalog, 3), '家具 #3');
});
