# IA en linea para la app Android (opcional).
#
# 1. Copia este archivo como  mobile/ai.env  (queda fuera de Git).
# 2. Pega las mismas lineas de  infra/.env  del generador: los nombres coinciden,
#    asi que basta copiar y pegar AI_LLM_PROVIDER, AI_LLM_MODEL, AI_SPEECH_* y las
#    *_API_KEY que uses.
# 3. Compila con  apk.bat  (o sh apk.sh): el script lo incrusta en el APK.
#
# Tambien puedes escribir todo esto dentro de la app: Asistente > IA en linea.
# Las claves incrustadas se pueden extraer del APK: usa esto para tu telefono,
# no para distribuir la app. El agente local (LiteRT-LM/GGUF/Whisper) sigue
# funcionando sin ninguna clave y en modo avion.

# --- Texto: interpreta instrucciones y propone altas, cambios y bajas ---
# Proveedores: gemini, openrouter, groq, anthropic, mistral, zai, moonshot, sambanova
AI_LLM_PROVIDER=gemini
AI_LLM_MODEL=gemini-3.6-flash

# --- Voz: transcribe el dictado (en lugar de Whisper local) ---
# Proveedores: groq (whisper-large-v3-turbo) o mistral (voxtral-mini-latest)
AI_SPEECH_PROVIDER=groq
AI_SPEECH_MODEL=whisper-large-v3-turbo

# --- Claves: solo hace falta la del proveedor elegido ---
GEMINI_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
ANTHROPIC_API_KEY=
MISTRAL_API_KEY=
ZAI_API_KEY=
MOONSHOT_API_KEY=
SAMBANOVA_API_KEY=
