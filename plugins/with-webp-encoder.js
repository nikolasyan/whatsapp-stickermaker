const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

/**
 * Adiciona a dependencia que codifica WebP ANIMADO.
 *
 * POR QUE ISTO EXISTE: nao ha API no Android para escrever WebP animado —
 * `Bitmap.compress(WEBP)` so produz estatico. O unico caminho e a
 * `WebPAnimEncoder` da libwebp (que vive na libwebpmux), e esta biblioteca e
 * um binding JNI dela.
 *
 * Verificado no AAR 1.1.2 antes de adotar (nada disso esta no README dela):
 *  - embarca as 4 ABIs que este projeto compila;
 *  - ~1,2 MB de nativo por ABI, 4,7 MB no total;
 *  - traz libwebpmux (encoder animado) e libwebpdemux (decoder, para preview);
 *  - minSdkVersion 21;
 *  - as transitivas (okhttp 4.12.0, core-ktx 1.16.0, kotlin-stdlib 2.1.20) ja
 *    estao no build pelo React Native, nas MESMAS versoes — nao entra pilha de
 *    rede nova nem ha conflito de versao.
 *
 * RISCO ACEITO: ultima publicacao em 2025-04-29, um mantenedor. Por isso o
 * encoder fica atras de um unico ponto no nosso modulo nativo: se a biblioteca
 * for abandonada e quebrar, trocar a implementacao (ou vendorizar o codigo, que
 * e MIT) mexe num lugar so.
 */

const DEPENDENCY = 'com.aureusapps.android:webp-android:1.1.2';

/**
 * O GifImage do Fresco implementa AnimatedImage e AnimatedImageDecoder, que
 * vivem em `animated-base`. O template do Expo ja poe `animated-gif` no
 * classpath (quando `expo.gif.enabled=true`, que e o padrao), mas o
 * animated-base entra como transitiva de RUNTIME dele — e o Kotlin exige
 * resolver toda a hierarquia de supertipos em tempo de compilacao, senao:
 *
 *   Cannot access 'AnimatedImage' which is a supertype of 'GifImage'
 *
 * A versao acompanha a que o Expo fixa, em vez de ficar cravada aqui e
 * divergir numa atualizacao de SDK.
 */
const FRESCO_BASE = 'com.facebook.fresco:animated-base:${expoLibs.versions.fresco.get()}';

/**
 * `coordinate` e o que se procura para saber se a dependencia ja esta la —
 * grupo:artefato, sem a versao, porque a do Fresco e uma expressao do Groovy.
 */
const DEPENDENCIES = [
  { coordinate: 'com.aureusapps.android:webp-android', notation: DEPENDENCY },
  { coordinate: 'com.facebook.fresco:animated-base', notation: FRESCO_BASE },
];
/**
 * Ancora na dependencia que o proprio template do Expo escreve primeiro dentro
 * do bloco `dependencies`. Mais estavel que ancorar em `dependencies {`, que
 * aparece tambem em outros blocos do arquivo.
 */
const ANCHOR = 'implementation("com.facebook.react:react-android")';

/**
 * Liga a decodificacao de WebP ANIMADO no Fresco.
 *
 * O template do Expo vem com `expo.webp.animated=false`, e com isso o
 * `<Image>` do React Native nao consegue desenhar um WebP animado: a figurinha
 * aparece INVISIVEL na grade do pacote, sem erro nenhum. Gerar a animacao e
 * poder ve-la sao duas coisas, e esta e a segunda.
 */
function withAnimatedWebPDecoding(config) {
  return withGradleProperties(config, (innerConfig) => {
    const KEY = 'expo.webp.animated';
    const existing = innerConfig.modResults.find((item) => item.type === 'property' && item.key === KEY);
    if (existing) {
      existing.value = 'true';
    } else {
      innerConfig.modResults.push({ type: 'property', key: KEY, value: 'true' });
    }
    return innerConfig;
  });
}

function withEncoderDependencies(config) {
  return withAppBuildGradle(config, (innerConfig) => {
    if (innerConfig.modResults.language !== 'groovy') {
      throw new Error(
        'with-webp-encoder: esperava android/app/build.gradle em Groovy, ' +
          `encontrei "${innerConfig.modResults.language}". O template do Expo mudou.`,
      );
    }

    const contents = innerConfig.modResults.contents;

    /**
     * Idempotente POR DEPENDENCIA, nao em bloco.
     *
     * Antes bastava encontrar a do webp para sair cedo — e quando a do Fresco
     * foi adicionada depois, um android/ ja processado nunca a recebia: o
     * prebuild dizia "ok" e o build quebrava no Kotlin. Verificar cada uma
     * separadamente faz o mod convergir a partir de qualquer estado.
     */
    const missing = DEPENDENCIES.filter(({ coordinate }) => !contents.includes(coordinate));
    if (missing.length === 0) return innerConfig;

    if (!contents.includes(ANCHOR)) {
      throw new Error(
        'with-webp-encoder: nao encontrei a dependencia do react-android em ' +
          'android/app/build.gradle. O template do Expo mudou e este plugin precisa ser atualizado.',
      );
    }

    innerConfig.modResults.contents = contents.replace(
      ANCHOR,
      [
        ANCHOR,
        '',
        '    // Figurinhas animadas — veja plugins/with-webp-encoder.js',
        ...missing.map(({ notation }) => `    implementation("${notation}")`),
      ].join('\n'),
    );

    return innerConfig;
  });
}

module.exports = function withWebPEncoder(config) {
  return withAnimatedWebPDecoding(withEncoderDependencies(config));
};
