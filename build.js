const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

const STATIC_FILES = ['index.html', 'logo.webp', 'photo.jpeg'];
const CSS_FILES = ['style.css'];
const JS_FILES = ['firebase.js', 'firebase-config.js', 'script.js', 'firebase-client.js'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Safe CSS minification ──
function minifyCSS(code) {
  const calcs = [];
  code = code.replace(/calc\([^)]+\)/g, m => { calcs.push(m); return '__CALC' + (calcs.length - 1) + '__'; });
  code = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s+/g, ' ')
    .replace(/\s*([>~+])\s*/g, '$1')
    .trim();
  code = code.replace(/__CALC(\d+)__/g, (_, i) => calcs[parseInt(i)]);
  return code;
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, dest);
  const bytes = fs.statSync(src).size;
  console.log('  \u2713 ' + path.basename(src) + ' (' + (bytes / 1024).toFixed(1) + ' KB)');
}

function getDirSize(dir) {
  let total = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, f.name);
    if (f.isFile()) total += fs.statSync(fp).size;
    else if (f.isDirectory()) total += getDirSize(fp);
  }
  return total;
}

function build() {
  console.log('\n  Quemahtech Build\n');

  ensureDir(DIST);

  // Minify CSS
  for (const cssFile of CSS_FILES) {
    const srcPath = path.join(ROOT, cssFile);
    if (fs.existsSync(srcPath)) {
      const css = fs.readFileSync(srcPath, 'utf8');
      const minified = minifyCSS(css);
      fs.writeFileSync(path.join(DIST, cssFile), minified);
      const saved = ((1 - minified.length / css.length) * 100).toFixed(1);
      console.log('  \u2713 ' + cssFile + ': ' + (css.length / 1024).toFixed(1) + ' KB \u2192 ' + (minified.length / 1024).toFixed(1) + ' KB (' + saved + '%)');
    }
  }

  // Copy JS files as-is (minification was corrupting template literals and if statements)
  for (const jsFile of JS_FILES) {
    copyFile(path.join(ROOT, jsFile), path.join(DIST, jsFile));
  }

  console.log('\n  Copying files...');
  for (const file of STATIC_FILES) {
    copyFile(path.join(ROOT, file), path.join(DIST, file));
  }

  // Add .nojekyll for GitHub Pages compatibility
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  console.log('  \u2713 .nojekyll (added for GitHub Pages)');

  const xlsxFiles = fs.readdirSync(ROOT).filter(f => f.startsWith('employee_directory_') && f.endsWith('.xlsx'));
  for (const f of xlsxFiles) {
    copyFile(path.join(ROOT, f), path.join(DIST, f));
  }

  const distSize = getDirSize(DIST);
  console.log('\n  dist/: ' + (distSize / 1024).toFixed(1) + ' KB\n');
}

build();
