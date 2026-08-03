import { NativeModules } from 'react-native';

import type { Pack } from '@/lib/packs';

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
    // Sem `emoji`: o modulo nativo aplica o emoji padrao que o WhatsApp exige.
    stickers: { url: string }[];
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
  return nativeModule.addStickerPack({
    identifier: `pack_${pack.id.replace(/[^a-zA-Z0-9_]/g, '_')}`,
    title: pack.name,
    author: pack.author,
    trayImage: pack.stickers[0].processedUri,
    ...PUBLISHER,
    stickers: pack.stickers.map((sticker) => ({ url: sticker.processedUri })),
  });
}
