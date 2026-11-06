export function furnitureLabel(catalog, id) {
  return catalog.allFurniture?.find(item => item.id === id)?.name
    || catalog.furniture?.find(item => item.id === id)?.name
    || `家具 #${id}`;
}

// A recipe lists alternative tools: owning any one of them is sufficient.
// The parcel fills inventory/workbench shortages instead of gifting a full kit.
export function buildRecipeParcel(recipe, inventory = [], bench = []) {
  if (!recipe) return [];
  const owned = new Map();
  for (const item of inventory) owned.set(item.item_id, (owned.get(item.item_id) || 0) + item.count);
  for (const id of bench) if (id >= 0) owned.set(id, (owned.get(id) || 0) + 1);

  const needed = new Map();
  const add = (id, count) => {
    if (Number.isSafeInteger(id) && id >= 0 && Number.isSafeInteger(count) && count > 0) {
      needed.set(id, (needed.get(id) || 0) + count);
    }
  };
  for (const item of recipe.material || []) add(item.item_id, item.count);
  add(recipe.paper_item_id, 1);
  const alternatives = recipe.tool || [];
  if (alternatives.length && !alternatives.some(id => (owned.get(id) || 0) > 0)) add(alternatives[0], 1);

  return [...needed].map(([item_id, count]) => ({
    item_id,
    count: Math.max(0, count - (owned.get(item_id) || 0)),
  })).filter(item => item.count > 0);
}
