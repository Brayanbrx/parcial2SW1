import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { abrirHerramienta, crearClase } from '../support/actors.js';
import { montarEscenario } from '../support/escenario.js';

/**
 * Del diagrama al ZIP, por la interfaz (guion 16.2).
 *
 * Son los dos pasos de la defensa que hasta la fase 10 no existían: «seleccionar
 * la pizarra y generar» y «descargar el ZIP». Las pruebas de integración ya
 * cubren la ruta; esto comprueba que la persona puede llegar hasta el archivo
 * **desde el navegador**, que es lo que ocurrirá el 23.
 *
 * El contenido del ZIP no se abre aquí: de eso se ocupa `npm run test:bank`, que
 * compila y arranca siete proyectos generados. Repetirlo con un navegador
 * delante costaría minutos y no añadiría nada.
 */
test.describe('generacion desde el editor', () => {
  test('una clase nueva se puede generar y descargar', async ({ browser }) => {
    const escenario = await montarEscenario(browser, 'Generacion');

    try {
      await crearClase(escenario.ana, 'Cliente');
      await abrirHerramienta(escenario.ana, 'generar');

      // Sin errores en el modelo, el pie de página lo dice y el botón se habilita.
      await expect(escenario.ana.page.getByTestId('puede-generar')).toHaveText(
        'Generación disponible',
      );
      await expect(escenario.ana.page.getByTestId('generar')).toBeEnabled();

      // El paquete que se escribe aquí tiene que llegar al código descargado.
      // Antes no llegaba: la API lo aceptaba, lo devolvía en la respuesta, y
      // ninguna descarga lo llevaba (ADR-018, enmienda).
      await escenario.ana.page.getByTestId('paquete-base').fill('bo.edu.demo');
      await escenario.ana.page.getByTestId('incluir-flutter').check();
      await escenario.ana.page.getByTestId('generar').click();

      // El mensaje dice sobre qué versión del snapshot se generó: es la prueba
      // visible de RA-08 para quien mire la pantalla en la defensa.
      const estado = escenario.ana.page.getByTestId('estado-generacion');
      await expect(estado).toContainText('entidades', { timeout: 30_000 });
      await expect(estado).toContainText(/versión \d+ del modelo/);
      await expect(estado).toContainText('bo.edu.demo');

      // Y el historial enseña el manifiesto congelado, no el estado de ahora.
      await expect(escenario.ana.page.getByTestId('historial-generaciones')).toContainText(
        'bo.edu.demo',
      );

      const descarga = escenario.ana.page.waitForEvent('download');
      await escenario.ana.page.getByTestId('descargar-spring').click();
      const archivo = await descarga;

      expect(archivo.suggestedFilename()).toMatch(/\.zip$/);

      // Que exista un archivo no basta: uno vacío también existiría, y la
      // primera versión de esto generó cero entidades sobre una pizarra que
      // mostraba una — la proyección iba con retardo y nadie lo habría visto
      // hasta abrir el ZIP en la defensa.
      //
      // Los nombres de archivo viajan sin comprimir en el índice del ZIP, así
      // que se pueden buscar sin descomprimir nada.
      const contenido = await readFile(await archivo.path());
      expect(contenido.includes('Cliente.java')).toBe(true);
      expect(contenido.includes('ClienteController.java')).toBe(true);
      expect(contenido.includes('pom.xml')).toBe(true);
      // Las rutas llevan el paquete convertido en carpetas.
      expect(contenido.includes('bo/edu/demo')).toBe(true);
      const mobileDownload = escenario.ana.page.waitForEvent('download');
      await escenario.ana.page.getByTestId('descargar-mobile').click();
      const mobile = await mobileDownload;
      expect(mobile.suggestedFilename()).toMatch(/-android\.zip$/);
      const paired = await readFile(await mobile.path());
      expect(paired.includes('mobile/lib/main.dart')).toBe(true);
      expect(paired.includes('MobileSyncController.java')).toBe(true);
      expect(paired.includes('mobile/assets/contract.json')).toBe(true);
    } finally {
      await escenario.cerrar();
    }
  });

  test('los botones de descarga se ven sin desplazar el panel', async ({ browser }) => {
    // Misma familia que el candidato de importacion y que la propuesta del
    // asistente: la accion que sigue a lo que acabas de hacer tiene que estar a
    // la vista. Aqui el historial crece debajo, generacion tras generacion.
    const escenario = await montarEscenario(browser, 'Descargas visibles');

    try {
      await crearClase(escenario.ana, 'Cliente');
      await abrirHerramienta(escenario.ana, 'generar');

      for (let vuelta = 0; vuelta < 4; vuelta += 1) {
        await escenario.ana.page.getByTestId('generar').click();
        await expect(escenario.ana.page.getByTestId('estado-generacion')).toContainText(
          'entidades',
          { timeout: 30_000 },
        );
      }

      await expect(escenario.ana.page.getByTestId('descargar-spring')).toBeInViewport({
        ratio: 1,
      });
    } finally {
      await escenario.cerrar();
    }
  });
});
