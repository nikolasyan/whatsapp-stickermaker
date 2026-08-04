const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Reaplica, a cada `expo prebuild`, o código nativo que faz a exportação de
 * figurinhas para o WhatsApp. Sem isto o prebuild recriaria o android/ do zero
 * e a integração sumiria — foi o motivo de a pasta estar versionada antes.
 *
 * O que este plugin reproduz:
 *  1. as três classes Java (módulo, package e ContentProvider);
 *  2. o registro do package em MainApplication.kt;
 *  3. as entradas de manifest: <queries> do WhatsApp e o <provider>.
 *
 * As fontes ficam em plugins/android/*.java com o token __PACKAGE__ no lugar do
 * applicationId, resolvido na cópia a partir de `android.package` do app.json.
 */

const SOURCE_DIR = path.join(__dirname, 'android');
const PROVIDER_AUTHORITY_SUFFIX = '.stickercontentprovider';
const ENABLE_STICKER_PACK = 'com.whatsapp.intent.action.ENABLE_STICKER_PACK';
const WHATSAPP_PACKAGES = ['com.whatsapp', 'com.whatsapp.w4b'];
const PACKAGES_ANCHOR = 'PackageList(this).packages.apply {';

function androidPackageOf(config) {
  const androidPackage = config.android && config.android.package;
  if (!androidPackage) {
    throw new Error('with-whatsapp-stickers: defina "android.package" no app.json.');
  }
  return androidPackage;
}

/** Copia as classes Java resolvendo o applicationId. */
function withStickerSources(config) {
  return withDangerousMod(config, [
    'android',
    (innerConfig) => {
      const androidPackage = androidPackageOf(innerConfig);
      const targetDir = path.join(
        innerConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...androidPackage.split('.'),
        'whatsapp',
      );

      fs.mkdirSync(targetDir, { recursive: true });
      const sources = fs.readdirSync(SOURCE_DIR).filter((file) => file.endsWith('.java'));
      if (sources.length === 0) {
        throw new Error(`with-whatsapp-stickers: nenhum .java encontrado em ${SOURCE_DIR}`);
      }

      for (const file of sources) {
        const contents = fs
          .readFileSync(path.join(SOURCE_DIR, file), 'utf8')
          .replace(/__PACKAGE__/g, androidPackage);
        fs.writeFileSync(path.join(targetDir, file), contents);
      }

      return innerConfig;
    },
  ]);
}

/** Registra o WhatsAppStickerPackage na lista de packages do React Native. */
function withPackageRegistration(config) {
  return withMainApplication(config, (innerConfig) => {
    const androidPackage = androidPackageOf(innerConfig);
    const importLine = `import ${androidPackage}.whatsapp.WhatsAppStickerPackage`;
    let contents = innerConfig.modResults.contents;

    if (!contents.includes(importLine)) {
      // Ancora no proprio package do arquivo para o import cair no topo.
      contents = contents.replace(/^(package .+\r?\n)/m, `$1\n${importLine}\n`);
    }

    if (!contents.includes('WhatsAppStickerPackage()')) {
      if (!contents.includes(PACKAGES_ANCHOR)) {
        throw new Error(
          'with-whatsapp-stickers: nao encontrei a lista de packages em MainApplication.kt. ' +
            'O template do Expo mudou e este plugin precisa ser atualizado.',
        );
      }
      contents = contents.replace(PACKAGES_ANCHOR, `${PACKAGES_ANCHOR}\n              add(WhatsAppStickerPackage())`);
    }

    innerConfig.modResults.contents = contents;
    return innerConfig;
  });
}

/** <queries> do WhatsApp (visibilidade de pacotes no Android 11+) e o <provider>. */
function withStickerManifest(config) {
  return withAndroidManifest(config, (innerConfig) => {
    const manifest = innerConfig.modResults.manifest;

    // O Expo ja gera um <queries> proprio; aqui e preciso somar, nao substituir.
    if (!Array.isArray(manifest.queries)) manifest.queries = [];
    if (manifest.queries.length === 0) manifest.queries.push({});
    const queries = manifest.queries[0];

    if (!Array.isArray(queries.intent)) queries.intent = [];
    const hasIntent = queries.intent.some((entry) =>
      (entry.action || []).some((action) => action.$['android:name'] === ENABLE_STICKER_PACK),
    );
    if (!hasIntent) {
      queries.intent.push({ action: [{ $: { 'android:name': ENABLE_STICKER_PACK } }] });
    }

    if (!Array.isArray(queries.package)) queries.package = [];
    for (const name of WHATSAPP_PACKAGES) {
      if (!queries.package.some((entry) => entry.$['android:name'] === name)) {
        queries.package.push({ $: { 'android:name': name } });
      }
    }

    const application = manifest.application && manifest.application[0];
    if (!application) {
      throw new Error('with-whatsapp-stickers: <application> ausente no AndroidManifest.');
    }

    if (!Array.isArray(application.provider)) application.provider = [];
    const providerName = '.whatsapp.WhatsAppStickerProvider';
    if (!application.provider.some((entry) => entry.$['android:name'] === providerName)) {
      application.provider.push({
        $: {
          'android:name': providerName,
          'android:authorities': `\${applicationId}${PROVIDER_AUTHORITY_SUFFIX}`,
          'android:exported': 'true',
          // Só o WhatsApp detém esta permissão, então o provider fica legível apenas por ele.
          'android:readPermission': 'com.whatsapp.sticker.READ',
        },
      });
    }

    return innerConfig;
  });
}

module.exports = function withWhatsAppStickers(config) {
  return withStickerManifest(withPackageRegistration(withStickerSources(config)));
};
