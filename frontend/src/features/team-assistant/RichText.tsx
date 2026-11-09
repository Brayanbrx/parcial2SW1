import { Fragment, type ReactNode } from 'react';

/**
 * Markdown mínimo para las respuestas de la IA: párrafos, listas, títulos,
 * **negrita**, *cursiva* y `código`. Los modelos responden así y, sin esto, la
 * conversación se llenaba de asteriscos. Se construyen elementos React —nunca
 * HTML crudo—, de modo que el texto del modelo no puede inyectar marcado.
 */
type Bloque =
  | { tipo: 'p'; lineas: string[] }
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'ol' | 'ul'; items: string[] };

const NUMERADO = /^\s*\d+[.)]\s+/;
const VINETA = /^\s*[-*•]\s+/;
const TITULO = /^\s*#{1,4}\s+/;

function bloques(texto: string): Bloque[] {
  const salida: Bloque[] = [];
  // Una línea en blanco cierra el bloque en curso aunque sea del mismo tipo.
  let abierto = false;
  for (const linea of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const ultimo = abierto ? salida[salida.length - 1] : undefined;
    if (!linea.trim()) {
      abierto = false;
      continue;
    }
    if (TITULO.test(linea)) {
      salida.push({ tipo: 'titulo', texto: linea.replace(TITULO, '') });
      abierto = false;
      continue;
    }
    const lista = NUMERADO.test(linea) ? 'ol' : VINETA.test(linea) ? 'ul' : null;
    if (lista) {
      const item = linea.replace(lista === 'ol' ? NUMERADO : VINETA, '');
      if (ultimo && ultimo.tipo === lista) ultimo.items.push(item);
      else salida.push({ tipo: lista, items: [item] });
      abierto = true;
      continue;
    }
    // Una línea sangrada tras un elemento de lista lo continúa.
    if (ultimo && (ultimo.tipo === 'ol' || ultimo.tipo === 'ul') && /^\s{2,}/.test(linea)) {
      ultimo.items[ultimo.items.length - 1] += ` ${linea.trim()}`;
      continue;
    }
    if (ultimo && ultimo.tipo === 'p') ultimo.lineas.push(linea);
    else salida.push({ tipo: 'p', lineas: [linea] });
    abierto = true;
  }
  return salida;
}

const EN_LINEA = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;

function enLinea(texto: string): ReactNode[] {
  return texto.split(EN_LINEA).map((parte, i) => {
    if (/^(\*\*|__).+\1$/.test(parte)) return <strong key={i}>{parte.slice(2, -2)}</strong>;
    if (/^`.+`$/.test(parte)) return <code key={i}>{parte.slice(1, -1)}</code>;
    if (/^\*[^*].*\*$/.test(parte)) return <em key={i}>{parte.slice(1, -1)}</em>;
    return <Fragment key={i}>{parte}</Fragment>;
  });
}

export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {bloques(text).map((bloque, i) =>
        bloque.tipo === 'p' ? (
          <p key={i}>{enLinea(bloque.lineas.join('\n'))}</p>
        ) : bloque.tipo === 'titulo' ? (
          <p key={i} className="titulo">
            <strong>{enLinea(bloque.texto)}</strong>
          </p>
        ) : bloque.tipo === 'ol' ? (
          <ol key={i}>
            {bloque.items.map((item, j) => (
              <li key={j}>{enLinea(item)}</li>
            ))}
          </ol>
        ) : (
          <ul key={i}>
            {bloque.items.map((item, j) => (
              <li key={j}>{enLinea(item)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
