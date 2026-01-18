const fs = require('fs');
const path = require('path');

const src = path.join('mods', 'identity', 'src', 'generated', '@prisma', 'client');
const dest = path.join('mods', 'identity', 'dist', 'generated', '@prisma', 'client');

console.log(`Copying Prisma client from ${src} to ${dest}`);

try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log('Successfully copied Prisma client.');
} catch (e) {
    console.error('Error copying Prisma client:', e);
    process.exit(1);
}
