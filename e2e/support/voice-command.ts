import { expect, type Page } from '@playwright/test';
import type { SpeechRecognitionLike } from '../../frontend/src/features/assistant/speech-session.js';

interface CommandSpeechControl {
  result(text: string, final: boolean): void;
  end(): void;
  error(code: string): void;
}

/** Solo se dobla Web Speech: el envío, worker, política, auditoría y Yjs son reales. */
export async function installCommandSpeech(page: Page) {
  await page.addInitScript(() => {
    const engines: SpeechRecognitionLike[] = [];
    class Recognition implements SpeechRecognitionLike {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: SpeechRecognitionLike['onresult'] = null;
      onerror: SpeechRecognitionLike['onerror'] = null;
      onend: SpeechRecognitionLike['onend'] = null;
      start() {
        engines.push(this);
      }
      stop() {
        /* El test entrega el resultado final y end por separado. */
      }
      abort() {
        /* No borra current: permite intentar entregar eventos tardíos. */
      }
    }
    const control: CommandSpeechControl = {
      result(text, final) {
        engines.at(-1)?.onresult?.({
          results: [Object.assign([{ transcript: text }], { isFinal: final })],
        });
      },
      end() {
        engines.at(-1)?.onend?.();
      },
      error(code) {
        engines.at(-1)?.onerror?.({ error: code });
      },
    };
    Object.assign(window, { SpeechRecognition: Recognition, __commandSpeech: control });
  });
  await page.reload();
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await page.getByTestId('pestana-asistente').click();
}

export async function commandSpeech(
  page: Page,
  action: 'result' | 'end' | 'error',
  text = '',
  final = true,
) {
  await page.evaluate(
    ({ action, text, final }) => {
      const control = (window as unknown as { __commandSpeech: CommandSpeechControl })
        .__commandSpeech;
      if (action === 'result') control.result(text, final);
      else if (action === 'error') control.error(text);
      else control.end();
    },
    { action, text, final },
  );
}

export async function speakCommand(page: Page, text: string) {
  const button = page.getByRole('button', { name: 'Comando de voz', exact: true });
  await expect(button).toBeEnabled();
  await button.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await commandSpeech(page, 'result', text, false);
  await button.press('Enter');
  await expect(page.getByTestId('transcripcion-comando-voz')).toHaveText(
    'Esperando la transcripción final…',
  );
  await commandSpeech(page, 'result', text);
  await commandSpeech(page, 'end');
}
