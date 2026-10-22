package com.tellymote.core

/** A TV found on the local network. */
data class TvDevice(
    val id: String,
    val name: String,
    val host: String,
    val protocols: Set<Protocol>,
    val model: String? = null,
) {
    val bestProtocol: Protocol?
        get() = when {
            Protocol.ATV_REMOTE_V2 in protocols -> Protocol.ATV_REMOTE_V2
            Protocol.ROKU_ECP in protocols -> Protocol.ROKU_ECP
            Protocol.ADB in protocols -> Protocol.ADB
            else -> null
        }
}

enum class Protocol(val port: Int, val label: String) {
    ATV_REMOTE_V2(6466, "Android TV remote"),
    ADB(5555, "ADB"),
    ROKU_ECP(8060, "Roku ECP"),
}
