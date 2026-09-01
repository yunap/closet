#!/usr/bin/env node
// Blast radius of the 2026-09-01 mesh footwear ruling, over the real wardrobe. Read-only.
//   node scratch/audit_mesh_footwear_supply.mjs
const ROOT='/Users/yuna/Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist'
const D=(await import('better-sqlite3')).default
const { pieceHasVentilatedFootwearMaterial, pieceHasWetSensitiveFootwearMaterial } = await import(ROOT+'/styling-engine/attributes.js')
const db=new D(ROOT+'/wardrobe.db',{readonly:true,fileMustExist:true})
const shoes=db.prepare("SELECT * FROM pieces WHERE status='active' AND lower(category)='shoes'").all()
  .map(r=>({...r, fiber_content: JSON.parse(r.fiber_content||'[]')}))
const wet=shoes.filter(pieceHasWetSensitiveFootwearMaterial)
const vent=shoes.filter(pieceHasVentilatedFootwearMaterial)
const openToe=shoes.filter(s=>s.toe_shape==='open_toe'||s.shoe_type==='sandal')
console.log(`active shoes: ${shoes.length}`)
console.log(`excluded on WET exposure:   ${wet.length}  (remaining ${shoes.length-wet.length})`)
console.log(`excluded on SEVERE cold:    ${new Set([...vent,...openToe]).size}  (remaining ${shoes.length-new Set([...vent,...openToe]).size})`)
console.log(`  of which newly by mesh:   ${vent.length}`)
const show=(t,rs)=>{console.log('\n'+t);for(const s of rs)console.log(`  ${String(s.id).padEnd(7)}${String(s.name).slice(0,40).padEnd(42)}${String(s.shoe_type||'-').padEnd(10)}fab=${String(s.fabric_category||'-').padEnd(10)}support=${s.walk_support||'-'}`)}
show('newly excluded (mesh):', vent)
show('high walk-support survivors on a severe-cold day:', shoes.filter(s=>s.walk_support==='high'&&!vent.includes(s)&&!openToe.includes(s)))
