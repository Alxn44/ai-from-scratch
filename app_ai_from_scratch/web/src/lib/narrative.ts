// Narrativa por mercado. No es un truco de marketing: cada región llega con una
// objeción distinta y con medios de pago distintos, y prometer un medio que no
// existe es peor que no decir nada.
//
//   co     · Medellín, PSE y efectivo. El precio en dólares hay que explicarlo.
//   latam · mismo idioma, sin PSE ni Efecty: tarjeta y wallet.
//   us     · el precio es la objeción invertida: «¿tan barato, qué tiene?».
//   eu     · derecho de retracto de 14 días y privacidad son el argumento.
//   global · neutra: nada que no sea verificable en cualquier país.
import type { Mercado } from './region';

type Copy = {
  eyebrow: string; titular: string; sub: string;
  prueba: string[];        // señales de confianza, 3
  pagoTit: string; pagoTxt: string; medios: string[];
  garantiaTit: string; garantiaTxt: string;
  moneda: string;
};

export const NARRATIVA: Record<Mercado, { es: Copy; en: Copy }> = {
  co: {
    es: {
      eyebrow: 'HECHO EN MEDELLÍN',
      titular: 'La IA explicada como te la explicaría un parcero que sabe de verdad.',
      sub: 'Sin inglés técnico, sin universidad de por medio y sin promesas de volverte millonario. Doce lecciones y treinta y seis labs.',
      prueba: ['Lo escribió una persona con nombre y correo, en Medellín.', '35.000 COP al mes. Sin permanencia: cancelas en un clic.', 'PSE, efectivo en Efecty, tarjeta o wallet.'],
      pagoTit: 'Cómo pagas desde Colombia',
      pagoTxt: 'El cobro lo procesa Mercado Pago y el precio está en pesos: 35.000 COP es lo que te aparece en el extracto, sin conversión y sin comisión de cambio.',
      medios: ['Tarjeta', 'PSE · débito', 'Efectivo · Efecty', 'Mercado Pago'],
      garantiaTit: 'Garantía de 14 días',
      garantiaTxt: 'Escribes al correo y se devuelve. Sin formularios, sin llamada de retención.',
      moneda: '35.000 COP al mes · en pesos, sin conversión',
    },
    en: {
      eyebrow: 'MADE IN MEDELLÍN',
      titular: 'AI explained the way a knowledgeable friend would explain it.',
      sub: 'No technical English, no university required and no promises of getting rich. Twelve lessons and thirty-six labs.',
      prueba: ['Written by one person with a name and an email, in Medellín.', '35,000 COP a month. No minimum term: cancel in one click.', 'Card, PSE, cash at Efecty or the Mercado Pago wallet.'],
      pagoTit: 'How you pay from Colombia',
      pagoTxt: 'Mercado Pago processes the charge and the price is in Colombian pesos: 35,000 COP is what lands on the statement, with no conversion and no FX fee.',
      medios: ['Card', 'PSE · debit', 'Cash · Efecty', 'Mercado Pago'],
      garantiaTit: '14-day guarantee',
      garantiaTxt: 'You email us and it is refunded. No forms, no retention call.',
      moneda: '35,000 COP a month · in pesos, no conversion',
    },
  },
  latam: {
    es: {
      eyebrow: 'PARA TODA LATINOAMÉRICA',
      titular: 'Entender la IA sin que te la expliquen en inglés.',
      sub: 'El mismo español de todos los días, para gente que trabaja y no va a hacer una maestría. Doce lecciones, treinta y seis labs.',
      prueba: ['Contenido en español e inglés, lo cambias en un clic.', '35.000 COP al mes, cancelas cuando quieras.', 'Responde una persona, en menos de 24 h hábiles.'],
      pagoTit: 'Cómo pagas desde tu país',
      pagoTxt: 'El cobro lo procesa Mercado Pago con tarjeta o su wallet. PSE y Efecty son solo de Colombia. Si tu tarjeta rechaza el cobro internacional, llama a tu banco y autorízalo: es lo más común.',
      medios: ['Tarjeta', 'Mercado Pago'],
      garantiaTit: 'Garantía de 14 días',
      garantiaTxt: 'Sin explicar por qué y por el mismo medio de pago.',
      moneda: '35.000 COP al mes · lo convierte tu banco',
    },
    en: {
      eyebrow: 'FOR ALL OF LATIN AMERICA',
      titular: 'Understand AI without having it explained to you in English.',
      sub: 'Everyday Spanish and English, for people with jobs who are not about to start a master’s. Twelve lessons, thirty-six labs.',
      prueba: ['Content in Spanish and English, switched in one click.', '35,000 COP a month, cancel whenever you want.', 'A person answers, in under 24 business hours.'],
      pagoTit: 'How you pay from your country',
      pagoTxt: 'Mercado Pago processes the charge by card or its wallet. PSE and Efecty are Colombia-only. If your card blocks the international charge, call your bank and authorise it: that is the usual cause.',
      medios: ['Card', 'Mercado Pago'],
      garantiaTit: '14-day guarantee',
      garantiaTxt: 'No reason needed, refunded through the same method.',
      moneda: '35,000 COP a month · converted by your bank',
    },
  },
  us: {
    es: {
      eyebrow: 'CURSO EN ES · EN',
      titular: 'Fundamentos de IA claros, no un bootcamp de seis semanas.',
      sub: 'Doce lecciones, treinta y seis labs y un PDF. Sin permanencia, sin upsell y sin certificado inflado.',
      prueba: ['35.000 COP al mes. El precio no es un gancho: no hay plan pro.', 'Cero analítica y cero anuncios: tres cookies y nada más.', 'Devolución de 14 días, sin preguntas.'],
      pagoTit: 'Cómo pagas desde Estados Unidos',
      pagoTxt: 'El cobro lo procesa Mercado Pago con tarjeta internacional. Si tu banco rechaza un cargo de Colombia, escríbenos y te mandamos un enlace alterno el mismo día.',
      medios: ['Tarjeta internacional'],
      garantiaTit: '14-day refund',
      garantiaTxt: 'Un correo y se devuelve completo. No hay preguntas de salida.',
      moneda: '35.000 COP al mes · lo convierte tu banco',
    },
    en: {
      eyebrow: 'COURSE IN EN · ES',
      titular: 'Clear AI fundamentals, not a six-week bootcamp.',
      sub: 'Twelve lessons, thirty-six labs and a PDF. No minimum term, no upsell and no inflated certificate.',
      prueba: ['35,000 COP a month. The price is not bait: there is no pro tier.', 'Zero analytics and zero ads: three cookies, nothing else.', '14-day refund, no questions.'],
      pagoTit: 'How you pay from the United States',
      pagoTxt: 'Mercado Pago processes the charge on an international card. If your bank declines a charge from Colombia, email us and we send an alternative link the same day.',
      medios: ['International card'],
      garantiaTit: '14-day refund',
      garantiaTxt: 'One email and it is refunded in full. No exit questions.',
      moneda: '35,000 COP a month · converted by your bank',
    },
  },
  eu: {
    es: {
      eyebrow: 'UE · DERECHO DE RETRACTO DE 14 DÍAS',
      titular: 'Fundamentos de IA, sin analítica y sin banner de cookies.',
      sub: 'Doce lecciones y treinta y seis labs. Tus datos: nombre, correo y tu progreso. Nada más, y no se vende a nadie.',
      prueba: ['Retracto de 14 días conforme a la Directiva 2011/83/UE.', 'Tres cookies necesarias, cero terceros, cero rastreo.', 'Puedes borrar la cuenta y todos tus datos desde Ajustes.'],
      pagoTit: 'Cómo pagas desde la Unión Europea',
      pagoTxt: 'El cobro lo procesa Mercado Pago con tarjeta internacional; el vendedor está en Colombia. Si tu banco rechaza el cargo, escríbenos y resolvemos el mismo día. El IVA de tu país, si aplica, corre por cuenta del comprador.',
      medios: ['Tarjeta internacional'],
      garantiaTit: 'Retracto de 14 días',
      garantiaTxt: 'Es tu derecho legal, y además nuestra política: no pedimos motivo.',
      moneda: '35.000 COP al mes · lo convierte tu banco',
    },
    en: {
      eyebrow: 'EU · 14-DAY RIGHT OF WITHDRAWAL',
      titular: 'AI fundamentals, with no analytics and no cookie banner.',
      sub: 'Twelve lessons and thirty-six labs. Your data: name, email and your progress. Nothing else, and it is sold to nobody.',
      prueba: ['14-day withdrawal under Directive 2011/83/EU.', 'Three necessary cookies, zero third parties, zero tracking.', 'You can delete your account and all your data from Settings.'],
      pagoTit: 'How you pay from the European Union',
      pagoTxt: 'Mercado Pago processes the charge on an international card; the seller is in Colombia. If your bank declines it, email us and we fix it the same day. Any VAT in your country is the buyer’s responsibility.',
      medios: ['International card'],
      garantiaTit: '14-day withdrawal',
      garantiaTxt: 'It is your statutory right, and our policy too: we never ask why.',
      moneda: '35,000 COP a month · converted by your bank',
    },
  },
  global: {
    es: {
      eyebrow: 'FUNDAMENTOS · VOL. 1',
      titular: 'La IA explicada para quien empieza de cero.',
      sub: 'Doce lecciones y treinta y seis labs que se resuelven dentro de la lección. Español e inglés.',
      prueba: ['35.000 COP al mes, cancelas cuando quieras.', 'Devolución de 14 días, sin preguntas.', 'Contenido en español e inglés.'],
      pagoTit: 'Cómo se paga',
      pagoTxt: 'El cobro lo procesa Mercado Pago. Los datos de tu tarjeta van directo a ellos: la plataforma nunca los ve.',
      medios: ['Tarjeta', 'Mercado Pago'],
      garantiaTit: 'Garantía de 14 días',
      garantiaTxt: 'Escribes y se devuelve, por el mismo medio de pago.',
      moneda: '35.000 COP al mes · lo convierte tu banco',
    },
    en: {
      eyebrow: 'FUNDAMENTALS · VOL. 1',
      titular: 'AI explained for people starting from zero.',
      sub: 'Twelve lessons and thirty-six labs, completed inside each lesson. Spanish and English.',
      prueba: ['35,000 COP a month, cancel whenever you want.', '14-day refund, no questions.', 'Content in Spanish and English.'],
      pagoTit: 'How payment works',
      pagoTxt: 'Mercado Pago processes the charge. Your card details go straight to them: the platform never sees them.',
      medios: ['Card', 'Mercado Pago'],
      garantiaTit: '14-day guarantee',
      garantiaTxt: 'You write and it is refunded, through the same method.',
      moneda: '35,000 COP a month · converted by your bank',
    },
  },
};

/** Solo hay copy en es y en. Cualquier otro idioma cae al inglés, que es la
 *  variante más neutra para un mercado que no habla español. */
export const narrativaDe = (mercado: Mercado, lang: string) =>
  NARRATIVA[mercado][lang === 'es' ? 'es' : 'en'];
