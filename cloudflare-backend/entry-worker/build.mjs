import {readdir, writeFile, mkdir, copyFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const source = fileURLToPath(new URL('../../', import.meta.url));
const output = fileURLToPath(new URL('./dist/', import.meta.url));
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
let count = 0;
async function copy(directory, recursive = false) {
  for (const entry of await readdir(join(source, directory), {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue;
    const relative = join(directory, entry.name);
    if (recursive && entry.isDirectory()) await copy(relative, true);
    if (!entry.isFile() || !/\.(html|css|js|json|glb|webp|png|jpe?g|svg|woff2?)$/.test(entry.name)) continue;
    await mkdir(join(output, directory), {recursive: true});
    await copyFile(join(source, relative), join(output, relative));
    count++;
  }
}
for (const dir of ['', 'printer']) await copy(dir);
for (const dir of ['vendor', 'assets/print-cards', 'printer/vendor', 'printer/assets']) await copy(dir, true);
for (const dir of ['motion/animations','motion/vectors','motion/vendor']) await copy(dir, true);
await mkdir(join(output,'motion'),{recursive:true});
await copyFile(join(source,'motion/player.mjs'),join(output,'motion/player.mjs'));count++;
await writeFile(join(output, '_headers'), '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n');
console.log(`Prepared ${count} browser assets; private jobs, databases and server files excluded.`);
