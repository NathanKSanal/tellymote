package com.tellymote.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tellymote.core.Discovery
import com.tellymote.core.TvDevice
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TellyMoteTheme {
                TellyMoteApp()
            }
        }
    }
}

private val Amber = Color(0xFFE0AD63)
private val Background = Color(0xFF0B0C0F)
private val Panel = Color(0xFF111318)
private val PanelQuiet = Color(0xFF15181E)
private val Line = Color(0xFF23262E)
private val TextMain = Color(0xFFE7E9EE)
private val TextMuted = Color(0xFF9AA1AC)
private val TextFaint = Color(0xFF6D7480)

@Composable
fun TellyMoteTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Amber,
            onPrimary = Color(0xFF1A1308),
            background = Background,
            onBackground = TextMain,
            surface = Panel,
            onSurface = TextMain,
            surfaceVariant = PanelQuiet,
            onSurfaceVariant = TextMuted,
            outline = Line,
            error = Color(0xFFCF7373),
        ),
        content = content,
    )
}

@Composable
fun TellyMoteApp() {
    var devices by remember { mutableStateOf<List<TvDevice>>(emptyList()) }
    var scanning by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("Ready to scan") }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun scan() {
        if (scanning) return
        scanning = true
        error = null
        scope.launch {
            runCatching {
                Discovery.scan { status = it }
            }.onSuccess { found ->
                devices = found
                status = if (found.isEmpty()) {
                    "No TVs answered. Keep the TV awake and on the same Wi-Fi."
                } else {
                    "${found.size} display${if (found.size == 1) "" else "s"} found"
                }
            }.onFailure {
                error = it.message ?: "Scan failed"
                status = "Scan failed"
            }
            scanning = false
        }
    }

    LaunchedEffect(Unit) { scan() }

    Surface(modifier = Modifier.fillMaxSize(), color = Background) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 18.dp)) {
            Text("TELLYMOTE", color = Amber, fontSize = 10.sp, letterSpacing = 2.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text("Your TV, found.", color = TextMain, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "Local network only. No account, no cloud.",
                color = TextMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 4.dp),
            )

            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    onClick = { scan() },
                    enabled = !scanning,
                    colors = ButtonDefaults.buttonColors(containerColor = Amber, contentColor = Color(0xFF1A1308)),
                    shape = RoundedCornerShape(7.dp),
                ) {
                    Text(if (scanning) "Scanning…" else "Scan network", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                }
                Text(status, color = TextFaint, fontSize = 11.sp)
            }

            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 11.sp, modifier = Modifier.padding(top = 8.dp))
            }

            Spacer(Modifier.height(18.dp))

            if (devices.isEmpty() && !scanning) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = Panel,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, Line),
                ) {
                    Column(Modifier.padding(18.dp)) {
                        Text("No display yet", color = TextMain, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text(
                            "Make sure the TV is on, on the same Wi-Fi, and not on a guest network. " +
                                "Android TV must have the remote service running; Roku must be on the same LAN.",
                            color = TextMuted,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(devices, key = { it.id }) { device ->
                        DeviceRow(device)
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            Text(
                "This build finds displays. Pairing and the D-pad remote arrive in the next slice.",
                color = TextFaint,
                fontSize = 10.sp,
            )
        }
    }
}

@Composable
private fun DeviceRow(device: TvDevice) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Panel),
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, Line),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Text(device.name, color = TextMain, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text(
                device.host,
                color = TextMuted,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.padding(top = 2.dp),
            )
            Row(
                modifier = Modifier.padding(top = 9.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                device.protocols.sortedBy { it.port }.forEach { protocol ->
                    Surface(
                        color = PanelQuiet,
                        shape = RoundedCornerShape(4.dp),
                        border = BorderStroke(1.dp, Line),
                    ) {
                        Text(
                            protocol.label,
                            color = TextMuted,
                            fontSize = 10.sp,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 4.dp),
                        )
                    }
                }
            }
        }
    }
}
