package com.tellymote.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket

/**
 * LAN discovery for the first Android product slice: SSDP for advertisements,
 * then a bounded TCP probe of the /24 for the ATV, Roku and ADB ports.
 */
object Discovery {
    suspend fun scan(
        timeoutMs: Long = 4500,
        onProgress: (String) -> Unit = {},
    ): List<TvDevice> = withContext(Dispatchers.IO) {
        onProgress("Looking for SSDP advertisements…")
        val advertisements = runCatching { Ssdp.discover(minOf(2000L, timeoutMs)) }.getOrDefault(emptyList())
        val byHost = advertisements.associateBy { it.host }.toMutableMap()

        val local = localIpv4()
        val hosts = LinkedHashSet<String>()
        hosts += byHost.keys
        if (local != null) hosts += subnetHosts(local)
        onProgress("Probing ${hosts.size} addresses…")

        val parallel = Dispatchers.IO.limitedParallelism(48)
        val probed = hosts.map { host ->
            async(parallel) { host to probe(host) }
        }.awaitAll()

        probed.mapNotNull { (host, protocols) ->
            if (protocols.isEmpty()) return@mapNotNull null
            val hit = byHost[host]
            val server = hit?.server
            TvDevice(
                id = "host:$host",
                name = nameFor(host, hit),
                host = host,
                protocols = protocols,
                model = modelFrom(server),
            )
        }.sortedWith(compareByDescending<TvDevice> { Protocol.ATV_REMOTE_V2 in it.protocols }
            .thenByDescending { Protocol.ROKU_ECP in it.protocols }
            .thenBy { it.host })
    }

    private fun nameFor(host: String, hit: SsdpHit?): String {
        val server = hit?.server ?: return "TV at $host"
        val vendor = listOf("Roku", "Google", "Xiaomi", "Sony", "TCL", "Hisense", "Philips")
            .firstOrNull { server.contains(it, ignoreCase = true) }
        return vendor?.let { "$it TV at $host" } ?: "TV at $host"
    }

    private fun modelFrom(server: String?): String? {
        if (server == null) return null
        return Regex("""UPnP/1\.0\s+([^/]+)/([^\s]+)""").find(server)?.let { "${it.groupValues[1]} ${it.groupValues[2]}" }
    }

    private fun probe(host: String): Set<Protocol> {
        val found = mutableSetOf<Protocol>()
        for (protocol in Protocol.entries) {
            if (canConnect(host, protocol.port)) found += protocol
        }
        return found
    }

    private fun canConnect(host: String, port: Int): Boolean = try {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(host, port), 220)
            true
        }
    } catch (_: Exception) {
        false
    }

    fun localIpv4(): Inet4Address? = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .firstOrNull { !it.isLoopbackAddress && it.isSiteLocalAddress }
    }.getOrNull()

    /** /24 assumption is deliberate for the first slice; later use the real prefix. */
    fun subnetHosts(local: Inet4Address): List<String> {
        val bytes = local.address
        val prefix = "${bytes[0].toInt() and 0xff}.${bytes[1].toInt() and 0xff}.${bytes[2].toInt() and 0xff}"
        return (1..254).filter { it != (bytes[3].toInt() and 0xff) }.map { "$prefix.$it" }
    }

    fun parseHost(value: String): String? {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return null
        return runCatching { InetAddress.getByName(trimmed).hostAddress }.getOrNull()
    }
}
