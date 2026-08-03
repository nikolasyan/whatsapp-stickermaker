import Svg, { Path } from 'react-native-svg';

/**
 * A marca do Jambo: tres formas apenas — corpo, talo e folha.
 * Abaixo de 16px a folha sai e sobra so a silhueta, como define a identidade.
 */
export function JamboMark({
  size = 24,
  body,
  leaf,
}: {
  size?: number;
  body: string;
  /** Quando omitido, a folha nao e desenhada (util para marca d'agua monocromatica). */
  leaf?: string;
}) {
  const small = size <= 16;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M16 9.6c4.9 0 8.2 3.7 8.2 8.9 0 5.4-3.6 9.5-8.2 9.5s-8.2-4.1-8.2-9.5c0-5.2 3.3-8.9 8.2-8.9Z"
        fill={body}
      />
      <Path d="M16 9.6V5.2" stroke={body} strokeWidth={small ? 2.6 : 2.2} strokeLinecap="round" />
      {!small && leaf ? (
        <Path
          d="M16.8 5.4c1.5-2.1 4.2-2.6 5.8-2.1.1 2.1-1.6 4.3-3.8 4.7-1.4.3-2.3-.3-2.4-1.1-.1-.6.1-1.1.4-1.5Z"
          fill={leaf}
        />
      ) : null}
    </Svg>
  );
}
