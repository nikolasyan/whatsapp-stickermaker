import { NativeModules } from 'react-native';

import { isAnimatedPack, type Pack } from '@/lib/packs';

export type ExportResult = { status: 'added' | 'cancelled' | 'rejected'; error?: string };

type WhatsAppStickerModule = {
  isWhatsAppAvailable(): Promise<boolean>;
  addStickerPack(config: {
    identifier: string;
    title: string;
    author: string;
    trayImage: string;
    publisherEmail: string;
    publisherURL: string;
    privacyPolicyURL: string;
    licenseURL: string;
    /**
     * Vira `animated_sticker_pack` no metadata.json. A especificacao diz que o
     * campo e "required for animated sticker packs, optional for static".
     */
    animated: boolean;
    // `emojis` e opcional: ausente ou vazio, o modulo nativo aplica o padrao
    // que o WhatsApp exige (ele recusa o pacote com a lista vazia).
    stickers: { url: string; emojis?: string[] }[];
  }): Promise<ExportResult>;
};

const nativeModule = NativeModules.WhatsAppStickerModule as WhatsAppStickerModule | undefined;

/** Falso no iOS e em builds JS-only: o modulo so existe no APK compilado. */
export const isWhatsAppModuleAvailable = Boolean(nativeModule);

const PUBLISHER = {
  publisherEmail: 'nikolasyan@users.noreply.github.com',
  publisherURL: 'https://github.com/nikolasyan/whatsapp-stickermaker',
  privacyPolicyURL: 'https://github.com/nikolasyan/whatsapp-stickermaker',
  licenseURL: 'https://github.com/nikolasyan/whatsapp-stickermaker',
};

export const EXPORT_ERROR_MESSAGES: Record<string, string> = {
  WHATSAPP_NOT_INSTALLED: 'Instale o WhatsApp (ou o WhatsApp Business) para adicionar este pacote.',
  NO_ACTIVITY: 'Mantenha o app aberto enquanto o WhatsApp é chamado e tente de novo.',
  WHATSAPP_OPEN_FAILED: 'Não foi possível abrir a tela de importação do WhatsApp.',
  EXPORT_IN_PROGRESS: 'Já existe uma importação aguardando resposta do WhatsApp.',
  STICKER_PACK_FAILED: 'Falha ao preparar os arquivos das figurinhas.',
};

export function exportErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (EXPORT_ERROR_MESSAGES[code]) return EXPORT_ERROR_MESSAGES[code];
  if (error instanceof Error && error.message) return error.message;
  return 'O WhatsApp não conseguiu importar este pacote.';
}

export async function isWhatsAppAvailable(): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.isWhatsAppAvailable();
}

/**
 * Abre a tela de importacao do WhatsApp. A Promise so resolve quando o usuario
 * volta dessa tela, entao nao coloque timeout em volta desta chamada.
 */
export async function exportPack(pack: Pack): Promise<ExportResult> {
  if (!nativeModule) throw new Error('O módulo nativo do WhatsApp não está disponível nesta build.');
  if (pack.stickers.length === 0) throw new Error('Este pacote está vazio.');
  return nativeModule.addStickerPack({
    identifier: `pack_${pack.id.replace(/[^a-zA-Z0-9_]/g, '_')}`,
    title: pack.name,
    author: pack.author,
    // `iconUri` e a capa do pacote: e o que o app mantem atualizado (ao remover
    // uma figurinha) e o que ja aparece como miniatura na folha de salvar.
    // A exportacao usava stickers[0] e ignorava o campo, entao a capa mostrada
    // no app e a que ia para o WhatsApp podiam divergir.
    trayImage: pack.iconUri || pack.stickers[0].processedUri,
    animated: isAnimatedPack(pack),
    ...PUBLISHER,
    stickers: pack.stickers.map((sticker) => ({
      url: sticker.processedUri,
      // Sem emoji escolhido, o campo vai ausente e o nativo decide o padrao.
      ...(sticker.emojis?.length ? { emojis: sticker.emojis } : {}),
    })),
  });
}
