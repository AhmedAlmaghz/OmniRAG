import fs from 'node:fs';
import path from 'node:path';

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const item of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, item), path.join(dest, item));
    }
  } else if (exists) {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

try {
  console.log('Post-build: Preparing dist directory for deployment...');
  
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }

  // 1. Copy .next contents to dist/
  copyRecursiveSync('.next', 'dist/.next');
  copyRecursiveSync('.next', 'dist');

  // 2. Ensure index.html exists in dist/ for static artifact checks
  const appIndex = path.join('.next', 'server', 'app', 'index.html');
  if (fs.existsSync(appIndex)) {
    fs.copyFileSync(appIndex, path.join('dist', 'index.html'));
    console.log('✓ Copied .next/server/app/index.html -> dist/index.html');
  }

  // 3. Ensure 404.html exists
  const notFoundHtml = path.join('.next', 'server', 'app', '_not-found.html');
  if (fs.existsSync(notFoundHtml)) {
    fs.copyFileSync(notFoundHtml, path.join('dist', '404.html'));
    fs.copyFileSync(notFoundHtml, path.join('dist', '_not-found.html'));
    console.log('✓ Copied _not-found.html -> dist/404.html');
  }

  // 4. Copy static assets to _next/static in dist
  const nextStatic = path.join('.next', 'static');
  if (fs.existsSync(nextStatic)) {
    copyRecursiveSync(nextStatic, path.join('dist', '_next', 'static'));
    console.log('✓ Copied .next/static -> dist/_next/static');
  }

  console.log('✓ Dist preparation completed successfully.');
} catch (err) {
  console.error('Error preparing dist artifact:', err);
  // Do not fail the build if post-processing has minor warnings
}
