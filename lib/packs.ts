import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

/**
 * Como a imagem foi encaixada no quadrado de 512x512:
 * - `crop`: o usuario recortou um quadrado no editor nativo;
 * - `original`: imagem inteira centralizada, com transparencia nas sobras
 *   (preserva a proporcao, mas um print de celular vira uma faixa estreita);
 * - `stretch`: imagem esticada para ocupar o quadrado todo (distorce).
 */
export type StickerMode = 'crop' | 'original' | 'stretch';

export type Sticker = {
  id: string;
  /**
   * Sem `originalUri`: o campo existia, nunca era lido e guardava o caminho da
   * imagem de origem no CACHE — que clearTransientCache() apaga a cada
   * abertura do app. Era um ponteiro garantidamente quebrado.
   * Para permitir reeditar uma figurinha, o original precisa ser copiado para o
   * diretorio de documentos, nao apenas referenciado.
   */
  processedUri: string;
  mode: StickerMode;
  format: 'webp';
  width: number;
  height: number;
  /**
   * Emojis que o WhatsApp usa na busca de figurinhas. OPCIONAL: ausente ou
   * vazio significa "usar o padrao", que o modulo nativo aplica. O WhatsApp
   * exige de 1 a 3 e recusa o pacote com a lista vazia, entao escolher nunca
   * pode ser um passo obrigatorio do fluxo de criacao.
   */
  emojis?: string[];
  /**
   * Duracao total da animacao em ms. A PRESENCA deste campo e o que define que
   * a figurinha e animada — ausente significa estatica.
   */
  durationMs?: number;
  /** Numero de frames, informativo. */
  frameCount?: number;
};

/** Teto do WhatsApp por figurinha. */
export const MAX_EMOJIS = 3;

export type Pack = {
  id: string;
  name: string;
  author: string;
  iconUri: string;
  stickers: Sticker[];
  /**
   * Pacote de figurinhas animadas.
   *
   * O WhatsApp e explicito: "Sticker packs must contain either static or
   * animated stickers, never a mix of both". Por isso isto e propriedade do
   * PACOTE e nao derivada das figurinhas — um pacote precisa saber o que e
   * mesmo quando esta vazio, e a folha de salvar precisa filtrar por isso
   * antes de qualquer figurinha existir.
   *
   * Ausente significa estatico: e o que todos os pacotes gravados antes deste
   * campo sao, entao nao exige subir o STORAGE_SCHEMA_VERSION.
   */
  animated?: boolean;
  /** Timestamp da ultima importacao confirmada pelo WhatsApp. */
  exportedAt?: number;
};

export function isAnimatedPack(pack: Pack): boolean {
  return pack.animated === true;
}

export function isAnimatedSticker(sticker: Sticker): boolean {
  return typeof sticker.durationMs === 'number';
}

// Mantido do esquema antigo de propósito: renomear a chave apagaria os pacotes ja salvos.
const PACKS_STORAGE_KEY = '@app-de-figurinhas/albums';

/**
 * Versao do formato gravado no AsyncStorage.
 *
 * Suba este numero sempre que o formato de `Pack` mudar de maneira que o
 * codigo antigo nao entenda, e trate a conversao em `migratePacks`. Sem isto,
 * uma mudanca de formato encontra dados antigos e o app ou quebra ou os ignora
 * em silencio — que para o usuario e indistinguivel de ter perdido tudo.
 */
export const STORAGE_SCHEMA_VERSION = 1;

type StoredPayload = { schemaVersion: number; packs: Pack[] };

/**
 * Falha ao LER o armazenamento — diferente de "nao ha pacotes".
 * As telas precisam distinguir os dois: mostrar "0 pacotes" para um erro de
 * leitura faz o usuario acreditar que os pacotes foram apagados.
 */
export class PacksStorageError extends Error {}

export function storageErrorMessage(error: unknown): string {
  if (error instanceof PacksStorageError) return error.message;
  return 'Não foi possível ler seus pacotes neste momento.';
}

/**
 * Limites de tamanho por figurinha, direto da especificacao do WhatsApp:
 * "each static sticker must be less than or equal to 100KB and each animated
 * sticker must be less than or equal to 500KB".
 */
