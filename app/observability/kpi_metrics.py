import asyncio

import psutil
from prometheus_client import Gauge, start_http_server

from app.shared.logger import logger

_COLLECTION_INTERVAL = 15

_cpu_usage = Gauge("system_cpu_usage_percent", "CPU usage %")
_memory_usage = Gauge("system_memory_usage_percent", "Memory usage %")
_memory_available_gb = Gauge("system_memory_available_gb", "Available memory GB")
_disk_usage = Gauge("system_disk_usage_percent", "Disk usage %")
_net_bytes_sent = Gauge("system_network_bytes_sent_total", "Network bytes sent")
_net_bytes_recv = Gauge("system_network_bytes_recv_total", "Network bytes received")


class SystemMetricsCollector:
    def collect(self) -> None:
        _cpu_usage.set(psutil.cpu_percent(interval=1))

        mem = psutil.virtual_memory()
        _memory_usage.set(mem.percent)
        _memory_available_gb.set(round(mem.available / (1024 ** 3), 2))

        disk = psutil.disk_usage("/")
        _disk_usage.set(disk.percent)

        net = psutil.net_io_counters()
        _net_bytes_sent.set(net.bytes_sent)
        _net_bytes_recv.set(net.bytes_recv)


async def _collection_loop(collector: SystemMetricsCollector) -> None:
    while True:
        try:
            collector.collect()
        except Exception as exc:
            logger.error("System metrics collection error: %s", exc)
        await asyncio.sleep(_COLLECTION_INTERVAL)


def start(port: int = 8001) -> None:
    collector = SystemMetricsCollector()
    start_http_server(port)
    logger.info("System metrics exporter started on port %d", port)
    asyncio.run(_collection_loop(collector))
