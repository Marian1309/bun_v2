const CHANNEL_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const WILDCARD = "*";

export type ChannelPatterns = { exact: Set<string>; prefixes: string[] };

export const isChannelName = (value: string): boolean => CHANNEL_NAME_PATTERN.test(value);

/** `news.*` matches every channel starting with `news.`, a lone `*` matches all; anything else is an exact name. */
export const compilePatterns = (patterns: string[]): ChannelPatterns => {
  const exact = new Set<string>();
  const prefixes: string[] = [];

  for (const pattern of patterns) {
    if (pattern.endsWith(WILDCARD)) prefixes.push(pattern.slice(0, -WILDCARD.length));
    else exact.add(pattern);
  }

  return { exact, prefixes };
};

type IsAllowedInput = { patterns: ChannelPatterns; channel: string };

export const isAllowed = ({ patterns, channel }: IsAllowedInput): boolean =>
  patterns.exact.has(channel) || patterns.prefixes.some((prefix) => channel.startsWith(prefix));
