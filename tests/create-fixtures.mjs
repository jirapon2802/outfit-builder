import sharp from 'sharp';
const forms = {
  top: '<path d="M90 60 40 95 68 145 100 125V260H220V125L252 145 280 95 230 60C205 80 115 80 90 60Z" fill="#657752"/>',
  bottom: '<path d="M90 40H230L250 280H178L160 120 142 280H70Z" fill="#c9ae81"/>',
  shoes: '<path d="M50 150 105 170 170 140 195 190 270 220V260H50Z" fill="#5f4537"/>',
  outerwear: '<path d="M110 40 60 65 20 240 65 253 100 140V280H220V140L255 253 300 240 260 65 210 40 160 80Z" fill="#384655"/><path d="M160 80V280" stroke="#a1a9af" stroke-width="4"/>',
};
(async () => { for (const [name, shape] of Object.entries(forms)) await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="white"/>${shape}</svg>`)).png().toFile(`tests/fixtures/${name}.png`); })();
