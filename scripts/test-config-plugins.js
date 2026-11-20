/**
 * Testes dos config plugins (plugins/*.js).
 *
 * POR QUE ISTO EXISTE: estes plugins sao a parte mais fragil e menos visivel do
 * projeto. Eles reconstroem, a cada `expo prebuild`, coisas que vivem numa pasta
 * descartavel (android/) e que ninguem ve no dia a dia:
 *
 *  - with-ucrop-repository: o repositorio JitPack, sem o qual o uCrop nao
 *    resolve e o build do Android falha. Essa linha existia editada a mao e se
 *    perdia a cada prebuild --clean — foi o que originou o downgrade de SDK no
 *    inicio do projeto;
 *  - with-whatsapp-stickers: as classes Java, o registro no MainApplication e o
 *    <provider>. Um erro aqui nao da erro de compilacao: o app builda e a
 *    exportacao para o WhatsApp simplesmente nao funciona.
 *
 * Os dois falham em silencio, e e por isso que sao testados.
 *
 *   node scripts/test-config-plugins.js      (ou: npm run test:config-plugins)
 */

const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8'));
const ANDROID_PACKAGE = appJson.expo.android.package;

let pass = 0;
let fail = 0;

function check(nome, fn) {
  try {
    fn();
    console.log('  ok     ' + nome);
    pass++;
  } catch (error) {
    console.log('  FALHA  ' + nome + ' -> ' + error.message);
    fail++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * Carrega um plugin capturando os mods que ele registra, em vez de executar o
 * prebuild de verdade. Assim os testes rodam em milissegundos e nao tocam a
 * pasta android/ real.
 */
function loadPlugin(file, config) {
  const resolved = require.resolve('expo/config-plugins', { paths: [PROJECT_ROOT] });
  const mods = {};
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: {
      withDangerousMod: (cfg, [, fn]) => {
        mods.sources = fn;
        return cfg;
      },
      withMainApplication: (cfg, fn) => {
        mods.main = fn;
        return cfg;
      },
      withAndroidManifest: (cfg, fn) => {
        mods.manifest = fn;
        return cfg;
      },
      withProjectBuildGradle: (cfg, fn) => {
        mods.gradle = fn;
        return cfg;
      },
    },
  };
  const pluginPath = path.join(PROJECT_ROOT, 'plugins', file);
  delete require.cache[require.resolve(pluginPath)];
  require(pluginPath)(config);
  return mods;
}

// ============================================================ with-ucrop-repository

console.log('\n== with-ucrop-repository (JitPack / uCrop) ==');
{
  const { gradle } = loadPlugin('with-ucrop-repository.js', {});
  const JITPACK = "maven { url 'https://www.jitpack.io' }";

  const template = `// Top-level build file
buildscript {
  repositories {
    google()
    mavenCentral()
  }
}

allprojects {
  repositories {
    google()
    mavenCentral()
  }
}

apply plugin: "expo-root-project"
`;

  let aplicado;
  check('adiciona o JitPack num build.gradle limpo de template', () => {
    aplicado = gradle({ modResults: { language: 'groovy', contents: template } }).modResults.contents;
    assert(aplicado.includes(JITPACK), 'nao adicionou o repositorio');
  });

  check('CRITICO: JitPack entra DEPOIS de mavenCentral, nao antes', () => {
    // O Gradle consulta os repositorios na ordem declarada. Com o JitPack em
    // primeiro, toda dependencia do projeto bate nele e falha antes de cair no
    // google()/mavenCentral(): build lento e refem de instabilidade do JitPack.
    const bloco = aplicado.match(/allprojects \{[\s\S]*?\n\}/)[0];
    assert(bloco.indexOf('mavenCentral()') < bloco.indexOf('jitpack'), 'JitPack ficou antes do mavenCentral');
  });

  check('nao toca no bloco buildscript', () => {
    const buildscript = aplicado.match(/buildscript \{[\s\S]*?\n\}\n/)[0];
    assert(!buildscript.includes('jitpack'), 'poluiu o buildscript');
  });

  check('idempotente (o prebuild reaplica os mods)', () => {
    const duas = gradle({ modResults: { language: 'groovy', contents: aplicado } }).modResults.contents;
    assert((duas.match(/jitpack\.io/g) || []).length === 1, 'duplicou o repositorio');
  });

  check('falha alto se o template do Expo mudar de estrutura', () => {
    let lancou = false;
    try {
      gradle({ modResults: { language: 'groovy', contents: 'sem allprojects aqui' } });
    } catch {
      lancou = true;
    }
    assert(lancou, 'aceitou em silencio um build.gradle sem o bloco esperado');
  });

  check('falha alto se o build.gradle virar Kotlin DSL', () => {
    let lancou = false;
    try {
      gradle({ modResults: { language: 'kt', contents: template } });
    } catch {
      lancou = true;
    }
    assert(lancou, 'aceitou um arquivo .kts como se fosse Groovy');
  });
}

// =========================================================== with-whatsapp-stickers

console.log('\n== with-whatsapp-stickers (package: ' + ANDROID_PACKAGE + ') ==');
{
  const config = { android: { package: ANDROID_PACKAGE } };
  const { sources, main, manifest } = loadPlugin('with-whatsapp-stickers.js', config);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jambo-plugins-'));
  try {
    sources({ ...config, modRequest: { platformProjectRoot: root } });
    const javaDir = path.join(root, 'app', 'src', 'main', 'java', ...ANDROID_PACKAGE.split('.'), 'whatsapp');

    check('copia os fontes Java para o caminho do applicationId', () => {
      assert(fs.existsSync(javaDir), 'diretorio ausente: ' + javaDir);
      assert(fs.readdirSync(javaDir).length === 3, 'esperava 3 .java, achou ' + fs.readdirSync(javaDir).join(','));
    });

    check('CRITICO: __PACKAGE__ resolvido em todos os .java', () => {
      for (const file of fs.readdirSync(javaDir)) {
        const texto = fs.readFileSync(path.join(javaDir, file), 'utf8');
        assert(!texto.includes('__PACKAGE__'), file + ' ficou com o token nao resolvido');
        assert(texto.includes('package ' + ANDROID_PACKAGE + '.whatsapp;'), file + ' com declaracao de package errada');
      }
    });

    check('o provider importa o BuildConfig do package certo', () => {
      const texto = fs.readFileSync(path.join(javaDir, 'WhatsAppStickerProvider.java'), 'utf8');
      assert(texto.includes('import ' + ANDROID_PACKAGE + '.BuildConfig;'), 'import de BuildConfig errado');
    });

    check('nenhum residuo do placeholder com.anonymous', () => {
      for (const file of fs.readdirSync(javaDir)) {
        assert(
          !fs.readFileSync(path.join(javaDir, file), 'utf8').includes('com.anonymous'),
          file + ' menciona com.anonymous',
        );
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const mainApplication = `package ${ANDROID_PACKAGE}

import android.app.Application
import com.facebook.react.PackageList

class MainApplication : Application(), ReactApplication {
  override val reactNativeHost: ReactNativeHost =
    object : DefaultReactNativeHost(this) {
      override fun getPackages(): List<ReactPackage> =
          PackageList(this).packages.apply {
          }
    }
}
`;

  let kotlin;
  check('registra o WhatsAppStickerPackage com o import certo', () => {
    kotlin = main({ ...config, modResults: { contents: mainApplication } }).modResults.contents;
    assert(
      kotlin.includes('import ' + ANDROID_PACKAGE + '.whatsapp.WhatsAppStickerPackage'),
      'import ausente ou com package errado',
    );
    assert(kotlin.includes('add(WhatsAppStickerPackage())'), 'registro ausente na lista de packages');
  });

  check('idempotente: nao duplica import nem registro', () => {
    const texto = main({ ...config, modResults: { contents: kotlin } }).modResults.contents;
    assert((texto.match(/import .*WhatsAppStickerPackage/g) || []).length === 1, 'import duplicado');
    assert((texto.match(/add\(WhatsAppStickerPackage\(\)\)/g) || []).length === 1, 'registro duplicado');
  });

  check('falha alto se o template do MainApplication mudar', () => {
    let lancou = false;
    try {
      main({ ...config, modResults: { contents: 'class MainApplication' } });
    } catch {
      lancou = true;
    }
    assert(lancou, 'aceitou em silencio um MainApplication sem a lista de packages');
  });

  let androidManifest;
  check('declara o <provider> com a authority e a permissao certas', () => {
    androidManifest = manifest({ ...config, modResults: { manifest: { application: [{ $: {} }] } } }).modResults
      .manifest;
    const provider = androidManifest.application[0].provider[0].$;
    // ${applicationId} e placeholder do Gradle: acompanha o package sozinho.
    assert(
      provider['android:authorities'] === '${applicationId}.stickercontentprovider',
      'authority: ' + provider['android:authorities'],
    );
    assert(provider['android:name'] === '.whatsapp.WhatsAppStickerProvider', 'name: ' + provider['android:name']);
    // So o WhatsApp detem esta permissao — e o que impede outros apps de ler o provider.
    assert(provider['android:readPermission'] === 'com.whatsapp.sticker.READ', 'readPermission ausente ou errada');
  });

  check('declara as <queries> dos dois WhatsApps (visibilidade no Android 11+)', () => {
    const queries = androidManifest.queries[0];
    const pacotes = queries.package.map((entry) => entry.$['android:name']);
    assert(pacotes.includes('com.whatsapp'), 'falta com.whatsapp');
    assert(pacotes.includes('com.whatsapp.w4b'), 'falta com.whatsapp.w4b (WhatsApp Business)');
    const acoes = queries.intent.flatMap((entry) => (entry.action || []).map((a) => a.$['android:name']));
    assert(acoes.includes('com.whatsapp.intent.action.ENABLE_STICKER_PACK'), 'falta o intent de importacao');
  });

  check('soma ao <queries> existente em vez de substituir', () => {
    // O Expo gera um <queries> proprio; sobrescrever quebraria outras libs.
    const comQueries = {
      application: [{ $: {} }],
      queries: [{ package: [{ $: { 'android:name': 'com.outro.app' } }] }],
    };
    const resultado = manifest({ ...config, modResults: { manifest: comQueries } }).modResults.manifest;
    const pacotes = resultado.queries[0].package.map((entry) => entry.$['android:name']);
    assert(pacotes.includes('com.outro.app'), 'apagou a entrada que ja existia');
    assert(pacotes.includes('com.whatsapp'), 'nao adicionou a propria');
  });

  check('idempotente: nao duplica provider nem queries', () => {
    const resultado = manifest({ ...config, modResults: { manifest: androidManifest } }).modResults.manifest;
    assert(resultado.application[0].provider.length === 1, 'provider duplicado');
    assert(
      resultado.queries[0].package.filter((e) => e.$['android:name'] === 'com.whatsapp').length === 1,
      'query duplicada',
    );
  });

  check('exige android.package definido', () => {
    let lancou = false;
    try {
      loadPlugin('with-whatsapp-stickers.js', {}).sources({ modRequest: { platformProjectRoot: os.tmpdir() } });
    } catch {
      lancou = true;
    }
    assert(lancou, 'aceitou config sem android.package');
  });
}

console.log('\nauthority efetiva no aparelho: ' + ANDROID_PACKAGE + '.stickercontentprovider');
console.log('\n== ' + pass + ' ok, ' + fail + ' falhas ==');
process.exit(fail > 0 ? 1 : 0);
