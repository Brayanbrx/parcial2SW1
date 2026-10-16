import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import '../lib/data/api.dart';

void main() {
  test(
    'separates USB, emulator, and LAN connection failures without showing raw request details',
    () {
      final error = http.ClientException(
        'socket error with private request details',
      );
      final usb = connectionErrorMessage(error, 'http://127.0.0.1:8082');
      expect(usb, contains('cable USB'));
      expect(usb, isNot(contains('private')));
      expect(
        connectionErrorMessage(error, 'http://10.0.2.2:8082'),
        contains('solo sirve en el emulador'),
      );
      expect(
        connectionErrorMessage(TimeoutException('late'), 'https://server.test'),
        contains('red del telefono'),
      );
    },
  );
  test(
    'preserves authentication and contract errors rather than blaming the network',
    () {
      expect(
        connectionErrorMessage(
          ApiFailure(401, 'Credenciales incorrectas'),
          'http://127.0.0.1:8082',
        ),
        'Credenciales incorrectas',
      );
      expect(
        connectionErrorMessage(
          const FormatException('Contrato incompatible'),
          '',
        ),
        'Contrato incompatible',
      );
    },
  );
}
