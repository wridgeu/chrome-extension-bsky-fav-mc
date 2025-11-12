import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, '..', 'dist');

// Ensure dist directory exists
fs.mkdirSync(distDir, { recursive: true });

// Files and directories to process
const itemsToProcess = [
	'manifest.json',
	'background.js',
	'content.js',
	'icons',
];

// Process items
for (const item of itemsToProcess) {
	const src = path.join(__dirname, '..', item);
	const dest = path.join(distDir, item);
	
	if (!fs.existsSync(src)) {
		console.warn(`Warning: ${item} not found, skipping`);
		continue;
	}
	
	const stat = fs.statSync(src);
	
	if (stat.isDirectory()) {
		// Copy directories as-is
		fs.cpSync(src, dest, { recursive: true });
		console.log(`Copied ${item}/`);
	} else if (item.endsWith('.js')) {
		// Minify JavaScript files
		const code = fs.readFileSync(src, 'utf8');
		const result = await minify(code, {
			compress: {
				drop_console: false, // Keep console statements for debugging
				passes: 2,
			},
			format: {
				comments: false, // Remove comments
			},
			module: true, // Preserve ES module syntax
		});
		
		if (result.error) {
			throw new Error(`Failed to minify ${item}: ${result.error.message}`);
		}
		
		fs.writeFileSync(dest, result.code, 'utf8');
		console.log(`Minified ${item}`);
	} else {
		// Copy other files as-is
		fs.copyFileSync(src, dest);
		console.log(`Copied ${item}`);
	}
}

console.log('Build complete!');

