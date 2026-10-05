import sharp from 'sharp';
const src = 'public/brand/logo.png';       // 287x210 emblem
const wide = 'public/brand/logo1.png';      // 400x110 wordmark lockup
const BG = { r: 0, g: 0, b: 0, alpha: 1 };
const icon = async (size, name, inner) => {
  const logo = await sharp(src).resize({ width: Math.round(size * inner) }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } }).composite([{ input: logo, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(`public/icons/${name}.png`);
};
await icon(192, 'prince-192', 0.82);
await icon(512, 'prince-512', 0.82);
await icon(512, 'prince-maskable-512', 0.62); // keep artwork inside the maskable safe zone
await icon(180, 'prince-apple-180', 0.82);
await sharp(src).resize({ width: 240 }).webp({ quality: 82 }).toFile('public/brand/prince-emblem.webp');
await sharp(wide).resize({ width: 400 }).webp({ quality: 82 }).toFile('public/brand/prince-wordmark.webp');
console.log('assets written');
