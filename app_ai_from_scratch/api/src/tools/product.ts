// Family `producto` — what is in no table: price, routes, support, settings, PDF,
// privacy. 7 tools.
//
// Almost half of what gets asked over chat is of this kind, and it is exactly
// where a model improvises. Every answer here comes from src/product.ts, which is
// one declared place somebody can correct.
//
// The `descripcion` and `nota` strings stay Spanish: they are read by the model
// (docs/NAMING.md).
import { many, one } from '../data.ts';
import {
  HOW_IT_WORKS, PRICE, ROUTES, SUPPORT, faqFor, inLanguage, routesFor,
} from '../product.ts';
import { MAX_RANK } from '../achievements.ts';
import { FREE_LESSONS, TOTAL_LABS, language, me } from './access.ts';
import type { Ctx, Registry, ToolResult } from './access.ts';

export const PRODUCT_TOOLS: Registry = {

  como_funciona: {
    familia: 'producto', publico: true,
    descripcion: 'Cómo funciona la plataforma: lecciones, labs, logros, ranking y ligas. Para «¿qué es esto?» y «¿cómo se usa?».',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const lang = language(ctx, null);
      return {
        pasos: inLanguage(HOW_IT_WORKS, lang),
        cifras: { lecciones: 12, labs: TOTAL_LABS, logros: 48, rangos: MAX_RANK, leccionesLibres: FREE_LESSONS },
        rutas: ROUTES.slice(0, 6).map((r) => ({ ruta: r.ruta, que: inLanguage(r.que, lang) })),
      };
    },
  },

  donde_encuentro: {
    familia: 'producto', publico: true,
    descripcion: 'En qué página de la plataforma se hace algo. Para «¿dónde cambio el idioma?», «¿dónde veo mi puesto?». Devuelve la ruta exacta.',
    args: { consulta: 'texto libre: «cambiar el tema», «descargar el pdf»' },
    async fn(ctx: Ctx, { consulta }): Promise<ToolResult> {
      const lang = language(ctx, null);
      const q = String(consulta ?? '');
      const found = routesFor(q, lang, 3);
      if (found.length) return { consulta: q, rutas: found };
      return {
        consulta: q, rutas: [],
        todas: ROUTES.map((r) => ({ ruta: r.ruta, que: inLanguage(r.que, lang) })),
        nota: 'No hay una página para eso. Ofrece la lista en vez de inventar una ruta.',
      };
    },
  },

  precio_y_compra: {
    familia: 'producto', publico: false,
    descripcion: 'Cuánto cuesta, qué incluye, la garantía y si esta persona ya lo compró. El precio sale del mismo sitio que el checkout.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      const lang = language(ctx, null);
      return {
        yaComprado: !!u.paid,
        precio: { monto: PRICE.monto, moneda: PRICE.moneda, tipo: PRICE.tipo },
        garantiaDias: PRICE.garantiaDias,
        pasarela: PRICE.pasarela,
        incluye: inLanguage(PRICE.incluye, lang),
        leccionesLibres: PRICE.leccionesLibres,
        ruta: u.paid ? '/curso' : '/pago',
        nota: u.paid ? 'Ya compró: no le ofrezcas comprar otra vez.' : undefined,
      };
    },
  },

  mis_datos_y_privacidad: {
    familia: 'producto', publico: false,
    descripcion: 'Qué guarda la plataforma de esta persona, qué puede ver el agente y cómo borrar la cuenta. Para «¿qué sabes de mí?».',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      const [attempts, questionAttempts, achievements, alias] = await Promise.all([
        one<{ intentos: number }>('attempt.count_mine', {}, ctx.userId),
        one<{ intentos: number }>('qattempt.count_mine', {}, ctx.userId),
        many<{ code: string }>('achievement.codes', {}, ctx.userId),
        one<{ alias: string }>('ranking.mine', {}, ctx.userId),
      ]);
      return {
        deTi: {
          nombreDePila: String(u.name).split(' ')[0], rol: u.role, idioma: u.lang, tema: u.theme,
          pagado: !!u.paid, cuentaDesde: u.created_at,
          intentosGuardados: (attempts?.intentos ?? 0) + (questionAttempts?.intentos ?? 0),
          logros: achievements.length, aliasPublico: alias?.alias ?? null,
        },
        loQueElAgenteNoVe: ['el correo', 'la contraseña', 'los datos del pago', 'los datos de cualquier otra persona'],
        loQuePuedeVerOtraPersona: alias?.alias
          ? ['tu alias y tu avance en el ranking y la liga']
          : ['nada: no estás apuntado al ranking'],
        chat: 'El texto de esta conversación se manda al proveedor de IA que atiende el modo IA. El modo normal no sale del servidor.',
        borrado: { ruta: '/perfil', comoEs: 'Pide tu contraseña. El correo queda libre y tus intentos se conservan sin nombre.' },
        rutas: ['/privacidad', '/perfil'],
      };
    },
  },

  descargar_pdf: {
    familia: 'producto', publico: false,
    descripcion: 'Si esta persona puede descargar el PDF del curso, en qué idiomas y desde dónde.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      return {
        puede: !!u.paid, idiomas: ['es', 'en'], ruta: '/perfil',
        porQue: u.paid ? 'La compra incluye el PDF.' : 'El PDF va con la compra: sin ella la descarga responde «requiere compra».',
        nota: 'Si el archivo todavía no está generado, la descarga responde 503 y lo dice; no prometas un archivo que no está.',
      };
    },
  },

  soporte: {
    familia: 'producto', publico: true,
    descripcion: 'Qué hacer cuando algo no funciona: responde el problema frecuente que casa y, si no, cómo escribirle a una persona.',
    args: { tema: 'opcional · el problema en palabras de la persona' },
    async fn(ctx: Ctx, { tema }): Promise<ToolResult> {
      const lang = language(ctx, null);
      const q = String(tema ?? '');
      const found = q ? faqFor(q, lang, 3) : [];
      return {
        tema: q || null,
        respuestas: found,
        humano: { ruta: SUPPORT.ruta, que: inLanguage(SUPPORT.que, lang), antesDeEscribir: inLanguage(SUPPORT.antesDeEscribir, lang) },
        nota: found.length ? undefined : 'No hay una respuesta frecuente para esto: manda a /soporte en vez de improvisar una solución técnica.',
      };
    },
  },

  ajustes: {
    familia: 'producto', publico: false,
    descripcion: 'Idioma y tema que tiene puestos, qué valores existen y dónde se cambian.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      return {
        idioma: u.lang, tema: u.theme,
        idiomasDisponibles: ['es', 'en', 'fr', 'pt', 'auto'],
        temasDisponibles: ['dark', 'paper', 'auto'],
        queSignificaAuto: '«auto» sigue al dispositivo: el idioma del navegador y prefers-color-scheme.',
        ruta: '/ajustes',
        nota: 'fr y pt están aceptados en el API; si falta el diccionario, la interfaz cae al español y lo avisa.',
      };
    },
  },
};
