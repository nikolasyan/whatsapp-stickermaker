const { withProjectBuildGradle } = require('expo/config-plugins');

/**
 * Adiciona o repositorio JitPack ao android/build.gradle.
 *
 * POR QUE ISTO EXISTE: o react-native-image-crop-picker depende de
 * `com.github.yalantis:ucrop:2.2.11-native`, publicado SO no JitPack
 * (veja node_modules/react-native-image-crop-picker/android/build.gradle).
 * O template do Expo traz apenas google() e mavenCentral(), entao sem este
 * mod o Gradle nao resolve o uCrop e o build do Android falha com
 * "Could not find com.github.yalantis:ucrop".
 *
 * Esta linha ja existia adicionada a mao em android/build.gradle. Como a
 * pasta android/ voltou a ser descartavel (recriada a cada `expo prebuild`),
 * a correcao manual se perdia no proximo prebuild --clean e o build quebrava
 * de novo — foi o que originou o downgrade de SDK no inicio do projeto.
 *
 * Se algum dia o image-crop-picker sair do projeto, este plugin sai com ele.
 */

const JITPACK_URL = 'https://www.jitpack.io';
/**
 * Ancora no bloco allprojects (e nao no buildscript): o uCrop e dependencia dos
 * modulos, nao do classpath do Gradle.
 *
 * Inserir DEPOIS do mavenCentral(), nao antes: o Gradle consulta os repositorios
 * na ordem declarada. Com o JitPack em primeiro, toda dependencia do projeto
 * bateria nele e falharia antes de cair no google()/mavenCentral() — build mais
 * lento e vulneravel a instabilidade do JitPack, que e justamente a falha
 * conhecida da lib (ivpusic/react-native-image-crop-picker#2222).
 */
const ALLPROJECTS_REPOSITORIES = /(allprojects\s*\{\s*repositories\s*\{[\s\S]*?mavenCentral\(\))/;

module.exports = function withUCropRepository(config) {
  return withProjectBuildGradle(config, (innerConfig) => {
    if (innerConfig.modResults.language !== 'groovy') {
      throw new Error(
        'with-ucrop-repository: esperava android/build.gradle em Groovy, ' +
          `encontrei "${innerConfig.modResults.language}". O template do Expo mudou.`,
      );
    }

    const contents = innerConfig.modResults.contents;

    // Idempotente: o prebuild roda os mods varias vezes sobre o mesmo arquivo.
    if (contents.includes(JITPACK_URL)) return innerConfig;

    if (!ALLPROJECTS_REPOSITORIES.test(contents)) {
      throw new Error(
        'with-ucrop-repository: nao encontrei o bloco allprojects { repositories { } } ' +
          'em android/build.gradle. O template do Expo mudou e este plugin precisa ser atualizado.',
      );
    }

    innerConfig.modResults.contents = contents.replace(
      ALLPROJECTS_REPOSITORIES,
      `$1\n    maven { url '${JITPACK_URL}' }`,
    );

    return innerConfig;
  });
};
