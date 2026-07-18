import fs from 'fs';
import path from 'path';
import { OCCASION_PROFILES } from '../styling-engine/occasions.js';


const forbiddenPatterns = [
  /best color/i,
  /favorite color/i,
  /signature color/i,
  /Yuna's style filter/i,
  /YUNA'S AESTHETIC/i,
  /not (your|Yuna's) style/i
];

function checkFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // The ratified constitution text is the ONE sanctioned home for style-claim phrases.
  // Spec 32 moved it out of prompts.js constants: the legacy (owner) text lives in
  // constitutionSeed.js (skipped whole — it is the constitution, verbatim) and the
  // generic starter layers live in prompts.js's DEFAULT_CONSTITUTION (stripped here).
  if (filePath.endsWith('constitutionSeed.js')) return [];
  if (filePath.endsWith('prompts.js')) {
    content = content.replace(/export const DEFAULT_CONSTITUTION = \{[\s\S]+?\n\}/, '');
  }

  const lines = content.split('\n');
  let failures = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(line)) {
        failures.push({
          lineNum: i + 1,
          pattern: pattern.toString(),
          text: line.trim()
        });
      }
    }
  }

  return failures;
}

function scanDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath, fileList);
    } else if (stat.isFile() && (file.endsWith('.js') || file.endsWith('.ts'))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const targetDirs = ['styling-engine', 'routes'];
let totalFailures = 0;

for (const dirName of targetDirs) {
  const dirPath = path.join(process.cwd(), dirName);
  if (!fs.existsSync(dirPath)) continue;

  const files = scanDir(dirPath);
  for (const file of files) {
    const failures = checkFile(file);
    if (failures.length > 0) {
      console.error(`\n❌ Forbidden style claims found in: ${path.relative(process.cwd(), file)}`);
      for (const fail of failures) {
        console.error(`   Line ${fail.lineNum}: Matches ${fail.pattern}`);
        console.error(`   Code: ${fail.text}`);
      }
      totalFailures += failures.length;
    }
  }
}

// Scan styling-engine/occasions.js for unratified prohibited entries
const occasionsPath = path.join(process.cwd(), 'styling-engine/occasions.js');
if (fs.existsSync(occasionsPath)) {
  const content = fs.readFileSync(occasionsPath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('prohibited_pieces') || line.includes('prohibited_footwear')) {
      const match = /\b(dress(?!\s+shoes?)|dresses(?!\s+shoes?)|skirt|skirts|blouse|blouses|sandal|sandals|mule|mules)\b/i.test(line);
      const isRatified = line.includes('// ratified:');
      if (match && !isRatified) {
        console.error(`\n❌ Unratified prohibited occasion entry found in: styling-engine/occasions.js`);
        console.error(`   Line ${i + 1}: prohibited entry for dress/skirt/blouse/sandal/mule categories without // ratified: comment`);
        console.error(`   Code: ${line.trim()}`);
        totalFailures++;
      }
    }
  }
}

// Scan for forbidden occasion profiles (occasions.js freeze guard)
const ALLOWED_OCCASION_IDS = [
  'outdoor_active',
  'outdoor_daytime_social',
  'city_smart_casual',
  'casual',
  'evening_social',
  'gallery_art_event',
  'concert',
  'home_loungewear'
];
for (const profile of OCCASION_PROFILES) {
  if (!ALLOWED_OCCASION_IDS.includes(profile.id)) {
    console.error(`\n❌ Forbidden occasion profile found: ${profile.id}`);
    console.error(`   No new profiles may be added to occasions.js since it is frozen.`);
    totalFailures++;
  }
}

if (totalFailures > 0) {
  console.error(`\nScan failed. Found ${totalFailures} unratified style claim(s).`);
  process.exit(1);
} else {
  console.log('✅ Style claims check passed. All prompts align with the ratified Style Constitution.');
  process.exit(0);
}