export const MAX_STICKER_BYTES = 100 * 1024;
export const MAX_ANIMATED_STICKER_BYTES = 500 * 1024;

/**
 * "Animation duration should be less than or equal to 10 seconds total" e
 * "frames with minimum duration of 8ms".
 */
export const MAX_ANIMATION_MS = 10_000;
export const MIN_FRAME_MS = 8;

export function maxStickerBytes(animated: boolean): number {
  return animated ? MAX_ANIMATED_STICKER_BYTES : MAX_STICKER_BYTES;
}
export const MIN_STICKERS = 3;
export const MAX_STICKERS = 30;

let idSequence = 0;

/**
 * Id unico para pacotes e figurinhas.
 *
 * `Date.now()` sozinho nao serve: a importacao de um pacote cria ate 30
 * figurinhas no mesmo milissegundo e todas receberiam o mesmo id — o que
 * colide o nome do arquivo .webp no disco e uma figurinha sobrescreve a outra.
 * O contador garante unicidade dentro da sessao; o sufixo aleatorio evita
 * colisao entre sessoes (o contador zera quando o app reinicia).
 */
export function newId(kind: 'pack' | 'sticker'): string {
  idSequence += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${idSequence.toString(36)}-${random}-${kind}`;
}

export async function loadPacks(): Promise<Pack[]> {
  const stored = await AsyncStorage.getItem(PACKS_STORAGE_KEY);
  if (!stored) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new PacksStorageError('Os dados dos pacotes estão corrompidos e não puderam ser lidos.');
  }

  // Formato legado: um array solto, sem versao. E o que as versoes anteriores
  // gravaram, entao qualquer aparelho que ja usou o app cai aqui na primeira
  // leitura. O proximo savePacks regrava no formato novo.
  if (Array.isArray(parsed)) return parsed as Pack[];

  if (typeof parsed === 'object' && parsed !== null) {
    const payload = parsed as Partial<StoredPayload>;
    if (typeof payload.schemaVersion === 'number' && payload.schemaVersion > STORAGE_SCHEMA_VERSION) {
      throw new PacksStorageError(
        'Seus pacotes foram gravados por uma versão mais nova do app. Atualize o Jambo para abri-los.',
      );
    }
    if (Array.isArray(payload.packs)) return payload.packs;
  }

  throw new PacksStorageError('Os dados dos pacotes estão em um formato que o app não reconhece.');
}

export async function savePacks(packs: Pack[]): Promise<void> {
  const payload: StoredPayload = { schemaVersion: STORAGE_SCHEMA_VERSION, packs };
  await AsyncStorage.setItem(PACKS_STORAGE_KEY, JSON.stringify(payload));
}

/** Le, transforma e grava numa operacao so, evitando sobrescrever alteracoes de outra tela. */
export async function mutatePacks(mutate: (packs: Pack[]) => Pack[]): Promise<Pack[]> {
  const next = mutate(await loadPacks());
  await savePacks(next);
  return next;
}

export type ReadinessAction = 'add' | 'compress';

export type ReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  /** Rotulo do atalho de correcao, quando houver algo a resolver. */
  actionLabel?: string;
  action?: ReadinessAction;
};

export type Readiness = {
  items: ReadinessItem[];
  satisfied: number;
  total: number;
  ready: boolean;
  title: string;
  /** Ids das figurinhas que precisam de atencao, para destacar na grade. */
  oversized: string[];
  /** Bytes por figurinha, para exibir "142 KB" no card. */
  sizes: Record<string, number>;
};

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? singular : pluralForm;
}

/**
 * Traduz os requisitos do WhatsApp numa barra de prontidao.
 * Le o tamanho dos arquivos do disco (a API do expo-file-system e sincrona),
 * entao chame dentro de um efeito e nao a cada render.
 */
export function computeReadiness(pack: Pack): Readiness {
  const sizes: Record<string, number> = {};
  const oversized: string[] = [];
  const missingFiles: string[] = [];
  const mismatched: string[] = [];
  const tooLong: string[] = [];

  const animated = isAnimatedPack(pack);
  const byteLimit = maxStickerBytes(animated);

  for (const sticker of pack.stickers) {
    // O WhatsApp proibe misturar estatico e animado num pacote. Isto nao deve
    // acontecer pela UI, mas um arquivo importado pode trazer inconsistencia.
    if (isAnimatedSticker(sticker) !== animated) mismatched.push(sticker.id);
    if ((sticker.durationMs ?? 0) > MAX_ANIMATION_MS) tooLong.push(sticker.id);

    try {
      const file = new File(sticker.processedUri);
      if (!file.exists) {
        missingFiles.push(sticker.id);
        continue;
      }
      sizes[sticker.id] = file.size;
      if (file.size > byteLimit) oversized.push(sticker.id);
    } catch {
      missingFiles.push(sticker.id);
    }
  }

  const count = pack.stickers.length;
  const missingCount = Math.max(0, MIN_STICKERS - count);
  const limitLabel = `${Math.round(byteLimit / 1024)} KB`;

  const items: ReadinessItem[] = [
    {
      id: 'count',
      ok: count >= MIN_STICKERS && count <= MAX_STICKERS,
      label:
        count > MAX_STICKERS
          ? `Remova ${count - MAX_STICKERS} ${plural(count - MAX_STICKERS, 'figurinha', 'figurinhas')}`
          : missingCount > 0
            ? `Faltam ${missingCount} ${plural(missingCount, 'figurinha', 'figurinhas')}`
            : `Mínimo de ${MIN_STICKERS} figurinhas`,
      actionLabel: missingCount > 0 ? 'Adicionar' : undefined,
      action: missingCount > 0 ? 'add' : undefined,
    },
    {
      // Este item verifica a presenca dos ARQUIVOS no disco. Antes era rotulado
      // como "Ícone do pacote 96×96", que descrevia outra coisa: o icone e
      // gerado pelo modulo nativo na hora de exportar e nao ha nada que o
      // usuario possa fazer a respeito dele.
      id: 'files',
      ok: count > 0 && missingFiles.length === 0,
      label:
        missingFiles.length > 0
          ? `${missingFiles.length} ${plural(missingFiles.length, 'arquivo sumiu', 'arquivos sumiram')} do aparelho`
          : 'Todas as figurinhas no aparelho',
    },
    {
      id: 'size',
      ok: oversized.length === 0,
      label:
        oversized.length > 0
          ? `${oversized.length} ${plural(oversized.length, 'figurinha', 'figurinhas')} acima de ${limitLabel}`
          : `Todas abaixo de ${limitLabel}`,
      actionLabel: oversized.length > 0 ? 'Comprimir' : undefined,
      action: oversized.length > 0 ? 'compress' : undefined,
    },
  ];

  // Itens condicionais: entram so quando ha algo a dizer. Um item que nunca
  // falha num pacote estatico seria ruido — e mexeria no denominador da barra.
  if (mismatched.length > 0) {
    items.push({
      id: 'kind',
      ok: false,
      label: animated
        ? `${mismatched.length} ${plural(mismatched.length, 'figurinha estática', 'figurinhas estáticas')} num pacote animado`
        : `${mismatched.length} ${plural(mismatched.length, 'figurinha animada', 'figurinhas animadas')} num pacote estático`,
    });
  }

  if (animated) {
    items.push({
      id: 'duration',
      ok: tooLong.length === 0,
      label:
        tooLong.length > 0
          ? `${tooLong.length} ${plural(tooLong.length, 'animação passa', 'animações passam')} de ${MAX_ANIMATION_MS / 1000} s`
          : `Animações até ${MAX_ANIMATION_MS / 1000} s`,
    });
  }

  const satisfied = items.filter((item) => item.ok).length;
  const ready = satisfied === items.length;

  return {
    items,
    satisfied,
    total: items.length,
    ready,
    title: ready ? 'Pronto pra exportar' : satisfied >= items.length - 1 ? 'Quase pronto' : 'Faltam ajustes',
    oversized,
    sizes,
  };
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}
