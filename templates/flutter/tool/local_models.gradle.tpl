// whisper_ggml 2.6.0 declares compileSdk 34, while its FFmpeg AAR needs >=35.
// Finalize only this plugin's DSL; do not modify the global Pub cache.
subprojects { module ->
    if (module.name == 'whisper_ggml') {
        module.plugins.withId('com.android.library') {
            module.androidComponents.finalizeDsl { androidDsl ->
                androidDsl.compileSdk = 36
            }
        }
    }
}
