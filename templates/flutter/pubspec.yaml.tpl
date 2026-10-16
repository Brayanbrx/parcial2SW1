name: __APP_ID___mobile
description: Cliente Android generado desde un diagrama UML.
publish_to: none
version: 1.0.0+1
environment:
  sdk: '>=3.10.0 <4.0.0'
dependencies:
  flutter:
    sdk: flutter
  http: ^1.6.0
  sqflite: ^2.4.2
  flutter_secure_storage: ^10.0.0
  file_picker: ^10.3.10
  path_provider: ^2.1.5
  uuid: ^4.5.2
  crypto: ^3.0.7
  cryptography: ^2.9.0
  llama_flutter_android: 0.2.6
  litertlm: 0.0.13
  whisper_ggml: 2.6.0
  record: 7.1.1
dev_dependencies:
  flutter_test:
    sdk: flutter
  sqflite_common_ffi: ^2.3.6
flutter:
  uses-material-design: true
  assets:
    - assets/contract.json
