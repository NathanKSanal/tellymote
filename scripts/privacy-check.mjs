import fs from 'node:fs';
import path from 'node:path';

/**
 * Fails the build if machine-specific data leaks into the files that ship in the
 * installer. It scans the built renderer/main bundles plus package.json; run it
 * after `npm run build`.
 *
 * Patterns are deliberately generic. Do not put this developer's real IP, MAC,
 * device identifiers or email in this file: the repository is public and the
 * deny list would itself become the leak.
 */
const DENY = [
  { label: 'local Windows user path', re: /\b[A-Za-z]:\\Users\\[^\\\s"']+/g },
  // 192.168.0.42 is the documented placeholder, 192.168.0.0 the example subnet.
  { label: 'private LAN address', re: /\b192\.168\.(?!0\.(?:0|42)\b)\d{1,3}\.\d{1,3}\b/g },
  {
    label: 'MAC address',
    re: /\b(?!00(?:[:-]00){5}\b)(?!ff(?:[:-]ff){5}\b)(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi,
  },
  {
    label: 'personal email address',
    re: /\b[A-Za-z0-9._%+-]+@(?:gmail|googlemail|outlook|hotmail|live|yahoo)\.com\b/gi,
  },
];

const roots = ['dist', 'dist-electron', 'build'];
const files = ['package.json'];

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
}

for (const root of roots) walk(root);

const findings = [];
for (const file of files) {
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch {
    continue;
  }
  if (buffer.length > 8 * 1024 * 1024) continue;
  if (buffer.includes(0)) continue; // binary asset
  const text = buffer.toString('utf8');
  for (const rule of DENY) {
    rule.re.lastIndex = 0;
    if (rule.re.test(text)) findings.push(`${file}: ${rule.label}`);
  }
}

if (findings.length > 0) {
  console.error('Privacy check failed. Shipped files contain machine-specific data:');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(`Privacy check passed: ${files.length} shipped files contain no machine-specific data.`);
