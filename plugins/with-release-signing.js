const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Assina o APK de release com a keystore do projeto, nao com a de debug.
 *
 * POR QUE ISTO EXISTE: o template do Expo assina o release com `signingConfigs.debug`
 * — o proprio comentario dele avisa. Essa e a chave de debug padrao do React
 * Native: publica e identica em todo projeto RN. Funciona para instalar, mas a
 * assinatura e a identidade do app para o Android: trocar de chave depois obriga
 * TODOS a desinstalar antes de atualizar, e desinstalar apaga os pacotes.
 *
 * POR QUE E UM CONFIG PLUGIN: a pasta android/ e descartavel (recriada a cada
 * prebuild), entao editar o build.gradle a mao se perderia — foi exatamente o
 * que aconteceu com o repositorio do JitPack no inicio do projeto.
 *
 * POR QUE AS CREDENCIAIS FICAM FORA DE android/ E FORA DO GIT: a keystore e um
 * segredo irrecuperavel. Em android/ o `prebuild --clean` apagaria; no git ela
 * vazaria. Ficam em credentials/, que esta no .gitignore.
 *
 * DEGRADACAO: sem credentials/keystore.properties o release volta a ser assinado
 * com a chave de debug e o Gradle emite um aviso. Nao falha de proposito — um
 * clone novo sem as credenciais ainda precisa conseguir compilar debug.
 */

const PROPS_PATH = '../credentials/keystore.properties';
const KEYSTORE_PATH = '../credentials/jambo-release.keystore';

/** Carregador das credenciais, inserido antes do bloco `android {`. */
const LOADER = `
// Assinatura de release — veja plugins/with-release-signing.js
def jamboKeystoreProps = new Properties()
def jamboKeystoreFile = rootProject.file('${PROPS_PATH}')
def jamboSigningReady = jamboKeystoreFile.exists() && rootProject.file('${KEYSTORE_PATH}').exists()
if (jamboSigningReady) {
    jamboKeystoreFile.withInputStream { jamboKeystoreProps.load(it) }
} else {
    logger.warn('AVISO: credentials/ ausente — o APK de release sera assinado com a chave de DEBUG.')
}
`;

const SIGNING_ANCHOR = `    signingConfigs {
        debug {`;

const RELEASE_SIGNING_ANCHOR = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (innerConfig) => {
    if (innerConfig.modResults.language !== 'groovy') {
      throw new Error(
        'with-release-signing: esperava android/app/build.gradle em Groovy, ' +
          `encontrei "${innerConfig.modResults.language}". O template do Expo mudou.`,
      );
    }

    let contents = innerConfig.modResults.contents;

    // Idempotente: o prebuild roda os mods varias vezes sobre o mesmo arquivo.
    if (contents.includes('jamboSigningReady')) return innerConfig;

    for (const [nome, ancora] of [
      ['bloco android', '\nandroid {'],
      ['signingConfigs.debug', SIGNING_ANCHOR],
      ['signingConfig do release', RELEASE_SIGNING_ANCHOR],
    ]) {
      if (!contents.includes(ancora)) {
        throw new Error(
          `with-release-signing: nao encontrei a ancora "${nome}" em android/app/build.gradle. ` +
            'O template do Expo mudou e este plugin precisa ser atualizado.',
        );
      }
    }

    contents = contents.replace('\nandroid {', `${LOADER}\nandroid {`);

    // A config de release so e declarada quando as credenciais existem: com
    // senhas nulas o Gradle falharia tarde, na hora de assinar.
    contents = contents.replace(
      SIGNING_ANCHOR,
      `    signingConfigs {
        if (jamboSigningReady) {
            release {
                storeFile rootProject.file('${KEYSTORE_PATH}')
                storePassword jamboKeystoreProps['JAMBO_STORE_PASSWORD']
                keyAlias jamboKeystoreProps['JAMBO_KEY_ALIAS']
                keyPassword jamboKeystoreProps['JAMBO_KEY_PASSWORD']
            }
        }
        debug {`,
    );

    contents = contents.replace(
      RELEASE_SIGNING_ANCHOR,
      `            // Assinatura propria quando credentials/ existe; debug como reserva.
            // Veja plugins/with-release-signing.js.
            signingConfig jamboSigningReady ? signingConfigs.release : signingConfigs.debug`,
    );

    innerConfig.modResults.contents = contents;
    return innerConfig;
  });
};
