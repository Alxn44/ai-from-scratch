// Datos canónicos del sitio para SEO/AEO. Una sola fuente: si cambia el dominio,
// cambia aquí y lo heredan robots, sitemap, llms.txt, canonical, OG y JSON-LD.
export const SITE = (import.meta.env.PUBLIC_SITE ?? process.env.PUBLIC_SITE ?? 'http://localhost:4321').replace(/\/+$/, '');
export const MARCA = 'IA desde cero';
export const AUTOR = 'Alejandro Padrón';
export const ORG = 'Alpadev';
export const CORREO = 'founder.alpadev@gmail.com';
export const PRECIO = '9.99';
export const MONEDA = 'USD';
export const LECCIONES = 12;
export const LABS = 36;

/** Rutas públicas indexables. Todo lo demás vive detrás de sesión. */
export const PUBLICAS = ['/', '/login', '/registro', '/pago', '/terminos', '/privacidad', '/soporte'];

/** Rutas que no deben indexarse nunca (privadas o de un solo uso). */
export const PRIVADAS = ['/panel', '/curso', '/leccion', '/perfil', '/ajustes', '/logros', '/ranking',
  '/tutor', '/admin', '/recuperar', '/pago/gracias', '/pago/error', '/api'];
