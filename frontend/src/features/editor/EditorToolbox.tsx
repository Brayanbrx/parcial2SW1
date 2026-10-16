import { useMemo, useState } from 'react';
import { RELATIONSHIP_TOOLS, type EditorTool } from './editor-tools.js';

export interface EditorToolboxProps {
  readonly activeTool: EditorTool;
  readonly relationshipSourceName: string | null;
  readonly canWrite: boolean;
  onToolChange(tool: EditorTool): void;
}

/**
 * Caja de herramientas deliberadamente corta: solo contiene lo que el examen
 * puede convertir a PostgreSQL y Spring Boot. Funciona como una paleta UML de
 * escritorio, pero evita mostrar elementos que el proyecto no soporta.
 */
export function EditorToolbox(props: EditorToolboxProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  const visibleRelationships = useMemo(
    () =>
      RELATIONSHIP_TOOLS.filter((item) =>
        `${item.label} ${item.description}`.toLocaleLowerCase('es').includes(normalizedQuery),
      ),
    [normalizedQuery],
  );
  const showSelect = 'seleccionar mover'.includes(normalizedQuery);
  const showClass = 'clase entidad tabla'.includes(normalizedQuery);

  const status = toolStatus(props.activeTool, props.relationshipSourceName);

  return (
    <aside id="editor-toolbox" className="toolbox" aria-label="Caja de herramientas UML">
      <header className="toolbox-header">
        <div>
          <span className="toolbox-eyebrow">Diagrama de clases</span>
          <h2>Toolbox</h2>
        </div>
        <span className="toolbox-badge">UML</span>
      </header>

      <label className="toolbox-search">
        <span className="visualmente-oculto">Buscar herramienta</span>
        <ToolIcon kind="SEARCH" />
        <input
          type="search"
          value={query}
          placeholder="Buscar herramienta"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="toolbox-scroll">
        {(showSelect || showClass) && (
          <ToolSection title="Elementos">
            {showSelect && (
              <ToolButton
                tool="SELECT"
                activeTool={props.activeTool}
                label="Seleccionar"
                description="Mover, editar y conectar"
                shortcut="V"
                disabled={false}
                onSelect={props.onToolChange}
              />
            )}
            {showClass && (
              <ToolButton
                tool="CLASS"
                activeTool={props.activeTool}
                label="Clase"
                description="Crear una entidad en la pizarra"
                shortcut="C"
                disabled={!props.canWrite}
                onSelect={props.onToolChange}
              />
            )}
          </ToolSection>
        )}

        {visibleRelationships.length > 0 && (
          <ToolSection title="Relaciones">
            {visibleRelationships.map((item) => (
              <ToolButton
                key={item.tool}
                tool={item.tool}
                activeTool={props.activeTool}
                label={item.label}
                description={item.description}
                shortcut={item.shortcut}
                disabled={!props.canWrite}
                onSelect={props.onToolChange}
              />
            ))}
          </ToolSection>
        )}

        {!showSelect && !showClass && visibleRelationships.length === 0 && (
          <p className="toolbox-empty">No hay herramientas que coincidan.</p>
        )}
      </div>

      <div className="toolbox-status" role="status" aria-live="polite">
        <span className="toolbox-status-icon" aria-hidden="true">
          {props.activeTool === 'SELECT' ? 'V' : props.activeTool === 'CLASS' ? 'C' : '↗'}
        </span>
        <span>{status}</span>
      </div>
    </aside>
  );
}

function ToolSection({
  title,
  children,
}: React.PropsWithChildren<{ title: string }>): React.JSX.Element {
  return (
    <section className="toolbox-section">
      <h3>{title}</h3>
      <div className="toolbox-items">{children}</div>
    </section>
  );
}

function ToolButton({
  tool,
  activeTool,
  label,
  description,
  shortcut,
  disabled,
  onSelect,
}: {
  readonly tool: EditorTool;
  readonly activeTool: EditorTool;
  readonly label: string;
  readonly description: string;
  readonly shortcut: string;
  readonly disabled: boolean;
  onSelect(tool: EditorTool): void;
}): React.JSX.Element {
  const active = tool === activeTool;

  return (
    <button
      type="button"
      className={`toolbox-item${active ? ' active' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      data-testid={`tool-${tool.toLocaleLowerCase()}`}
      title={`${label} · ${description} (${shortcut})`}
      onClick={() => onSelect(tool)}
    >
      <span className="toolbox-item-icon">
        <ToolIcon kind={tool} />
      </span>
      <span className="toolbox-item-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <kbd>{shortcut}</kbd>
    </button>
  );
}

function toolStatus(tool: EditorTool, sourceName: string | null): string {
  if (tool === 'SELECT')
    return 'Selecciona una clase para editarla o usa su flecha para relacionar.';
  if (tool === 'CLASS') return 'Haz clic en un punto libre de la pizarra para crear la clase.';
  if (sourceName === null) return 'Selecciona la clase de origen y después la clase de destino.';
  return `Origen: ${sourceName}. Ahora selecciona la clase de destino.`;
}

function ToolIcon({ kind }: { readonly kind: EditorTool | 'SEARCH' }): React.JSX.Element {
  if (kind === 'SEARCH') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 5 5" />
      </svg>
    );
  }

  if (kind === 'SELECT') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3.5 18 12l-6.2 1.1L9 19Z" />
      </svg>
    );
  }

  if (kind === 'CLASS') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <path d="M3 9h18M7 13h6M7 16.5h9" />
      </svg>
    );
  }

  const marker =
    kind === 'GENERALIZATION' ? (
      <path className="marker" d="m19 8 4 4-4 4Z" />
    ) : kind === 'COMPOSITION' ? (
      <path className="marker filled" d="m4 12 4-4 4 4-4 4Z" />
    ) : kind === 'AGGREGATION' ? (
      <path className="marker" d="m4 12 4-4 4 4-4 4Z" />
    ) : null;

  return (
    <svg viewBox="0 0 27 24" aria-hidden="true">
      <path d="M4 12h19" />
      {marker}
    </svg>
  );
}
