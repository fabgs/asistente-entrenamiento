import seedJson from '../../data/seed/seed.json';
import type { SeedData } from './seedTypes';

/**
 * The original Excel data (routines, cardio, diet, history): fixtures for tests and the
 * "Cargar datos de prueba" button of development builds. Release builds never import it.
 */
export const DEMO_SEED = seedJson as SeedData;
