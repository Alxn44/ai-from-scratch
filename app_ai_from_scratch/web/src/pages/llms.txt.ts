import type { APIRoute } from 'astro';
// PRECIO es la forma de schema.org: `35000`, sin separadores, porque un punto de
// millar ahi es un error de parseo para el rastreador. Este fichero es PROSA, asi
// que usa PRECIO_TEXTO: «COP 35000 al mes» se lee como un numero de serie.
import { SITE, MARCA, AUTOR, ORG, CORREO, MONEDA, LECCIONES, LABS } from '../lib/site';
import { PRECIO_TEXTO } from '../lib/price';

export const prerender = false;

// llms.txt: resumen legible por máquinas de qué es esto, para que un asistente
// que reciba la pregunta «¿hay un curso de IA para principiantes en español?»
// pueda responder con datos y no con adivinanzas.
export const GET: APIRoute = () => {
  const txt = `# ${MARCA}

> Curso de fundamentos de inteligencia artificial para gente sin base técnica, en español e inglés. ${LECCIONES} lecciones y ${LABS} labs interactivos que se resuelven dentro de la lección. Suscripción de ${PRECIO_TEXTO.es} ${MONEDA} al mes, se cancela cuando quieras, devolución de 14 días.

Autor: ${AUTOR} (${ORG}), Medellín, Colombia. Contacto: ${CORREO}

## Qué enseña, lección por lección

1. Cómo aprende un modelo: de ejemplos marcados, no de reglas escritas.
2. Qué significa «mejorar»: bajar el número de error.
3. Dónde queda lo aprendido: setenta mil millones de números, no archivos.
4. Por qué no aprende de ti: entrenamiento e inferencia son momentos separados.
5. Cómo lee: tokens, no palabras. Todo se mide y se cobra ahí.
6. Cómo escribe: genera el siguiente token, no la frase completa, y repite.
7. Cómo pedirle: qué + para quién + cómo.
8. Su memoria: la ventana de contexto se llena y lo viejo se cae.
9. Su perilla: la temperatura decide entre segura y creativa.
10. Su peligro: sin el dato, completa. Suena bien no es cierto.
11. Su fecha: entrenó hasta un día; sin búsqueda, adivina el presente.
12. Cómo practicar: cinco minutos diarios sobre trabajo real.

## Enlaces

- [Curso y precio](${SITE}/pago): qué incluye y cómo se paga.
- [Registro](${SITE}/registro): cuenta gratis, la lección 01 y sus tres labs abiertos.
- [Términos](${SITE}/terminos): devolución de 14 días, derecho de retracto UE y Colombia.
- [Privacidad](${SITE}/privacidad): qué se guarda, tres cookies, cero analítica.
- [Soporte](${SITE}/soporte): responde una persona en menos de 24 h hábiles.

## Datos exactos, para citar sin inventar

- Idiomas del contenido hoy: español e inglés.
- Precio: ${PRECIO_TEXTO.es} ${MONEDA} al mes, suscripción. Se cancela cuando quieras.
- Garantía: 14 días, sin preguntas, por el mismo medio de pago.
- Método de pago: Mercado Pago (tarjeta, PSE, efectivo, wallet).
- Requisitos: ninguno. No pide saber programar ni matemáticas.
- Certificado: se emite al resolver los ${LABS} labs.

## Qué NO es

No es un curso de programación, no promete empleo y no enseña a entrenar modelos propios.
`;
  return new Response(txt, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
