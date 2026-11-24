/**
 * Gera os icones do app a partir da marca Jambo.
 *
 * POR QUE ISTO EXISTE EM VEZ DE PNGs SOLTOS: os caminhos SVG sao LIDOS de
 * components/jambo/jambo-mark.tsx, entao o icone nao pode divergir da marca que
 * o app desenha nas telas. Mexer na marca e rodar este script atualiza tudo —
 * em vez de alguem precisar redescobrir em qual editor os PNGs foram feitos.
 *
 *   node scripts/generate-icons.js      (ou: npm run icons)
 *
 * Requisitos do Android que o script respeita:
 *  - icone adaptativo tem canvas de 432x432 com ZONA SEGURA central de ~264px:
 *    o sistema recorta o resto em circulo, squircle, etc. A marca fica dentro
 *    dessa zona, senao a folha e cortada em alguns launchers;
 *  - a camada monocromatica (icones tematicos do Android 13+) e recolorida pelo
 *    sistema, entao vai em uma cor só e com alfa — nao em duas cores.
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'images');
const MARK = path.join(ROOT, 'components', 'jambo', 'jambo-mark.tsx');

/** Cores da identidade — os mesmos valores de constants/jambo-theme.ts. */
const COLORS = {
  cream: '#FFF9F6', // bg claro
  body: '#A3122E', // accent claro
  leaf: '#1F6B45', // leaf claro
  /** Rosa do tema escuro: legivel tanto sobre o creme quanto sobre o preto. */
  splash: '#FF5C7C',
  darkBg: '#060305',
};

/**
 * Le os tres caminhos da marca do proprio componente, na ordem em que ele os
 * declara: corpo, talo, folha. Falhar alto aqui e melhor que gerar um icone
 * silenciosamente errado.
 */
function readMarkPaths() {
  const source = fs.readFileSync(MARK, 'utf8');
  const paths = [...source.matchAll(/d="([^"]+)"/g)].map((match) => match[1]);
  if (paths.length !== 3) {
    throw new Error(
      `generate-icons: esperava 3 caminhos em jambo-mark.tsx e achei ${paths.length}. ` +
        'A marca mudou de estrutura e este script precisa ser revisto.',
    );
  }
  const [body, stalk, leaf] = paths;
  return { body, stalk, leaf };
}

/**
 * A marca como SVG independente.
 *
 * @param scale fracao do canvas que a marca ocupa (zona segura do adaptativo).
 */
function markSvg({ size, bodyColor, leafColor, background, scale = 1 }) {
  const { body, stalk, leaf } = readMarkPaths();
  // A marca e desenhada em viewBox 32x32; aqui ela e centralizada e escalada.
  const drawn = size * scale;
  const offset = (size - drawn) / 2;
  const unit = drawn / 32;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ''}
  <g transform="translate(${offset} ${offset}) scale(${unit})">
    <path d="${body}" fill="${bodyColor}"/>
    <path d="${stalk}" stroke="${bodyColor}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    ${leafColor ? `<path d="${leaf}" fill="${leafColor}"/>` : ''}
  </g>
</svg>`;
}

function write(name, svg, size) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  const file = path.join(OUT, name);
  fs.writeFileSync(file, png);
  console.log(`  ${name.padEnd(30)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log('Gerando icones a partir de components/jambo/jambo-mark.tsx\n');

// Icone do app: marca sobre o creme da identidade, com folga nas bordas.
write(
  'icon.png',
  markSvg({ size: 1024, bodyColor: COLORS.body, leafColor: COLORS.leaf, background: COLORS.cream, scale: 0.66 }),
  1024,
);

// Adaptativo: tres camadas separadas de 432x432.
write(
  'android-icon-foreground.png',
  // 0.56 mantem a marca dentro da zona segura de ~264px (61% de 432).
  markSvg({ size: 432, bodyColor: COLORS.body, leafColor: COLORS.leaf, scale: 0.56 }),
  432,
);
write('android-icon-background.png', markSvg({ size: 432, background: COLORS.cream, bodyColor: 'none' }), 432);
write(
  'android-icon-monochrome.png',
  // Uma cor só: o sistema recolore esta camada. Preto porque o que importa e o
  // alfa; a cor em si e descartada.
  markSvg({ size: 432, bodyColor: '#000000', leafColor: '#000000', scale: 0.56 }),
  432,
);

// Splash: fundo transparente (o app.json define a cor por tema), e o rosa, que
// e o unico tom da paleta legivel tanto no claro quanto no escuro.
write('splash-icon.png', markSvg({ size: 512, bodyColor: COLORS.splash, leafColor: COLORS.leaf, scale: 0.8 }), 512);

console.log('\nPronto. Os PNGs foram sobrescritos em assets/images/.');
console.log('Mudou a marca? Rode de novo e commite os PNGs junto.');
