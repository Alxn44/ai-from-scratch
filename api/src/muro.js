// El muro de pago. Una sola regla, en un solo fichero, porque la contestan tres
// sitios distintos: el indice de lecciones, el intento de un lab y ahora tambien
// los medios de cada leccion.
//
// Vivia dentro de `server.js` como un `const` privado. Salio de ahi cuando el
// plugin de medios necesito la misma respuesta: dos copias de un muro es un muro
// que un dia deja de coincidir consigo mismo, y el que se equivoque sera el que
// nadie mire.

/** Lecciones abiertas sin comprar. La 01 y sus tres labs son la muestra. */
export const LECCIONES_LIBRES = 1;

/** Tutores y admins ven todo: su trabajo es acompañar, no comprar. */
export const conAcceso = (u, n) => !!u.paid || u.role !== 'student' || Number(n) <= LECCIONES_LIBRES;
