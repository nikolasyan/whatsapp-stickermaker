/**
 * Tokens do design "Jambo Sticker Maker" (Jambo App v3).
 *
 * Regras da identidade que o resto do app depende:
 * - O verde do WhatsApp (whatsapp) e reservado exclusivamente ao botao de exportar.
 * - Nenhum cinza neutro: os degraus de profundidade do escuro sao ameixa.
 * - Numeros e metadados usam JetBrains Mono; titulos usam Outfit; corpo, Nunito Sans.
 */

export type JamboPalette = {
  bg: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  borderDashed: string;
  /** Cor de acao principal (vermelho jambo no claro, rosa no escuro). */
  accent: string;
  /** Texto/icone sobre `accent`. */
  onAccent: string;
  /** Variante suave do accent, para icones e textos secundarios de enfase. */
  accentSoft: string;
  /** Fundo de item selecionado (aba de ferramenta ativa, emoji escolhido). */
  accentMuted: string;
  leaf: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  warning: string;
  warningSurface: string;
  success: string;
  successSurface: string;
  /** Xadrez que representa transparencia, em tons de jambo. */
  checkerLight: string;
  checkerDark: string;
  tabBar: string;
  tabBarBorder: string;
  scrim: string;
};

const dark: JamboPalette = {
  bg: '#060305',
  surface: '#150C10',
  surfaceElevated: '#1E1116',
  border: '#33202A',
  borderDashed: '#4A2A35',
  accent: '#FF5C7C',
  onAccent: '#2A0710',
  accentSoft: '#FF9BA8',
  accentMuted: '#3B141F',
  leaf: '#4FD98E',
  text: '#FFF2EF',
  textSecondary: '#C9A2AC',
  textMuted: '#A98692',
  warning: '#E8A94A',
  warningSurface: '#3D2A0C',
  success: '#4FD98E',
  successSurface: '#0F3A24',
  checkerLight: '#2A1720',
  checkerDark: '#160D12',
  tabBar: '#0C0709',
  tabBarBorder: '#221419',
  scrim: 'rgba(4,2,3,0.72)',
};

const light: JamboPalette = {
  bg: '#FFF9F6',
  surface: '#FFFFFF',
  surfaceElevated: '#FFF3EF',
  border: '#E3C9C4',
  borderDashed: '#E3A9B0',
  accent: '#A3122E',
  onAccent: '#FFF9F6',
  accentSoft: '#A3122E',
  accentMuted: '#FFE9EC',
  leaf: '#1F6B45',
  text: '#2A1116',
  textSecondary: '#5C3A40',
  textMuted: '#8A6068',
  warning: '#9A6414',
  warningSurface: '#FBEBD2',
  success: '#14532D',
  successSurface: '#DFF4E8',
  checkerLight: '#FFE0E5',
  checkerDark: '#FFF9F6',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E3C9C4',
  scrim: 'rgba(74,14,30,0.55)',
};

export const JamboColors = { light, dark };

/** Verde do WhatsApp — usar somente no botao de exportacao. */
export const WHATSAPP_GREEN = '#25D366';
export const WHATSAPP_GREEN_ON = '#06331A';

export const JamboFonts = {
  /** Titulos. */
  display: 'Outfit_800ExtraBold',
  displaySemi: 'Outfit_700Bold',
  /** Corpo. */
  body: 'NunitoSans_400Regular',
  bodySemi: 'NunitoSans_600SemiBold',
  bodyBold: 'NunitoSans_700Bold',
  /** Numeros, dimensoes, tamanhos de arquivo. */
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

export const JamboRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
  pill: 99,
} as const;

export const JamboSpacing = {
  screenX: 24,
  screenTight: 16,
  gap: 10,
} as const;
