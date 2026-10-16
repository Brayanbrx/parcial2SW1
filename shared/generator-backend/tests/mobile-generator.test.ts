import { describe, expect, it } from 'vitest';
import { fixture } from '@uml/fixtures';
import { buildGenerationIr } from '@uml/generation-ir';
import { generateMobileProject } from '@uml/generator-backend';

describe('paquete Android del diagrama', () => {
  it('incluye backend protegido y cliente offline del mismo contrato, sin secretos ni pesos', async () => {
    const ir = buildGenerationIr({
      projectName: 'Ventas',
      snapshotVersion: 1,
      model: fixture('T01').model,
    });
    const first = await generateMobileProject(ir);
    const second = await generateMobileProject(ir);
    expect(first.zip.equals(second.zip)).toBe(true);
    const content = (path: string) => first.files.find((f) => f.path.endsWith(path))!.content;
    expect(content('mobile/assets/contract.json')).toBe(content('backend/docs/dto-contract.json'));
    expect(content('backend/src/main/resources/mobile-contract.json')).toBe(
      content('mobile/assets/contract.json'),
    );
    expect(content('MobileContractController.java')).toContain('@GetMapping("/mobile-contract")');
    expect(content('mobile/tool/start_backend.dart')).toContain('Random.secure()');
    expect(content('MobileSecurity.java')).toContain('anyRequest().authenticated()');
    expect(content('MobileSyncController.java')).toContain('UUID.fromString(node.asText())');
    expect(content('MobileSyncController.java')).not.toContain('__HANDLERS__');
    expect(content('mobile/pubspec.yaml')).toContain('llama_flutter_android: 0.2.6');
    expect(content('backend/.env.example')).toContain('AUTH_TOKEN_SECRET=\n');
    expect(first.files.some((f) => f.path.endsWith('.gguf'))).toBe(false);
    expect(first.files.some((f) => f.path.endsWith('.litertlm') || f.path.endsWith('.bin'))).toBe(
      false,
    );
    // Compilar e instalar con una orden, e IA en linea sin claves en el ZIP.
    expect(first.files.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        'apk.bat',
        'apk.sh',
        'mobile/tool/apk.dart',
        'mobile/ai.env.example',
        'mobile/.gitignore',
        'mobile/lib/data/remote_ai.dart',
        'mobile/test/remote_ai_test.dart',
        'mobile/lib/domain/assistant_runner.dart',
        'mobile/lib/domain/assistant_protocol.dart',
        'mobile/lib/domain/assistant_session.dart',
        'mobile/lib/domain/assistant_budget.dart',
        'mobile/lib/domain/assistant_ports.dart',
        'mobile/lib/data/assistant_tools.dart',
        'mobile/lib/data/assistant_runtime.dart',
        'mobile/lib/ui/assistant_view_model.dart',
        'mobile/lib/ui/assistant_screen.dart',
        'mobile/test/assistant_tools_test.dart',
        'mobile/test/assistant_runner_test.dart',
        'mobile/test/assistant_runtime_test.dart',
        'mobile/test/assistant_view_model_test.dart',
        'mobile/test/assistant_native_test.dart',
        'mobile/test/assistant_screen_test.dart',
        'mobile/docs/assistant-evaluation.md',
      ]),
    );
    expect(content('apk.bat')).toContain('dart tool\\apk.dart');
    expect(content('apk.sh')).toContain('dart tool/apk.dart');
    expect(content('apk.bat')).toContain('exit /b %apkExitCode%');
    expect(content('mobile/tool/apk.dart')).toContain("'reverse', 'tcp:$port', 'tcp:$port'");
    expect(content('mobile/tool/start_backend.dart')).toContain("'--wait'");
    expect(content('mobile/test/apk_tool_test.dart')).toContain('throwsStateError');
    expect(content('mobile/tool/apk.dart')).not.toContain('__APP_ID__');
    expect(content('mobile/tool/apk.dart')).toContain(
      "packageName = 'com.uml.generated.ventas_mobile'",
    );
    expect(content('mobile/ai.env.example')).toMatch(/^GEMINI_API_KEY=$/m);
    expect(content('mobile/ai.env.example')).not.toMatch(/_API_KEY=\S/);
    expect(content('mobile/.gitignore')).toContain('ai.env');
    expect(first.files.find((f) => f.path === 'README.md')!.content).toContain('apk.bat install');
    for (const path of [
      'mobile/lib/data/model_library.dart',
      'mobile/lib/data/local_auth.dart',
      'mobile/test/local_login_test.dart',
      'mobile/lib/data/local_speech.dart',
      'mobile/lib/domain/assistant_prompt.dart',
      'mobile/lib/ui/local_model_settings.dart',
      'mobile/docs/local-models.md',
    ])
      expect(content(path)).toBeTruthy();
  });
});
