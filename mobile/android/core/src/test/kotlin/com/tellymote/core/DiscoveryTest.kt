package com.tellymote.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import java.net.Inet4Address
import java.net.InetAddress

class DiscoveryTest {
    @Test
    fun parsesSsdpHeadersCaseInsensitively() {
        val message = """
            HTTP/1.1 200 OK
            CACHE-CONTROL: max-age=1800
            LOCATION: http://192.168.0.42:8060/dial/dd.xml
            SERVER: Linux/4.9 UPnP/1.0 Roku/12.0
            ST: roku:ecp
        """.trimIndent()
        val headers = Ssdp.parseHeaders(message)
        assertEquals("http://192.168.0.42:8060/dial/dd.xml", headers["LOCATION"])
        assertEquals("roku:ecp", headers["ST"])
        assertTrue(headers["SERVER"]!!.contains("Roku"))
    }

    @Test
    fun buildsA24BitHostListWithoutTheLocalAddress() {
        val local = InetAddress.getByName("192.168.0.42") as Inet4Address
        val hosts = Discovery.subnetHosts(local)
        assertEquals(253, hosts.size)
        assertTrue("192.168.0.1" in hosts)
        assertTrue("192.168.0.254" in hosts)
        assertTrue("192.168.0.42" !in hosts)
    }
}
