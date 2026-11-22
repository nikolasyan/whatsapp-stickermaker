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
      // Os dois mods de gradle caem no mesmo slot: nenhum plugin usa ambos.
      withProjectBuildGradle: (cfg, fn) => {
        mods.gradle = fn;
        return cfg;
      },
      withAppBuildGradle: (cfg, fn) => {
        mods.gradle = fn;
        return cfg;
      },
      withGradleProperties: (cfg, fn) => {
        mods.properties = fn;
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

// ================================================================ with-webp-encoder

console.log('\n== with-webp-encoder (dependencia de WebP animado) ==');
{
  const { gradle, properties } = loadPlugin('with-webp-encoder.js', {});
  const DEP = 'com.aureusapps.android:webp-android:1.1.2';

  check('CRITICO: liga expo.webp.animated (sem isso a figurinha fica invisivel)', () => {
    // O template vem com false, e nesse estado o <Image> do RN nao desenha um
    // WebP animado — a figurinha aparece em branco na grade, sem erro algum.
    const resultado = properties({
      modResults: [{ type: 'property', key: 'expo.webp.animated', value: 'false' }],
    }).modResults;
    const item = resultado.find((p) => p.key === 'expo.webp.animated');
    assert(item, 'a propriedade desapareceu');
    assert(item.value === 'true', 'ficou em ' + item.value);
  });

  check('cria a propriedade quando ela nao existe', () => {
    const resultado = properties({ modResults: [] }).modResults;
    const item = resultado.find((p) => p.key === 'expo.webp.animated');
    assert(item && item.value === 'true', 'nao criou a propriedade');
  });

  check('nao duplica a propriedade ao reaplicar', () => {
    let estado = { modResults: [] };
    estado = properties(estado);
    estado = properties(estado);
    const todas = estado.modResults.filter((p) => p.key === 'expo.webp.animated');
    assert(todas.length === 1, 'duplicou: ' + todas.length);
  });
  const ANCHOR = 'implementation("com.facebook.react:react-android")';

  const template = `apply plugin: "com.android.application"

android {
    namespace '${ANDROID_PACKAGE}'
}

dependencies {
    // The version of react-native is set by the React Native Gradle Plugin
    ${ANCHOR}

    if (hermesEnabled.toBoolean()) {
        implementation("com.facebook.react:hermes-android")
    }
}
`;

  let aplicado;
  check('adiciona a dependencia no app/build.gradle', () => {
    aplicado = gradle({ modResults: { language: 'groovy', contents: template } }).modResults.contents;
    assert(aplicado.includes(`implementation("${DEP}")`), 'nao adicionou a dependencia');
  });

  check('fica DENTRO do bloco dependencies', () => {
    const bloco = aplicado.match(/dependencies \{[\s\S]*?\n\}/)[0];
    assert(bloco.includes(DEP), 'caiu fora do bloco dependencies');
  });

  check('idempotente (o prebuild reaplica os mods)', () => {
    const duas = gradle({ modResults: { language: 'groovy', contents: aplicado } }).modResults.contents;
    assert((duas.match(/webp-android/g) || []).length === 1, 'duplicou a webp-android');
    assert((duas.match(/animated-base/g) || []).length === 1, 'duplicou a animated-base');
  });

  check('CRITICO: completa a dependencia que falta quando a outra ja existe', () => {
    // Este caso me pegou de verdade: a checagem de idempotencia olhava so a
    // webp-android, entao um android/ ja processado nunca recebia a
    // animated-base adicionada depois — o prebuild dizia ok e o build quebrava.
    const soWebp = template.replace(ANCHOR, `${ANCHOR}\n    implementation("com.aureusapps.android:webp-android:1.1.2")`);
    const corrigido = gradle({ modResults: { language: 'groovy', contents: soWebp } }).modResults.contents;
    assert(corrigido.includes('animated-base'), 'nao completou a dependencia que faltava');
    assert((corrigido.match(/webp-android/g) || []).length === 1, 'duplicou a que ja existia');
  });

  check('falha alto se o template do Expo mudar', () => {
    let lancou = false;
    try {
      gradle({ modResults: { language: 'groovy', contents: 'dependencies {\n}\n' } });
    } catch {
      lancou = true;
    }
    assert(lancou, 'aceitou em silencio um build.gradle sem a ancora');
  });

  check('falha alto se o build.gradle virar Kotlin DSL', () => {
    let lancou = false;
    try {
      gradle({ modResults: { language: 'kt', contents: template } });
    } catch {
      lancou = true;
    }
    assert(lancou, 'aceitou um .kts como se fosse Groovy');
  });

  check('a versao fixada e a que foi auditada no AAR', () => {
    // Trocar de versao exige reauditar ABIs, tamanho e transitivas; o teste
    // existe para que a troca seja uma decisao consciente, nao um acidente.
    assert(aplicado.includes('webp-android:1.1.2'), 'versao diferente da auditada');
  });

  check('CRITICO: adiciona animated-base (supertipos do GifImage)', () => {
    // Sem isto o Kotlin nao compila: "Cannot access 'AnimatedImage' which is a
    // supertype of 'GifImage'". O animated-gif entra pelo template do Expo, mas
    // o animated-base e transitiva de runtime dele e fica fora do classpath de
    // compilacao.
    assert(aplicado.includes('com.facebook.fresco:animated-base'), 'nao adicionou o animated-base');
  });

  check('a versao do Fresco segue a do Expo, interpolada pelo Groovy', () => {
    // Em aspas duplas o Groovy interpola ${...}; se virar aspas simples ou se o
    // JS interpolar isso na geracao, a dependencia nao resolve.
    assert(
      aplicado.includes('implementation("com.facebook.fresco:animated-base:${expoLibs.versions.fresco.get()}")'),
      'a interpolacao do Groovy nao sobreviveu: ' +
        (aplicado.match(/animated-base[^\n]*/) || ['(ausente)'])[0],
    );
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

    // Dinamico de proposito: cobre tanto .java quanto .kt sem precisar
    // atualizar uma contagem a cada arquivo nativo novo.
    const esperados = fs
      .readdirSync(path.join(PROJECT_ROOT, 'plugins', 'android'))
      .filter((f) => f.endsWith('.java') || f.endsWith('.kt'))
      .sort();

    check('copia TODOS os fontes nativos para o caminho do applicationId', () => {
      assert(fs.existsSync(javaDir), 'diretorio ausente: ' + javaDir);
      assert(esperados.length > 0, 'nenhum fonte em plugins/android');
      const copiados = fs.readdirSync(javaDir).sort();
      assert(
        JSON.stringify(copiados) === JSON.stringify(esperados),
        'esperava [' + esperados.join(',') + '] e achou [' + copiados.join(',') + ']',
      );
    });

    check('CRITICO: __PACKAGE__ resolvido em todos os fontes', () => {
      for (const file of fs.readdirSync(javaDir)) {
        const texto = fs.readFileSync(path.join(javaDir, file), 'utf8');
        assert(!texto.includes('__PACKAGE__'), file + ' ficou com o token nao resolvido');
        // Java exige ponto e virgula na declaracao de package, Kotlin nao.
        const declaracao = file.endsWith('.kt')
          ? 'package ' + ANDROID_PACKAGE + '.whatsapp'
          : 'package ' + ANDROID_PACKAGE + '.whatsapp;';
        assert(texto.includes(declaracao), file + ' com declaracao de package errada');
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
