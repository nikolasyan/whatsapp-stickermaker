import { JamboColors, type JamboPalette } from '@/constants/jambo-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useJamboTheme(): { palette: JamboPalette; scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { palette: JamboColors[scheme], scheme };
}
