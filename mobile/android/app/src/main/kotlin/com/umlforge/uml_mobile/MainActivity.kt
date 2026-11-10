package com.umlforge.uml_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Canal de las notificaciones push de cambios (el servidor lo nombra en el mensaje).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "cambios",
                "Cambios en proyectos",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Avisos cuando alguien edita una pizarra de tus proyectos"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
