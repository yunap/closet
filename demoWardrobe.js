// The demo wardrobe — the app's original 62 sample pieces, now OPT-IN (owner ruling
// 2026-07-19: fresh instances start EMPTY; the demo is an alternative to importing,
// offered on the import screen and in Settings, and fully removable). Pieces are
// marked is_demo=1 so removal targets exactly what loading created.
export const DEMO_WARDROBE_PIECES = [
      // Tops
      { name: 'Whale stripe tee',        category: 'top',       colors: '["navy","white"]',      occasions: '["casual"]',                         season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black sleeveless tank',   category: 'top',       colors: '["black"]',             occasions: '["casual","city"]',                  season: 'warm',       notes: 'Replace with better quality version',          status: 'active' },
      { name: 'Daisy print tee',         category: 'top',       colors: '["white","yellow"]',    occasions: '["casual"]',                         season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Orange ribbed tank',      category: 'top',       colors: '["orange"]',            occasions: '["casual","home"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Botanical wrap top',      category: 'top',       colors: '["green","cream"]',     occasions: '["casual","smart-casual"]',           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Black blouse',            category: 'top',       colors: '["black"]',             occasions: '["city","evening"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Navy pinstripe shirt',    category: 'top',       colors: '["navy"]',              occasions: '["city","smart-casual"]',            season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Floral blouse',           category: 'top',       colors: '["multi"]',             occasions: '["city","smart-casual"]',            season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Striped button-down',     category: 'top',       colors: '["navy","white"]',      occasions: '["city"]',                           season: 'year-round', notes: 'Wear open as a layer over navy top',           status: 'active' },
      { name: 'Navy top',                category: 'top',       colors: '["navy"]',              occasions: '["city","casual"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black button-detail top', category: 'top',       colors: '["black"]',             occasions: '["evening","city"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Cashmere tee',            category: 'top',       colors: '["grey"]',              occasions: '["smart-casual","casual"]',          season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Fitted Breton tee',       category: 'top',       colors: '["navy","white"]',      occasions: '["smart-casual","casual"]',          season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black tank',              category: 'top',       colors: '["black"]',             occasions: '["outdoor","casual","home"]',        season: 'warm',       notes: 'Base layer',                                   status: 'active' },
      { name: 'Navy graphic tee',        category: 'top',       colors: '["navy"]',              occasions: '["home","casual"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Plum cap-sleeve top',     category: 'top',       colors: '["plum"]',              occasions: '["home","casual"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      // Bottoms
      { name: 'Dark jeans',              category: 'bottom',    colors: '["dark blue"]',         occasions: '["casual","city","evening","smart-casual"]', season: 'year-round', notes: '',                                    status: 'active' },
      { name: 'Orange pink floral mini skirt', category: 'bottom', colors: '["orange","pink"]', occasions: '["casual"]',                         season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Emerald green pants',     category: 'bottom',    colors: '["green"]',             occasions: '["casual"]',                         season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Cream wide-leg pants',    category: 'bottom',    colors: '["cream"]',             occasions: '["casual","city"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Mustard corduroy skinnies', category: 'bottom', colors: '["mustard"]',            occasions: '["casual","smart-casual"]',          season: 'cool',       notes: 'Zipper needs repair',                          status: 'needs-repair' },
      { name: 'Cream cropped wide-leg pants', category: 'bottom', colors: '["cream"]',           occasions: '["city"]',                           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Dark wide-leg pants',     category: 'bottom',    colors: '["dark grey"]',         occasions: '["city","smart-casual","evening"]',  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Cream knit skirt',        category: 'bottom',    colors: '["cream"]',             occasions: '["city"]',                           season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Light grey denim',        category: 'bottom',    colors: '["light grey"]',        occasions: '["evening","casual"]',               season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Grey lace-waist pants',   category: 'bottom',    colors: '["grey"]',              occasions: '["smart-casual"]',                   season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Brown-cream midi skirt',  category: 'bottom',    colors: '["brown","cream"]',     occasions: '["smart-casual"]',                   season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Dark fuller pants',       category: 'bottom',    colors: '["dark grey"]',         occasions: '["outdoor","casual"]',               season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Dark leggings',           category: 'bottom',    colors: '["black"]',             occasions: '["outdoor","home"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'White terry pants',       category: 'bottom',    colors: '["white"]',             occasions: '["home"]',                           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Floral leggings',         category: 'bottom',    colors: '["multi"]',             occasions: '["home"]',                           season: 'year-round', notes: '',                                             status: 'active' },
      // Dresses
      { name: 'Plum dress',              category: 'dress',     colors: '["plum"]',              occasions: '["evening"]',                        season: 'year-round', notes: 'Versatile — styles up or down easily',         status: 'active' },
      { name: 'Green maxi dress',        category: 'dress',     colors: '["green"]',             occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Charcoal ruched dress',   category: 'dress',     colors: '["charcoal"]',          occasions: '["city","evening"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      // Outerwear
      { name: 'Grey vest',               category: 'outerwear', colors: '["grey"]',              occasions: '["casual","smart-casual"]',          season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Leather jacket',          category: 'outerwear', colors: '["black"]',             occasions: '["evening","casual"]',               season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Oatmeal cardigan',        category: 'outerwear', colors: '["oatmeal"]',           occasions: '["evening","casual","city"]',        season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Tweed vest',              category: 'outerwear', colors: '["brown","cream"]',     occasions: '["smart-casual"]',                   season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Plum hoodie',             category: 'outerwear', colors: '["plum"]',              occasions: '["outdoor"]',                        season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Olive hoodie',            category: 'outerwear', colors: '["olive"]',             occasions: '["outdoor","casual"]',               season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Cream cardigan',          category: 'outerwear', colors: '["cream"]',             occasions: '["city","evening","casual"]',        season: 'cool',       notes: '',                                             status: 'active' },
      // Shoes
      { name: 'White sneakers',          category: 'shoes',     colors: '["white"]',             occasions: '["casual","smart-casual"]',          season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black sandals',           category: 'shoes',     colors: '["black"]',             occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Brown ankle boots',       category: 'shoes',     colors: '["brown"]',             occasions: '["casual","smart-casual","city","evening"]', season: 'cool', notes: '',                                          status: 'active' },
      { name: 'Black mules',             category: 'shoes',     colors: '["black"]',             occasions: '["city","evening"]',                 season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Black flats',             category: 'shoes',     colors: '["black"]',             occasions: '["city","smart-casual","evening"]',  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Tan ankle boots',         category: 'shoes',     colors: '["tan"]',               occasions: '["evening","smart-casual","city"]',  season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Navy slip-ons',           category: 'shoes',     colors: '["navy"]',              occasions: '["smart-casual","casual"]',          season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Flat sandals',            category: 'shoes',     colors: '["brown"]',             occasions: '["smart-casual","casual"]',          season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Hiking boots',            category: 'shoes',     colors: '["brown"]',             occasions: '["outdoor"]',                        season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Flip-flops',              category: 'shoes',     colors: '["tan"]',               occasions: '["home"]',                           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Platform sandals',        category: 'shoes',     colors: '["tan"]',               occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Grey pointed flats',      category: 'shoes',     colors: '["grey"]',              occasions: '["city","evening"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Taupe sneakers',          category: 'shoes',     colors: '["tan"]',               occasions: '["home","casual"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      // Accessories
      { name: 'Red/orange crossbody bag',   category: 'accessory', colors: '["red","orange"]',  occasions: '["casual","city"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Amber pendant necklace',     category: 'accessory', colors: '["amber"]',          occasions: '["city","evening","smart-casual"]',  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Green beaded necklace',      category: 'accessory', colors: '["green"]',          occasions: '["evening","city"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Turquoise pendant',          category: 'accessory', colors: '["turquoise"]',      occasions: '["casual","city"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Colorful loop scarf',        category: 'accessory', colors: '["multi"]',          occasions: '["casual","city","evening"]',        season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Brown leather belt',         category: 'accessory', colors: '["brown"]',          occasions: '["smart-casual","city"]',            season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Woven/rattan crossbody bag', category: 'accessory', colors: '["tan","brown"]',    occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Green bucket hat',           category: 'accessory', colors: '["green"]',          occasions: '["outdoor"]',                        season: 'warm',       notes: '',                                             status: 'active' },
]

export function seedDemoWardrobe(db) {
  const ins = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, is_demo)
    VALUES (@name, @category, @colors, @occasions, @season, @notes, @status, 1)
  `)
  db.transaction(() => { DEMO_WARDROBE_PIECES.forEach(p => ins.run(p)) })()
  return DEMO_WARDROBE_PIECES.length
}

export function demoWardrobeCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM pieces WHERE is_demo = 1').get().n
}

export function removeDemoWardrobe(db) {
  const info = db.prepare('DELETE FROM pieces WHERE is_demo = 1').run()
  return info.changes
}
