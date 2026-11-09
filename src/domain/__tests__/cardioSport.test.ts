import { cardioSport } from '../cardioSport';

describe('cardioSport', () => {
  it('reads the sport from the name, without minding case or accents', () => {
    expect(cardioSport('Bici estática')).toBe('bike');
    expect(cardioSport('BICICLETA')).toBe('bike');
    expect(cardioSport('Ciclismo de carretera')).toBe('bike');
    expect(cardioSport('Spinning')).toBe('bike');
    expect(cardioSport('Natación')).toBe('swim');
    expect(cardioSport('Remo ergómetro')).toBe('row');
    expect(cardioSport('Correr')).toBe('run');
    expect(cardioSport('Senderismo')).toBe('hike');
    expect(cardioSport('Ruta por la montaña')).toBe('hike');
    expect(cardioSport('Caminar')).toBe('walk');
    expect(cardioSport('Descanso / Caminar')).toBe('walk');
  });

  it('a word must start with the clue', () => {
    expect(cardioSport('Paso extremo')).toBeNull();
    expect(cardioSport('Elíptica')).toBeNull();
    expect(cardioSport('HIIT')).toBeNull();
  });

  it('the first sport in its order wins when the name says two', () => {
    expect(cardioSport('Andar en bici')).toBe('bike');
    expect(cardioSport('Correr y caminar')).toBe('run');
  });
});
