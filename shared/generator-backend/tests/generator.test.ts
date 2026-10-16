import { describe, expect, it } from 'vitest';
import type { SemanticModel } from '@uml/contracts';
import { fixture } from '@uml/fixtures';
import { generateSpringProject, generateSpringProjectFiles } from '@uml/generator-backend';
import { buildGenerationIr } from '@uml/generation-ir';

describe('generador del backend Spring', () => {
  it('emite las cuatro capas, DTO, infraestructura y trazabilidad para T01', async () => {
    const files = await generateSpringProjectFiles(t01Ir());
    const paths = files.map((file) => file.path);

    expect(files).toHaveLength(38);
    expect(paths).toContain('pom.xml');
    expect(paths).toContain('Dockerfile');
    expect(paths).toContain('compose.yaml');
    expect(paths).toContain('postman/collection.json');
    expect(paths).toContain('src/main/java/bo/edu/sw1/sistemaventas/model/Venta.java');
    expect(paths).toContain('src/main/java/bo/edu/sw1/sistemaventas/dto/VentaDTO.java');
    expect(paths).toContain(
      'src/main/java/bo/edu/sw1/sistemaventas/repository/VentaRepository.java',
    );
    expect(paths).toContain('src/main/java/bo/edu/sw1/sistemaventas/service/VentaService.java');
    expect(paths).toContain(
      'src/main/java/bo/edu/sw1/sistemaventas/controller/VentaController.java',
    );
  });

  it('genera DTO planos, lado propietario y consulta por clave foranea', async () => {
    const files = await generateSpringProjectFiles(t01Ir());
    const venta = content(files, '/model/Venta.java');
    const cliente = content(files, '/model/Cliente.java');
    const dto = content(files, '/dto/VentaDTO.java');
    const repository = content(files, '/repository/VentaRepository.java');
    const controller = content(files, '/controller/VentaController.java');

    expect(venta).toContain('@ManyToOne(fetch = FetchType.LAZY, optional = false)');
    expect(venta).toContain('@JoinColumn(name = "cliente_id", nullable = false)');
    expect(cliente).not.toContain('List<Venta>');
    expect(dto).toContain('UUID clienteId');
    expect(dto).not.toContain('Cliente cliente');
    expect(repository).toContain('findByCliente_Id(UUID clienteId)');
    expect(controller).toContain('@RequestParam(required = false) UUID clienteId');
    expect(controller).toContain('service.findByClienteId(clienteId)');
  });

  it('emite una asociacion recursiva como clave foranea a la misma entidad', async () => {
    const files = await generateSpringProjectFiles(recursiveIr());
    const empleado = content(files, '/model/Empleado.java');
    const dto = content(files, '/dto/EmpleadoDTO.java');
    const repository = content(files, '/repository/EmpleadoRepository.java');

    expect(empleado).toContain('@ManyToOne(fetch = FetchType.LAZY, optional = false)');
    expect(empleado).toContain('@JoinColumn(name = "jefe_id", nullable = false)');
    expect(empleado).toContain('private Empleado jefe;');
    expect(dto).toContain('UUID jefeId');
    expect(repository).toContain('findByJefe_Id(UUID jefeId)');
  });

  it('incluye CRUD idempotente y traduccion uniforme de errores', async () => {
    const files = await generateSpringProjectFiles(t01Ir());
    const service = content(files, '/service/VentaService.java');
    const errors = content(files, '/exception/GlobalExceptionHandler.java');

    expect(service).toContain('var existing = repository.findById(id)');
    expect(service).toContain('return toDto(existing.get())');
    expect(service).toContain('repository.flush()');
    expect(errors).toContain('HttpStatus.NOT_FOUND');
    expect(errors).toContain('HttpStatus.CONFLICT');
    expect(errors).toContain('HttpStatus.BAD_REQUEST');
  });

  it('produce manifiesto y coleccion Postman validos', async () => {
    const files = await generateSpringProjectFiles(t01Ir());
    const manifest = JSON.parse(exactContent(files, 'generation-manifest.json')) as {
      snapshotVersion: number;
      entities: unknown[];
      files: string[];
    };
    const postman = JSON.parse(exactContent(files, 'postman/collection.json')) as {
      item: unknown[];
    };

    expect(manifest.snapshotVersion).toBe(1);
    expect(manifest.entities).toHaveLength(4);
    expect(manifest.files).toContain('generation-manifest.json');
    expect(postman.item).toHaveLength(20);
  });

  it('produce exactamente los mismos archivos y bytes ZIP para el mismo snapshot', async () => {
    const first = await generateSpringProject(t01Ir());
    const second = await generateSpringProject(t01Ir());

    expect(first.artifactName).toBe('sistema-ventas.zip');
    expect(first.files).toEqual(second.files);
    expect(first.zip.equals(second.zip)).toBe(true);
    expect(first.zip.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});

/**
 * La jerarquia de T08, ya en Java.
 *
 * La IR se prueba aparte; esto comprueba lo que sale de las plantillas, que es
 * donde una anotacion que falta no rompe nada hasta que Hibernate arranca.
 */
describe('generador del backend Spring - herencia', () => {
  it('la raiz declara la estrategia y las subclases extienden', async () => {
    const files = await generateSpringProjectFiles(t08Ir());
    const persona = content(files, '/model/Persona.java');
    const empleado = content(files, '/model/Empleado.java');
    const docente = content(files, '/model/Docente.java');

    expect(persona).toContain('@Inheritance(strategy = InheritanceType.JOINED)');
    expect(persona).toContain('public class Persona {');

    // Tabla por clase, unida por la clave primaria de la raiz.
    expect(empleado).toContain('@Table(name = "empleado")');
    expect(empleado).toContain('@PrimaryKeyJoinColumn(name = "id")');
    expect(empleado).toContain('public class Empleado extends Persona {');

    // Y solo la raiz: una segunda @Inheritance en la cadena no significa nada.
    expect(empleado).not.toContain('@Inheritance');
    expect(docente).toContain('public class Docente extends Empleado {');
  });

  it('la subclase no vuelve a declarar nada de lo que hereda', async () => {
    const files = await generateSpringProjectFiles(t08Ir());
    const empleado = content(files, '/model/Empleado.java');
    const docente = content(files, '/model/Docente.java');

    // Un segundo @Id en la jerarquia, o un campo repetido, y la aplicacion no
    // arranca. Los getters heredados tampoco se reescriben.
    expect(empleado).not.toContain('@Id');
    expect(empleado).not.toContain('private UUID id;');
    expect(empleado).not.toContain('getNombre');

    // Docente hereda la clave foranea a Departamento desde Empleado.
    expect(empleado).toContain('private Departamento departamento;');
    expect(docente).not.toContain('Departamento');
    expect(docente).toContain('private String escalafon;');
  });

  it('el DTO y el servicio si trabajan con la entidad completa', async () => {
    const files = await generateSpringProjectFiles(t08Ir());
    const dto = content(files, '/dto/DocenteDTO.java');
    const service = content(files, '/service/DocenteService.java');
    const repository = content(files, '/repository/DocenteRepository.java');

    // Crear un docente por su propia ruta tiene que poder mandar el nombre, que
    // vive en Persona, y el departamento, que vive en Empleado.
    expect(dto).toContain('String nombre');
    expect(dto).toContain('String escalafon');
    expect(dto).toContain('UUID departamentoId');

    expect(service).toContain('entity.setNombre(dto.nombre())');
    expect(service).toContain('DepartamentoRepository departamentoRepository');
    expect(repository).toContain('extends JpaRepository<Docente, UUID>');
    expect(repository).toContain('findByDepartamento_Id(UUID departamentoId)');
  });

  it('una clave foranea puede apuntar a una subclase', async () => {
    const materia = content(await generateSpringProjectFiles(t08Ir()), '/model/Materia.java');

    expect(materia).toContain('private Docente docente;');
    expect(materia).toContain('@JoinColumn(name = "docente_id", nullable = false)');
  });
});

function t01Ir() {
  return buildGenerationIr({
    projectName: 'Sistema de Ventas',
    snapshotVersion: 1,
    model: fixture('T01').model,
  });
}

function t08Ir() {
  return buildGenerationIr({
    projectName: 'Institucion',
    snapshotVersion: 1,
    model: fixture('T08').model,
  });
}

function recursiveIr() {
  const claseId = '11111111-1111-4111-8111-111111111111';
  const model: SemanticModel = {
    classes: [
      {
        id: claseId,
        displayName: 'Empleado',
        codeName: 'Empleado',
        databaseName: 'empleado',
        attributes: [],
      },
    ],
    relationships: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        sourceClassId: claseId,
        targetClassId: claseId,
        sourceMultiplicity: '1',
        targetMultiplicity: '0..*',
        sourceRoleName: 'jefe',
        targetRoleName: 'subordinados',
      },
    ],
  };

  return buildGenerationIr({ projectName: 'Organizacion', snapshotVersion: 1, model });
}

function content(
  files: Awaited<ReturnType<typeof generateSpringProjectFiles>>,
  pathSuffix: string,
): string {
  const found = files.find((file) => file.path.endsWith(pathSuffix));
  if (found === undefined) throw new Error(`No se genero *${pathSuffix}.`);
  return found.content;
}

function exactContent(
  files: Awaited<ReturnType<typeof generateSpringProjectFiles>>,
  path: string,
): string {
  const found = files.find((file) => file.path === path);
  if (found === undefined) throw new Error(`No se genero ${path}.`);
  return found.content;
}
