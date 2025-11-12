import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, '..', 'dist');

// Ensure dist directory exists
fs.mkdirSync(distDir, { recursive: true });

// Files and directories to copy
const itemsToCopy = [
	'manifest.json',
	'background.js',
	'content.js',
	'icons',
];

// Copy items
for (const item of itemsToCopy) {
	const src = path.join(__dirname, '..', item);
	const dest = path.join(distDir, item);
	if (fs.existsSync(src)) {
		const stat = fs.statSync(src);
		if (stat.isDirectory()) {
			fs.cpSync(src, dest, { recursive: true });
			console.log(`Copied ${item}/`);
		} else {
			fs.copyFileSync(src, dest);
			console.log(`Copied ${item}`);
		}
	}
}

console.log('Build complete!');

