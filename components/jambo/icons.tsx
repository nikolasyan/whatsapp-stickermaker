import Svg, { Path } from 'react-native-svg';

/** Os mesmos glifos do design doc, mantidos como paths para nao depender de icon fonts. */
const PATHS = {
  plus: ['M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z'],
  plusSmall: ['M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z'],
  folder: ['M4 5h6.2l1.5 2H20a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2z'],
  gear: [
    'M12 8a4 4 0 100 8 4 4 0 000-8zm9.4 5.3-1.9-1.1a7.7 7.7 0 000-2.4l1.9-1.1a.6.6 0 00.2-.8l-1.8-3.1a.6.6 0 00-.8-.2l-1.9 1.1a7.9 7.9 0 00-2-1.2V2.3a.6.6 0 00-.6-.6h-3.6a.6.6 0 00-.6.6v2.2a7.9 7.9 0 00-2 1.2L6.4 4.6a.6.6 0 00-.8.2L3.8 7.9a.6.6 0 00.2.8l1.9 1.1a7.7 7.7 0 000 2.4L4 13.3a.6.6 0 00-.2.8l1.8 3.1a.6.6 0 00.8.2l1.9-1.1a7.9 7.9 0 002 1.2v2.2a.6.6 0 00.6.6h3.6a.6.6 0 00.6-.6v-2.2a7.9 7.9 0 002-1.2l1.9 1.1a.6.6 0 00.8-.2l1.8-3.1a.6.6 0 00-.2-.8z',
  ],
  camera: [
    'M4 5h3.2l1.4-2h6.8l1.4 2H20c1.1 0 2 .9 2 2v11c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2zm8 3.6a4.9 4.9 0 100 9.8 4.9 4.9 0 000-9.8z',
  ],
  cameraAlt: [
    'M9 2h6l1.6 2H20a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h3.4L9 2zm3 5.5A5.5 5.5 0 1017.5 13 5.5 5.5 0 0012 7.5z',
  ],
  frame: [
    'M5 3h6v2H6v5H4V4a1 1 0 011-1zm14 0a1 1 0 011 1v6h-2V5h-5V3h6zM4 14h2v5h5v2H5a1 1 0 01-1-1v-6zm16 0v6a1 1 0 01-1 1h-6v-2h5v-5h2z',
  ],
  back: ['M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z'],
  chevronRight: ['M8.6 6 7.2 7.4l4.6 4.6-4.6 4.6L8.6 18l6-6z'],
  crop: ['M7 17V3H5v2H3v2h2v12h12v2h2v-2h2v-2H7z', 'M9 5h8a2 2 0 012 2v8h-2V7H9z'],
  square: ['M4 4h16v16H4zm2 2v12h12V6z'],
  contrast: ['M12 3a9 9 0 100 18 9 9 0 000-18zm0 2.5a6.5 6.5 0 014.6 11.1L6.9 7.4A6.5 6.5 0 0112 5.5z'],
  text: ['M5 4h14v3h-5.5v13h-3V7H5z'],
  check: ['M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'],
  warning: ['M12 3 2 20h20zm-1 6h2v6h-2zm0 8h2v2h-2z'],
  share: [
    'M18 16.1c-.8 0-1.5.3-2 .8l-7-4.1c0-.3.1-.5.1-.8s0-.5-.1-.8l7-4c.5.4 1.2.7 2 .7a3 3 0 100-6 3 3 0 00-3 3c0 .3 0 .5.1.8l-7 4a3 3 0 100 4.4l7 4.1c0 .2-.1.5-.1.7a3 3 0 103-2.8z',
  ],
  more: ['M12 8a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z'],
  trash: ['M6 7h12l-1 14H7L6 7zm3-4h6l1 2H8l1-2zM4 5h16v2H4z'],
  pencil: ['M3 17.3V21h3.7L17.6 10.1l-3.7-3.7L3 17.3zM20.7 7c.4-.4.4-1 0-1.4l-2.3-2.3a1 1 0 00-1.4 0l-1.8 1.8 3.7 3.7L20.7 7z'],
} as const;

export type JamboIconName = keyof typeof PATHS;

export function JamboIcon({ name, size = 20, color }: { name: JamboIconName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      {PATHS[name].map((d) => (
        <Path key={d} d={d} fill={color} />
      ))}
    </Svg>
  );
}
