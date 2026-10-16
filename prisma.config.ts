import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 saco la URL de conexion del archivo de esquema. Vive aqui y se lee de
 * la variable de entorno: RNF-08, ningun secreto queda escrito en el repositorio.
 */
const url = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'backend/prisma/schema.prisma',
  migrations: {
    path: 'backend/prisma/migrations',
  },
  // La cadena de conexion solo se declara si existe. `prisma generate` no
  // necesita base de datos, y sin esta condicion no se podria generar el cliente
  // durante la construccion de una imagen ni en integracion continua, que es
  // justo donde no hay ninguna base a la que apuntar. `migrate` sigue fallando
  // con un mensaje claro si falta.
  ...(url === undefined ? {} : { datasource: { url } }),
});
