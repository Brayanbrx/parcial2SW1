import 'package:flutter_test/flutter_test.dart';
import '../tool/usb_watch.dart';

void main() {
  test(
    'repairs a lost tunnel, preserves an existing one, and recovers after unplug',
    () async {
      var online = true, connected = false, repairs = 0;
      Future<String?> adb(List<String> args) async {
        expect(args.take(2), ['-s', 'my-phone']);
        if (args[2] == 'get-state') return online ? 'device\n' : null;
        if (args.last == '--list')
          return connected
              ? 'UsbFfs tcp:8082 tcp:8082\n'
              : 'UsbFfs tcp:9000 tcp:9000\n';
        expect(args.sublist(2), ['reverse', 'tcp:8082', 'tcp:8082']);
        connected = true;
        repairs++;
        return '';
      }

      expect(await repairUsb(adb, 'my-phone', 8082), contains('conectado'));
      await repairUsb(adb, 'my-phone', 8082);
      expect(repairs, 1);
      online = false;
      connected = false;
      expect(await repairUsb(adb, 'my-phone', 8082), contains('Esperando'));
      expect(repairs, 1);
      online = true;
      await repairUsb(adb, 'my-phone', 8082);
      expect(repairs, 2);
    },
  );
  test('does not claim connection when forwarding fails', () async {
    expect(
      await repairUsb(
        (args) async {
          if (args.last == 'get-state') return 'device';
          if (args.last == '--list') return '';
          return null;
        },
        'phone',
        8082,
      ),
      contains('No se pudo restablecer'),
    );
  });
}
