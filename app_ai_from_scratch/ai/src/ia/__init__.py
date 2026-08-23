"""IA del curso «IA desde cero».

Aqui vive TODO lo que es IA: la ontologia, el grafo que la verifica, el prompt
y el bucle del agente. TypeScript se queda con el backend HTTP y el frontend.

La frontera es deliberada: este servicio NO habla con Postgres. Las herramientas
las ejecuta la API de Node, que es la unica que tiene el userId de la sesion. Si
este servicio pudiera consultar la base, el aislamiento entre usuarios estaria
implementado dos veces en dos lenguajes — y el dia que divergan, gana la copia
equivocada.
"""

VERSION = "3.0.0"
