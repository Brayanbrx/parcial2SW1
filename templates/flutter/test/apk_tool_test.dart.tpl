import 'package:flutter_test/flutter_test.dart';
import '../tool/apk.dart';

void main() {
  test('ADB ignora avisos del daemon y conserva estados y modelos', () {
    final found = parseDevices('''
* daemon started successfully
List of devices attached
phone1 device product:test model:Pixel_8 transport_id:1
phone2 unauthorized transport_id:2
emulator-5554 offline transport_id:3
''');
    expect(found.map((d) => d.serial), ['phone1', 'phone2', 'emulator-5554']);
    expect(found.first.model, 'Pixel_8');
    expect(selectDevice(found), 'phone1');
  });

  test('no permite instalar en un serial ausente o sin autorizacion', () {
    final found = [
      Device('locked', 'unauthorized', ''),
      Device('ok', 'device', ''),
    ];
    expect(() => selectDevice(found, requested: 'missing'), throwsStateError);
    expect(() => selectDevice(found, requested: 'locked'), throwsStateError);
    expect(selectDevice(found, requested: 'ok'), 'ok');
    expect(() => selectDevice([]), throwsStateError);
    expect(
      () => selectDevice([Device('offline', 'offline', '')]),
      throwsStateError,
    );
  });

  test('varios dispositivos requieren una seleccion explicita', () {
    final found = [Device('one', 'device', ''), Device('two', 'device', '')];
    expect(() => selectDevice(found), throwsStateError);
    expect(selectDevice(found, requested: 'two'), 'two');
  });
}
