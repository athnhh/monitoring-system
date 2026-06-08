/**
 * QUEMAHTECH Build Script
 * Minifies CSS and JS files for faster production uploads.
 * Usage: npm run build
 * Requires: terser, clean-css (npm install --save-dev terser clean-css)
 */
const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const { minify: terserMinify } = require('terser');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// Files to minify
const ASSETS = {
  'styles.css': 'styles.css',
  'script.js': 'script.js',
};

// Static files to copy as-is
const STATIC_FILES = [
  'prototype.html',
  'data.json',
  'logo.webp',
  'photo.jpeg',
  'start.bat',
  'package.json',
];

// Ensure dist directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Copy a file from src to dest
function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
  const bytes = fs.statSync(src).size;
  console.log(`  ✓ Copied ${path.basename(src)} (${(bytes / 1024).toFixed(1)} KB)`);
}

async function minifyCSS(inputPath, outputPath) {
  const source = fs.readFileSync(inputPath, 'utf8');
  const result = new CleanCSS({ level: 2 }).minify(source);
  if (result.errors.length) {
    console.error(`  ✗ CSS errors:`, result.errors);
    return;
  }
  fs.writeFileSync(outputPath, result.styles);
  const inBytes = fs.statSync(inputPath).size;
  const outBytes = result.styles.length;
  const saved = ((1 - outBytes / inBytes) * 100).toFixed(1);
  console.log(`  ✓ Minified ${path.basename(inputPath)}: ${(inBytes / 1024).toFixed(1)} KB → ${(outBytes / 1024).toFixed(1)} KB (${saved}% saved)`);
}

async function minifyJS(inputPath, outputPath) {
  const source = fs.readFileSync(inputPath, 'utf8');
  const result = await terserMinify(source, {
    compress: { drop_console: false },
    mangle: true,
    output: { comments: false },
  });
  fs.writeFileSync(outputPath, result.code);
  const inBytes = fs.statSync(inputPath).size;
  const outBytes = result.code.length;
  const saved = ((1 - outBytes / inBytes) * 100).toFixed(1);
  console.log(`  ✓ Minified ${path.basename(inputPath)}: ${(inBytes / 1024).toFixed(1)} KB → ${(outBytes / 1024).toFixed(1)} KB (${saved}% saved)`);
}

async function build() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  QUEMAHTECH Build Step');
  console.log('═══════════════════════════════════════════\n');

  ensureDir(DIST);

  // Minify CSS and JS
  console.log('Minifying assets...');
  for (const [src, dest] of Object.entries(ASSETS)) {
    const inputPath = path.join(ROOT, src);
    const outputPath = path.join(DIST, dest);
    if (src.endsWith('.css')) {
      await minifyCSS(inputPath, outputPath);
    } else if (src.endsWith('.js')) {
      await minifyJS(inputPath, outputPath);
    }
  }

  // Copy static files
  console.log('\nCopying static files...');
  for (const file of STATIC_FILES) {
    const src = path.join(ROOT, file);
    const dest = path.join(DIST, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
    } else {
      console.log(`  - Skipped ${file} (not found)`);
    }
  }

  // Copy employee spreadsheet if present
  const files = fs.readdirSync(ROOT).filter(f => f.startsWith('employee_directory_') && f.endsWith('.xlsx'));
  for (const f of files) {
    copyFile(path.join(ROOT, f), path.join(DIST, f));
  }

  // Print summary
  console.log('\n--- Build Summary ---');
  const distSize = getDirSize(DIST);
  console.log(`  dist/ folder: ${(distSize / 1024).toFixed(1)} KB`);
  console.log('  Build complete! Run `npm start` to serve the production build.\n');
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

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
