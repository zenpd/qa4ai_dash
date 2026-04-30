import asyncio
import os

from prometheus_client import start_http_server

from app.observability.kpi_metrics import SystemMetricsCollector, _collection_loop as system_loop
from app.observability.phoenix import PhoenixConfig, PhoenixMetricsCollector, _collection_loop as phoenix_loop
from app.observability.tracing import setup_tracing
from app.shared.logger import logger


async def _main() -> None:
    setup_tracing()

    metrics_port = int(os.environ.get("METRICS_PORT", "8001"))
    start_http_server(metrics_port)
    logger.info("Prometheus metrics server started on port %d", metrics_port)

    system_collector = SystemMetricsCollector()
    phoenix_config = PhoenixConfig.from_env()
    phoenix_collector = PhoenixMetricsCollector(phoenix_config)

    logger.info("System metrics collector scheduled")
    logger.info("Phoenix metrics collector scheduled, target: %s", phoenix_config.base_url)

    await asyncio.gather(
        system_loop(system_collector),
        phoenix_loop(phoenix_collector),
    )


if __name__ == "__main__":
    asyncio.run(_main())
