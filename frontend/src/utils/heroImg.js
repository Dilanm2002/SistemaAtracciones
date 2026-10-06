/**
 * Imágenes fijas del sitio en varios anchos y formatos (MOV-001). Se importan desde src/assets,
 * así Vite les pone un hash en el nombre y se sirven con caché inmutable de 1 año (/assets/).
 */
import a640 from '../assets/img/hero-640.avif';
import a960 from '../assets/img/hero-960.avif';
import a1280 from '../assets/img/hero-1280.avif';
import a1920 from '../assets/img/hero-1920.avif';
import w640 from '../assets/img/hero-640.webp';
import w960 from '../assets/img/hero-960.webp';
import w1280 from '../assets/img/hero-1280.webp';
import w1920 from '../assets/img/hero-1920.webp';
import j640 from '../assets/img/hero-640.jpg';
import j960 from '../assets/img/hero-960.jpg';
import j1280 from '../assets/img/hero-1280.jpg';
import j1920 from '../assets/img/hero-1920.jpg';
import auth960 from '../assets/img/auth-960.webp';
import auth1440 from '../assets/img/auth-1440.webp';

const set = (...pares) => pares.map(([url, w]) => `${url} ${w}w`).join(', ');

export const HERO = {
  avif: set([a640, 640], [a960, 960], [a1280, 1280], [a1920, 1920]),
  webp: set([w640, 640], [w960, 960], [w1280, 1280], [w1920, 1920]),
  jpg: set([j640, 640], [j960, 960], [j1280, 1280], [j1920, 1920]),
  jpg1280: j1280,
};

export const AUTH_BG = { w960: auth960, srcSet: set([auth960, 960], [auth1440, 1440]) };
