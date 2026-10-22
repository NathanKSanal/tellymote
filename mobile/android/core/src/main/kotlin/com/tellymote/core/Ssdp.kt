package com.tellymote.core

import java.net.DatagramPacket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.SocketAddress
import java.net.URL

data class SsdpHit(
    val host: String,
    val location: String?,
    val server: String?,
    val searchTarget: String?,
)

/** Minimal SSDP M-SEARCH listener; enough to seed the TCP probe. */
object Ssdp {
    private const val GROUP = "239.255.255.250"
    private const val PORT = 1900

    fun discover(timeoutMs: Long = 2000): List<SsdpHit> {
        val request = buildString {
            append("M-SEARCH * HTTP/1.1\r\n")
            append("HOST: $GROUP:$PORT\r\n")
            append("MAN: \"ssdp:discover\"\r\n")
            append("MX: 2\r\n")
            append("ST: ssdp:all\r\n\r\n")
        }.toByteArray()

        val socket = MulticastSocket(null)
        socket.reuseAddress = true
        socket.bind(InetSocketAddress(0))
        socket.soTimeout = 250
        val group = InetSocketAddress(InetAddress.getByName(GROUP), PORT)
        val hits = LinkedHashMap<String, SsdpHit>()
        try {
            runCatching { socket.joinGroup(group, null) }
            val packet = DatagramPacket(request, request.size, group)
            repeat(2) { runCatching { socket.send(packet) } }
            val deadline = System.currentTimeMillis() + timeoutMs
            val buffer = ByteArray(4096)
            while (System.currentTimeMillis() < deadline) {
                val response = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(response)
                } catch (_: java.net.SocketTimeoutException) {
                    continue
                }
                val text = String(response.data, 0, response.length)
                val headers = parseHeaders(text)
                val location = headers["LOCATION"]
                val host = location?.let { runCatching { URL(it).host }.getOrNull() }
                    ?: response.address?.hostAddress
                    ?: continue
                val st = headers["ST"] ?: headers["NT"]
                val server = headers["SERVER"]
                hits[host] = SsdpHit(host, location, server, st)
            }
        } finally {
            runCatching { socket.leaveGroup(group, null) }
            socket.close()
        }
        return hits.values.toList()
    }

    fun parseHeaders(message: String): Map<String, String> {
        val headers = LinkedHashMap<String, String>()
        message.lineSequence().drop(1).forEach { line ->
            val colon = line.indexOf(':')
            if (colon > 0) {
                headers[line.substring(0, colon).trim().uppercase()] = line.substring(colon + 1).trim()
            }
        }
        return headers
    }
}
