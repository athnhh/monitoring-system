const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

const STATIC_FILES = ['prototype.html', 'data.json', 'logo.webp', 'photo.jpeg', 'start.bat', 'package.json'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Basic CSS minification (built-in) ──
function minifyCSS(code) {
  // Protect calc() expressions first (need spaces around + and -)
  const calcs = [];
  code = code.replace(/calc\([^)]+\)/g, m => { calcs.push(m); return '__CALC' + (calcs.length - 1) + '__'; });
  code = code
    .replace(/\/\*[\s\S]*?\*\//g, '')       // remove block comments
    .replace(/\s*([{}:;,])\s*/g, '$1')       // trim around { } : ; ,
    .replace(/;}/g, '}')                      // remove last semicolon
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .replace(/\s*([>~+])\s*/g, '$1')         // trim around combinators (not - to avoid calc issues)
    .trim();
  // Restore calc() expressions
  code = code.replace(/__CALC(\d+)__/g, (_, i) => calcs[parseInt(i)]);
  return code;
}

// ── Basic JS minification (built-in) ──
function minifyJS(code) {
  // Protect string literals from URL mangling
  const strings = [];
  code = code.replace(/'[^']*'/g, m => { strings.push(m); return '__STR' + (strings.length - 1) + '__'; });
  code = code.replace(/"[^"]*"/g, m => { strings.push(m); return '__STR' + (strings.length - 1) + '__'; });
  code = code.replace(/`[^`]*`/g, m => { strings.push(m); return '__STR' + (strings.length - 1) + '__'; });
  code = code
    .replace(/\/\/.*$/gm, '')                 // remove line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')        // remove block comments
    .replace(/\s*([{}()\[\];:,.<>+\-*/%&|^!~]=?)\s*/g, (m, c) => c) // trim around operators
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .replace(/, /g, ',')
    .replace(/; /g, ';')
    .replace(/ : /g, ':')
    .trim();
  // Restore strings
  code = code.replace(/__STR(\d+)__/g, (_, i) => strings[parseInt(i)]);
  return code;
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, dest);
  const bytes = fs.statSync(src).size;
  console.log(`  ✓ ${path.basename(src)} (${(bytes / 1024).toFixed(1)} KB)`);
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
  console.log('\n  TEST Build\n');

  ensureDir(DIST);

  // Minify CSS
  const cssPath = path.join(ROOT, 'styles.css');
  if (fs.existsSync(cssPath)) {
    const css = fs.readFileSync(cssPath, 'utf8');
    const minified = minifyCSS(css);
    fs.writeFileSync(path.join(DIST, 'styles.css'), minified);
    const saved = ((1 - minified.length / css.length) * 100).toFixed(1);
    console.log(`  ✓ styles.css: ${(css.length / 1024).toFixed(1)} KB → ${(minified.length / 1024).toFixed(1)} KB (${saved}%)`);
  }

  // Minify JS
  const jsPath = path.join(ROOT, 'script.js');
  if (fs.existsSync(jsPath)) {
    const js = fs.readFileSync(jsPath, 'utf8');
    const minified = minifyJS(js);
    fs.writeFileSync(path.join(DIST, 'script.js'), minified);
    const saved = ((1 - minified.length / js.length) * 100).toFixed(1);
    console.log(`  ✓ script.js: ${(js.length / 1024).toFixed(1)} KB → ${(minified.length / 1024).toFixed(1)} KB (${saved}%)`);
  }

  // Copy static files
  console.log('\n  Copying files...');
  for (const file of STATIC_FILES) {
    copyFile(path.join(ROOT, file), path.join(DIST, file));
  }

  // Copy employee spreadsheets
  const xlsxFiles = fs.readdirSync(ROOT).filter(f => f.startsWith('employee_directory_') && f.endsWith('.xlsx'));
  for (const f of xlsxFiles) {
    copyFile(path.join(ROOT, f), path.join(DIST, f));
  }

  const distSize = getDirSize(DIST);
  console.log(`\n  dist/: ${(distSize / 1024).toFixed(1)} KB\n`);
}

build();
