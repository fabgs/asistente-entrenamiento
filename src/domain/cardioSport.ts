import { normalizeForSearch } from './format';

/**
 * The sport of a cardio activity, read from its name: it only picks the icon («Bici estática» is
 * done with the timer, but it is a bike). Null when the name says nothing: the icon is then that of
 * how it is recorded.
 */
export type CardioSport = 'bike' | 'swim' | 'row' | 'run' | 'hike' | 'walk';

/**
 * The beginnings of words that tell each sport, checked in this order, so that «Andar en bici» is a
 * bike ride and «Correr y caminar» a run. A word must start with them: «extremo» is not rowing.
 */
const SPORT_WORDS: readonly (readonly [CardioSport, readonly string[]])[] = [
  ['bike', ['bici', 'bike', 'cicl', 'spinning', 'pedale']],
  ['swim', ['nadar', 'natacion', 'piscina', 'swim']],
  ['row', ['remo', 'row']],
  ['run', ['correr', 'carrera', 'running', 'run', 'trote', 'trotar', 'footing', 'jogging', 'sprint']],
  ['hike', ['senderismo', 'trekking', 'hiking', 'montana', 'montanismo']],
  ['walk', ['caminar', 'caminata', 'andar', 'paseo', 'pasear', 'walk']],
];

export function cardioSport(name: string): CardioSport | null {
  // Without accents «ñ» is already «n»: «montaña» reads «montana».
  const words = normalizeForSearch(name).split(/[^a-z0-9]+/).filter(Boolean);
  for (const [sport, starts] of SPORT_WORDS) {
    if (words.some((word) => starts.some((start) => word.startsWith(start)))) return sport;
  }
  return null;
}
