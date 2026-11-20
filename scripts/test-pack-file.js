/**
 * Testes do formato de arquivo de pacote (lib/pack-file.ts).
 *
 * POR QUE ISTO EXISTE: o arquivo .jambo.json e o unico backup das figurinhas e
 * chega ao app de fora (recebido pelo WhatsApp). Uma regressao aqui significa
 * ou perda permanente de pacotes, ou o app engolindo um arquivo invalido.
 *
 * Nao depende de jest nem de nenhuma dependencia nova: transpila o modulo com
 * o tsc que o projeto ja tem e substitui os modulos nativos por stubs.
 *
 *   node scripts/test-pack-file.js      (ou: npm run test:pack-file)
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SOURCE = path.join('lib', 'pack-file.ts');

function transpile() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jambo-pack-file-'));
  try {
    execFileSync(
      'npx',
      ['tsc', SOURCE, '--outDir', outDir, '--module', 'commonjs', '--target', 'es2022',
       '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop'],
      { cwd: PROJECT_ROOT, stdio: 'pipe', shell: true },
    );
  } catch {
    // O tsc sai com erro porque nao resolve "expo-*" nem o alias "@/" sem o
    // tsconfig do projeto — mas ainda emite o JS, que e o que importa aqui.
  }
  const emitted = path.join(outDir, 'pack-file.js');
  if (!fs.existsSync(emitted)) {
    throw new Error(`tsc nao gerou ${emitted}. Rode "npx tsc --noEmit" para ver o erro real.`);
  }
  return emitted;
}

// ------------------------------------------------------------------- stubs

const written = new Map(); // uri -> conteudo
let savedPacks = [];

const stubs = {
  'expo-document-picker': { getDocumentAsync: async () => ({ canceled: true, assets: null }) },
  'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async () => {} },
  'expo-file-system': {
    Paths: { cache: '/cache', document: '/doc' },
    Directory: class {
      constructor() {
        this.exists = true;
      }
      create() {}
    },
    File: class {
      constructor(a, b) {
        this.uri = typeof a === 'string' ? a : '/cache/exports/' + b;
        this.exists = written.has(this.uri);
      }
      create() {}
      delete() {}
      write(content) {
        written.set(this.uri, content);
      }
      async text() {
        return written.get(this.uri);
      }
      async base64() {
        return written.get(this.uri);
      }
    },
  },
  '@/lib/packs': {
    MAX_STICKERS: 30,
    newId: (kind) => 'id-' + kind + '-' + Math.random().toString(36).slice(2, 7),
    mutatePacks: async (fn) => {
      savedPacks = fn(savedPacks);
      return savedPacks;
    },
  },
  '@/lib/stickers': {
    persistStickerFromBase64: (base64, id) => {
      const uri = '/doc/stickers/' + id + '.webp';
      written.set(uri, base64);
      return uri;
    },
    deleteStickerFile: (uri) => written.delete(uri),
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

const pf = require(transpile());

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

function rejeita(nome, raw, esperado) {
  check(nome, () => {
    let aceitou = false;
    try {
      pf.parsePackFile(raw);
      aceitou = true;
    } catch (error) {
      if (!(error instanceof pf.PackFileError)) {
        throw new Error('erro do tipo errado (' + error.constructor.name + '): ' + error.message);
      }
      if (esperado && !error.message.includes(esperado)) {
        throw new Error('mensagem inesperada: "' + error.message + '"');
      }
    }
    if (aceitou) throw new Error('ACEITOU indevidamente');
  });
}

const base = (pack, over) =>
  JSON.stringify(Object.assign({ format: 'jambo-pack', schemaVersion: 1, exportedAt: 1, pack }, over || {}));
const umaFigurinha = [{ mode: 'crop', width: 512, height: 512, webpBase64: 'AAAA' }];
const valido = (over) => base({ name: 'Gatos', author: 'Nikolas', stickers: umaFigurinha }, over);

// -------------------------------------------------------------------- casos

console.log('\n== ENTRADA HOSTIL / CORROMPIDA (deve rejeitar com PackFileError) ==');
rejeita('nao e JSON', 'isto nao e json {{{', 'não é um pacote');
rejeita('JSON mas e um numero', '42');
rejeita('JSON null', 'null');
rejeita('array no lugar de objeto', '[]');
rejeita('string JSON', '"oi"');
rejeita('sem campo format', JSON.stringify({ schemaVersion: 1, pack: {} }));
rejeita('format de outro app', JSON.stringify({ format: 'outro-app', schemaVersion: 1, pack: {} }));
rejeita('schemaVersion do futuro', valido({ schemaVersion: 99 }), 'versão mais nova');
rejeita('schemaVersion nao numerico', valido({ schemaVersion: '1' }));
rejeita('pack ausente', JSON.stringify({ format: 'jambo-pack', schemaVersion: 1 }));
rejeita('pack null', JSON.stringify({ format: 'jambo-pack', schemaVersion: 1, pack: null }));
rejeita('nome vazio', base({ name: '   ', author: 'A', stickers: umaFigurinha }), 'nome ou autor');
rejeita('autor ausente', base({ name: 'N', stickers: umaFigurinha }), 'nome ou autor');
rejeita('sem figurinhas', base({ name: 'N', author: 'A', stickers: [] }), 'nenhuma figurinha');
rejeita('stickers nao e array', base({ name: 'N', author: 'A', stickers: 'x' }));
rejeita(
  'acima de 30 figurinhas',
  base({ name: 'N', author: 'A', stickers: Array.from({ length: 31 }, () => ({ webpBase64: 'A' })) }),
  'no máximo 30',
);
rejeita('figurinha sem imagem', base({ name: 'N', author: 'A', stickers: [{ mode: 'crop' }] }), 'sem imagem');
rejeita('figurinha null', base({ name: 'N', author: 'A', stickers: [null] }), 'inválida');
rejeita('figurinha e string', base({ name: 'N', author: 'A', stickers: ['AAAA'] }), 'inválida');
rejeita(
  'base64 gigante (bomba de memoria)',
  base({ name: 'N', author: 'A', stickers: [{ webpBase64: 'A'.repeat(1024 * 1024 + 1) }] }),
  'grande demais',
);

console.log('\n== ENTRADA VALIDA ==');
check('arquivo valido e aceito', () => {
  const r = pf.parsePackFile(valido());
  if (r.pack.name !== 'Gatos' || r.pack.stickers.length !== 1) throw new Error('conteudo errado');
});
check('nome e autor sao trimados', () => {
  const r = pf.parsePackFile(base({ name: '  Gatos  ', author: ' Nik ', stickers: umaFigurinha }));
  if (r.pack.name !== 'Gatos' || r.pack.author !== 'Nik') throw new Error(r.pack.name + '/' + r.pack.author);
});
check('schemaVersion menor e aceito (compat. retroativa)', () => pf.parsePackFile(valido({ schemaVersion: 0 })));
check('exatamente 30 figurinhas e aceito (limite inclusivo)', () =>
  pf.parsePackFile(base({ name: 'N', author: 'A', stickers: Array.from({ length: 30 }, () => ({ webpBase64: 'A' })) })),
);
check('dimensao invalida cai no padrao 512 em vez de recusar o pacote', () => {
  const r = pf.parsePackFile(base({ name: 'N', author: 'A', stickers: [{ webpBase64: 'A', width: -5, height: 'x' }] }));
  if (r.pack.stickers[0].width !== 512 || r.pack.stickers[0].height !== 512) throw new Error('nao normalizou');
});
check('mode "stretch" e aceito (modo Preencher)', () => {
  const r = pf.parsePackFile(base({ name: 'N', author: 'A', stickers: [{ webpBase64: 'A', mode: 'stretch' }] }));
  if (r.pack.stickers[0].mode !== 'stretch') throw new Error('virou ' + r.pack.stickers[0].mode);
});
check('mode desconhecido cai em "original"', () => {
  const r = pf.parsePackFile(base({ name: 'N', author: 'A', stickers: [{ webpBase64: 'A', mode: 'hackeado' }] }));
  if (r.pack.stickers[0].mode !== 'original') throw new Error(r.pack.stickers[0].mode);
});

(async () => {
  console.log('\n== ROUND-TRIP: exportar -> importar ==');
  const pack = {
    id: 'original-id-local',
    name: 'Memes do Grupo',
    author: 'Nikolas',
    iconUri: '/doc/stickers/s1.webp',
    stickers: [
      { id: 's1', processedUri: '/doc/stickers/s1.webp', mode: 'crop', format: 'webp', width: 512, height: 512 },
      { id: 's2', processedUri: '/doc/stickers/s2.webp', mode: 'original', format: 'webp', width: 512, height: 512 },
    ],
  };
  written.set('/doc/stickers/s1.webp', 'UklGRgAA1');
  written.set('/doc/stickers/s2.webp', 'UklGRgAA2');

  const raw = JSON.stringify(await pf.buildPackFile(pack));

  check('arquivo exportado nao contem ids nem caminhos locais', () => {
    if (raw.includes('original-id-local')) throw new Error('vazou o id do pacote');
    if (raw.includes('/doc/stickers')) throw new Error('vazou caminho do aparelho');
    if (raw.includes('"s1"')) throw new Error('vazou id de figurinha');
  });
  check('arquivo exportado passa pela propria validacao', () => {
    const back = pf.parsePackFile(raw);
    if (back.pack.stickers.length !== 2) throw new Error('perdeu figurinha');
    if (back.pack.stickers[0].webpBase64 !== 'UklGRgAA1') throw new Error('imagem errada');
    if (back.pack.stickers[0].mode !== 'crop' || back.pack.stickers[1].mode !== 'original') {
      throw new Error('modo nao preservado');
    }
    if (back.pack.name !== 'Memes do Grupo' || back.pack.author !== 'Nikolas') throw new Error('metadado perdido');
  });

  const file = await pf.writePackFile(pack);
  check('nome de arquivo sanitizado (espacos -> hifens)', () => {
    if (!file.uri.endsWith('memes-do-grupo.jambo.json')) throw new Error(file.uri);
  });
  const acentuado = await pf.writePackFile({ ...pack, name: 'Ação & Coração' });
  check('acentos removidos do nome do arquivo', () => {
    if (!acentuado.uri.endsWith('acao-coracao.jambo.json')) throw new Error(acentuado.uri);
  });
  const simbolos = await pf.writePackFile({ ...pack, name: '!!!???' });
  check('nome sem letras nao gera arquivo sem nome', () => {
    if (!simbolos.uri.endsWith('pacote.jambo.json')) throw new Error(simbolos.uri);
  });
  const travessia = await pf.writePackFile({ ...pack, name: '../../etc/passwd' });
  check('nome com ../ nao escapa do diretorio', () => {
    if (travessia.uri.includes('..')) throw new Error('PATH TRAVERSAL: ' + travessia.uri);
  });

  // Importacao completa, com o seletor de arquivos stubado.
  savedPacks = [{ id: 'ja-existe', name: 'Memes do Grupo', author: 'Nikolas', iconUri: '/x', stickers: [] }];
  written.set(file.uri, raw);
  stubs['expo-document-picker'].getDocumentAsync = async () => ({
    canceled: false,
    assets: [{ uri: file.uri, name: 'memes.jambo.json', size: raw.length, mimeType: 'application/json' }],
  });
  const importado = await pf.importPackFromFile();

  check('import cria pacote NOVO, sem sobrescrever o homonimo', () => {
    if (savedPacks.length !== 2) throw new Error('esperava 2 pacotes, tem ' + savedPacks.length);
    if (savedPacks[0].id !== 'ja-existe') throw new Error('mexeu no pacote que ja existia');
    if (importado.id === 'ja-existe') throw new Error('reusou o id existente');
  });
  check('import gera ids distintos para cada figurinha', () => {
    const ids = importado.stickers.map((s) => s.id);
    if (new Set(ids).size !== ids.length) throw new Error('IDS COLIDIRAM: ' + ids.join(', '));
  });
  check('import grava as imagens no disco', () => {
    for (const sticker of importado.stickers) {
      if (!written.has(sticker.processedUri)) throw new Error('nao gravou ' + sticker.processedUri);
    }
  });
  check('import define o icone do pacote', () => {
    if (importado.iconUri !== importado.stickers[0].processedUri) throw new Error('icone errado');
  });

  stubs['expo-document-picker'].getDocumentAsync = async () => ({ canceled: true, assets: null });
  const cancelado = await pf.importPackFromFile();
  check('cancelar o seletor devolve null', () => {
    if (cancelado !== null) throw new Error('devolveu ' + JSON.stringify(cancelado));
    if (savedPacks.length !== 2) throw new Error('criou pacote mesmo cancelado');
  });

  console.log('\n== EXPORT COM ARQUIVO FALTANDO NO DISCO ==');
  written.delete('/doc/stickers/s2.webp');
  let lancou = null;
  try {
    await pf.buildPackFile(pack);
  } catch (error) {
    lancou = error;
  }
  check('erro explicativo quando uma figurinha sumiu', () => {
    if (!lancou) throw new Error('nao lancou');
    if (!(lancou instanceof pf.PackFileError)) throw new Error('tipo errado: ' + lancou.constructor.name);
    if (!lancou.message.includes('sumiu do aparelho')) throw new Error('mensagem: ' + lancou.message);
  });

  console.log('\n== ' + pass + ' ok, ' + fail + ' falhas ==');
  process.exit(fail > 0 ? 1 : 0);
})();
