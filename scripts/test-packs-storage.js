/**
 * Testes do armazenamento de pacotes (lib/packs.ts).
 *
 * POR QUE ISTO EXISTE: loadPacks decide se os pacotes ja salvos no aparelho
 * continuam sendo encontrados. O caso critico e o FORMATO LEGADO (um array
 * solto, sem versao), que e o que todas as versoes anteriores do app gravaram
 * — se a leitura dele regredir, o usuario abre o app e ve "0 pacotes".
 *
 * Mesma tecnica do test-pack-file.js: transpila com o tsc do projeto e troca
 * os modulos nativos por stubs. Nenhuma dependencia nova.
 *
 *   node scripts/test-packs-storage.js     (ou: npm run test:packs-storage)
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

function transpile() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jambo-packs-'));
  try {
    execFileSync(
      'npx',
      ['tsc', path.join('lib', 'packs.ts'), '--outDir', outDir, '--module', 'commonjs', '--target', 'es2022',
       '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop'],
      { cwd: PROJECT_ROOT, stdio: 'pipe', shell: true },
    );
  } catch {
    // Erros de resolucao de "expo-*" sao esperados sem o tsconfig; o JS sai igual.
  }
  const emitted = path.join(outDir, 'packs.js');
  if (!fs.existsSync(emitted)) throw new Error('tsc nao gerou ' + emitted);
  return emitted;
}

// ------------------------------------------------------------------- stubs

let storage = new Map();
const filesOnDisk = new Map(); // uri -> tamanho em bytes

const asyncStorageStub = {
  getItem: async (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: async (key, value) => {
    storage.set(key, value);
  },
};

const stubs = {
  '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorageStub },
  'expo-file-system': {
    File: class {
      constructor(uri) {
        this.uri = uri;
        this.exists = filesOnDisk.has(uri);
        this.size = filesOnDisk.get(uri) ?? 0;
      }
    },
  },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return stubs[request] ? request : originalResolve.call(this, request, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  return stubs[request] ? stubs[request] : originalLoad.call(this, request, ...rest);
};

const packs = require(transpile());

const KEY = '@app-de-figurinhas/albums';

// ------------------------------------------------------------------ helpers

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

async function checkAsync(nome, fn) {
  try {
    await fn();
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

async function esperaErro(fn, trecho) {
  let lancou = null;
  try {
    await fn();
  } catch (error) {
    lancou = error;
  }
  assert(lancou, 'nao lancou');
  assert(
    lancou instanceof packs.PacksStorageError,
    'tipo errado: ' + lancou.constructor.name + ' (' + lancou.message + ')',
  );
  if (trecho) assert(lancou.message.includes(trecho), 'mensagem: "' + lancou.message + '"');
}

const umPacote = (over) =>
  Object.assign(
    {
      id: 'p1',
      name: 'Gatos',
      author: 'Nikolas',
      iconUri: '/doc/s1.webp',
      stickers: [{ id: 's1', processedUri: '/doc/s1.webp', mode: 'crop', format: 'webp', width: 512, height: 512 }],
    },
    over || {},
  );

(async () => {
  console.log('\n== LEITURA: FORMATO LEGADO (array solto, sem versao) ==');
  await checkAsync('CRITICO: array legado e lido, pacotes nao se perdem', async () => {
    storage = new Map([[KEY, JSON.stringify([umPacote(), umPacote({ id: 'p2', name: 'Cães' })])]]);
    const lidos = await packs.loadPacks();
    assert(lidos.length === 2, 'esperava 2 pacotes, veio ' + lidos.length);
    assert(lidos[0].name === 'Gatos' && lidos[1].name === 'Cães', 'conteudo errado');
  });
  await checkAsync('array legado vazio devolve lista vazia', async () => {
    storage = new Map([[KEY, '[]']]);
    assert((await packs.loadPacks()).length === 0, 'nao veio vazio');
  });

  console.log('\n== LEITURA: FORMATO VERSIONADO ==');
  await checkAsync('payload versionado e lido', async () => {
    storage = new Map([[KEY, JSON.stringify({ schemaVersion: 1, packs: [umPacote()] })]]);
    const lidos = await packs.loadPacks();
    assert(lidos.length === 1 && lidos[0].name === 'Gatos', 'conteudo errado');
  });
  await checkAsync('armazenamento vazio devolve lista vazia, sem erro', async () => {
    storage = new Map();
    assert((await packs.loadPacks()).length === 0, 'nao veio vazio');
  });

  console.log('\n== LEITURA: DADOS INVALIDOS (deve lancar, NUNCA devolver vazio) ==');
  await checkAsync('JSON corrompido lanca PacksStorageError', async () => {
    storage = new Map([[KEY, '{{{ isto nao e json']]);
    await esperaErro(() => packs.loadPacks(), 'corrompidos');
  });
  await checkAsync('schemaVersion do futuro lanca com instrucao de atualizar', async () => {
    storage = new Map([[KEY, JSON.stringify({ schemaVersion: 99, packs: [] })]]);
    await esperaErro(() => packs.loadPacks(), 'versão mais nova');
  });
  await checkAsync('objeto sem campo packs lanca', async () => {
    storage = new Map([[KEY, JSON.stringify({ schemaVersion: 1, dados: [] })]]);
    await esperaErro(() => packs.loadPacks(), 'não reconhece');
  });
  await checkAsync('numero no lugar do payload lanca', async () => {
    storage = new Map([[KEY, '42']]);
    await esperaErro(() => packs.loadPacks());
  });
  await checkAsync('packs nao sendo array lanca', async () => {
    storage = new Map([[KEY, JSON.stringify({ schemaVersion: 1, packs: 'x' })]]);
    await esperaErro(() => packs.loadPacks());
  });

  console.log('\n== ESCRITA E MIGRACAO ==');
  await checkAsync('savePacks grava no formato versionado', async () => {
    storage = new Map();
    await packs.savePacks([umPacote()]);
    const gravado = JSON.parse(storage.get(KEY));
    assert(!Array.isArray(gravado), 'gravou array solto, deveria ser objeto versionado');
    assert(gravado.schemaVersion === packs.STORAGE_SCHEMA_VERSION, 'schemaVersion ausente/errado');
    assert(Array.isArray(gravado.packs) && gravado.packs.length === 1, 'packs errado');
  });
  await checkAsync('round-trip: salvar e ler devolve o mesmo', async () => {
    storage = new Map();
    const original = [umPacote(), umPacote({ id: 'p2', name: 'Memes' })];
    await packs.savePacks(original);
    const lidos = await packs.loadPacks();
    assert(JSON.stringify(lidos) === JSON.stringify(original), 'round-trip alterou os dados');
  });
  await checkAsync('CRITICO: legado -> mutatePacks -> fica versionado, sem perder nada', async () => {
    storage = new Map([[KEY, JSON.stringify([umPacote()])]]);
    const depois = await packs.mutatePacks((atual) => [...atual, umPacote({ id: 'p2', name: 'Novo' })]);
    assert(depois.length === 2, 'perdeu pacote na migracao: ' + depois.length);
    const gravado = JSON.parse(storage.get(KEY));
    assert(gravado.schemaVersion === 1, 'nao migrou para o formato versionado');
    assert(gravado.packs[0].name === 'Gatos', 'perdeu o pacote legado');
  });
  await checkAsync('mutatePacks propaga erro de leitura em vez de sobrescrever', async () => {
    storage = new Map([[KEY, 'json invalido {{{']]);
    await esperaErro(() => packs.mutatePacks(() => []));
    // O importante: o dado ruim NAO foi substituido por uma lista vazia.
    assert(storage.get(KEY) === 'json invalido {{{', 'sobrescreveu os dados em cima de um erro de leitura!');
  });

  console.log('\n== newId ==');
  check('30 ids gerados no mesmo instante sao todos distintos', () => {
    const ids = Array.from({ length: 30 }, () => packs.newId('sticker'));
    assert(new Set(ids).size === 30, 'colidiu: ' + (30 - new Set(ids).size) + ' repetidos');
  });
  check('newId marca o tipo no sufixo', () => {
    assert(packs.newId('pack').endsWith('-pack'), 'sufixo de pack errado');
    assert(packs.newId('sticker').endsWith('-sticker'), 'sufixo de sticker errado');
  });

  console.log('\n== computeReadiness ==');
  check('item de arquivos nao se chama mais "tray" nem fala de icone 96x96', () => {
    filesOnDisk.set('/doc/s1.webp', 1000);
    const r = packs.computeReadiness(umPacote());
    const ids = r.items.map((i) => i.id);
    assert(!ids.includes('tray'), 'ainda existe o item "tray"');
    assert(ids.includes('files'), 'nao existe o item "files": ' + ids.join(','));
    const item = r.items.find((i) => i.id === 'files');
    assert(!item.label.includes('96'), 'rotulo ainda menciona 96x96: ' + item.label);
  });
  check('arquivo ausente no disco e reportado', () => {
    filesOnDisk.clear();
    const r = packs.computeReadiness(umPacote());
    const item = r.items.find((i) => i.id === 'files');
    assert(item.ok === false, 'deveria falhar com arquivo ausente');
    assert(item.label.includes('sumiu'), 'rotulo: ' + item.label);
  });
  check('figurinha acima de 100 KB entra em oversized', () => {
    filesOnDisk.clear();
    filesOnDisk.set('/doc/s1.webp', 150 * 1024);
    const r = packs.computeReadiness(umPacote());
    assert(r.oversized.includes('s1'), 'nao marcou como oversized');
    assert(r.sizes.s1 === 150 * 1024, 'tamanho errado');
  });
  check('pacote com 1 figurinha nao esta pronto (minimo 3)', () => {
    filesOnDisk.clear();
    filesOnDisk.set('/doc/s1.webp', 1000);
    assert(packs.computeReadiness(umPacote()).ready === false, 'disse que esta pronto');
  });

  console.log('\n== ' + pass + ' ok, ' + fail + ' falhas ==');
  process.exit(fail > 0 ? 1 : 0);
})();
